//! Explicitly refine rough contenders without changing the source report.
use crate::{
    compute::SimcBinaries,
    db::{ComboMetadataRepo, JobRepo},
    jobs::request_json::NormalizedRequest,
    log_buffer::LogBuffer,
    models::{Job, JobStatus},
    result_parser, simc_runner,
};
use actix_web::{web, HttpResponse};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

#[derive(Clone, Copy, Default, Deserialize, serde::Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum SelectionMode {
    Probability,
    Auto,
    #[default]
    Custom,
}

#[derive(Deserialize)]
pub(super) struct RefineRequest {
    #[serde(default)]
    pub margin_pct: f64,
    #[serde(default)]
    mode: SelectionMode,
    #[serde(default = "default_probability")]
    min_probability_pct: f64,
    #[serde(skip)]
    automatic_id: Option<String>,
}

fn default_probability() -> f64 {
    20.0
}

// Standard normal CDF, Abramowitz–Stegun approximation (absolute error < 8e-8).
fn normal_cdf(z: f64) -> f64 {
    let t = 1.0 / (1.0 + 0.2316419 * z.abs());
    let tail = (-0.5 * z * z).exp() / (2.0 * std::f64::consts::PI).sqrt()
        * t
        * (0.319381530
            + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    if z >= 0.0 {
        1.0 - tail
    } else {
        tail
    }
}

fn improvement_probability(dps: f64, error: f64, reference: f64, reference_error: f64) -> f64 {
    let se = (dps * error / 196.0).hypot(reference * reference_error / 196.0);
    if se == 0.0 {
        return if dps > reference {
            1.0
        } else if dps < reference {
            0.0
        } else {
            0.5
        };
    }
    normal_cdf((dps - reference) / se)
}

fn candidates(
    result: &Value,
    margin: f64,
    mode: SelectionMode,
    min_probability: f64,
) -> Result<Vec<String>, String> {
    if !margin.is_finite() || !(0.0..=10.0).contains(&margin) {
        return Err("Margin must be between 0 and 10 percent".into());
    }
    if !min_probability.is_finite() || !(0.0..=100.0).contains(&min_probability) {
        return Err("Probability must be between 0 and 100 percent".into());
    }
    let target = result["target_error"]
        .as_f64()
        .filter(|x| *x > 0.0)
        .ok_or("Missing source precision")?;
    let rows = result["results"]
        .as_array()
        .ok_or("Missing source rankings")?;
    // Displayed precision is rounded to two decimals by the result parser.
    let precise = |r: &Value| {
        r["precision_pct"]
            .as_f64()
            .is_some_and(|p| p <= target + 0.005)
    };
    let best = rows
        .iter()
        .filter(|r| precise(r))
        .filter_map(|r| r["dps"].as_f64())
        .reduce(f64::max)
        .ok_or("No full-precision result is available")?;
    let reference_error = rows
        .iter()
        .find(|r| precise(r) && r["dps"].as_f64() == Some(best))
        .and_then(|r| r["precision_pct"].as_f64())
        .unwrap_or(0.0);
    let reference_lower = best * (1.0 - reference_error / 100.0);
    let cutoff = best * (1.0 - margin / 100.0);
    Ok(rows
        .iter()
        .filter(|r| !precise(r))
        .filter(|r| {
            r["dps"].as_f64().is_some_and(|d| {
                if mode == SelectionMode::Probability {
                    r["precision_pct"]
                        .as_f64()
                        .filter(|p| *p >= 0.0)
                        .is_some_and(|p| {
                            improvement_probability(d, p, best, reference_error) * 100.0
                                >= min_probability
                        })
                } else if mode == SelectionMode::Auto {
                    // Missing uncertainty is conservatively included.
                    r["precision_pct"]
                        .as_f64()
                        .filter(|p| *p >= 0.0)
                        .is_none_or(|p| d * (1.0 + p / 100.0) >= reference_lower)
                } else if margin == 0.0 {
                    d > best
                } else {
                    d >= cutoff
                }
            })
        })
        .filter_map(|r| r["name"].as_str())
        .filter(|n| n.starts_with("Combo "))
        .map(str::to_owned)
        .collect())
}

fn refinement_options(
    source: &Value,
    target: f64,
    iterations: u32,
    untrusted: bool,
) -> Result<Value, String> {
    if !source.is_object() {
        return Err("Source options are missing".into());
    }
    let mut options = source.clone();
    options["target_error"] = json!(target);
    options["iterations"] = json!(iterations.max(1_000_000));
    if untrusted {
        options["untrusted"] = json!(true);
    }
    Ok(options)
}

fn merge_result(
    source: &Value,
    updates: &[(String, Value)],
    source_id: &str,
    margin: f64,
    mode: SelectionMode,
) -> Result<Value, String> {
    let mut result = source.clone();
    if let Some(object) = result.as_object_mut() {
        object.remove("automatic_refinement");
    }
    let base = source["base_dps"].as_f64().ok_or("Missing baseline DPS")?;
    let revision = source["simc_git_revision"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("Source has no SimC revision")?;
    let target = source["target_error"]
        .as_f64()
        .ok_or("Missing source precision")?;
    for (name, update) in updates {
        if update["simc_git_revision"].as_str() != Some(revision) {
            return Err(
                "SimC revision changed; the original engine is required to refine this report"
                    .into(),
            );
        }
        let dps = update["dps"]
            .as_f64()
            .filter(|d| d.is_finite() && *d > 0.0)
            .ok_or("Invalid rerun DPS")?;
        let precision = update["dps_error_pct"]
            .as_f64()
            .ok_or("Rerun has no precision")?;
        let rows = result["results"].as_array_mut().ok_or("Missing rankings")?;
        let row = rows
            .iter_mut()
            .find(|r| r["name"].as_str() == Some(name))
            .ok_or("Rerun combination missing from source")?;
        row["dps"] = json!(dps);
        row["delta"] = json!(((dps - base) * 10.0).round() / 10.0);
        row["precision_pct"] = json!(precision);
        row["refined"] = json!(true);
    }
    result["results"].as_array_mut().unwrap().sort_by(|a, b| {
        b["dps"]
            .as_f64()
            .unwrap_or(0.0)
            .total_cmp(&a["dps"].as_f64().unwrap_or(0.0))
    });
    result["refinement"] = json!({"source_id":source_id,"mode":mode,"margin_pct":margin,"target_error":target,"combinations":updates.iter().map(|(name,_)| name).collect::<Vec<_>>()});
    Ok(result)
}

pub(super) async fn refine(
    path: web::Path<String>,
    req: web::Json<RefineRequest>,
    repo: web::Data<JobRepo>,
    bins: web::Data<Arc<SimcBinaries>>,
    logs: web::Data<Arc<LogBuffer>>,
    queue: web::Data<crate::compute::local::LocalSimQueue>,
) -> HttpResponse {
    let source_id = path.into_inner();
    let fail = |s: String| HttpResponse::BadRequest().json(json!({"detail":s}));
    let source = match repo.get(&source_id).await {
        Ok(Some(j)) => j,
        _ => return fail("Source job not found".into()),
    };
    if source.status != JobStatus::Done
        || !matches!(
            source.sim_type.as_str(),
            "top_gear" | "droptimizer" | "upgrade_compare"
        )
    {
        return fail("Only completed gear-comparison reports can be refined".into());
    }
    let original: Value = match source
        .result_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
    {
        Some(v) => v,
        None => return fail("Source result is missing".into()),
    };
    let names = match candidates(&original, req.margin_pct, req.mode, req.min_probability_pct) {
        Ok(n) if !n.is_empty() => n,
        Ok(_) => return fail("No combinations match this margin".into()),
        Err(e) => return fail(e),
    };
    if original["simc_git_revision"]
        .as_str()
        .unwrap_or("")
        .is_empty()
    {
        return fail("Source has no recorded SimC revision".into());
    }
    let envelope: NormalizedRequest = match source
        .request_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
    {
        Some(e) => e,
        None => return fail("Source request is missing".into()),
    };
    let base = match envelope.payload["base_profile"].as_str() {
        Some(s) => s.to_owned(),
        None => return fail("Source base profile is missing".into()),
    };
    let target = original["target_error"].as_f64().unwrap();
    let mut options = match refinement_options(
        &envelope.payload["options"],
        target,
        source.iterations,
        source.rerun_of.is_some(),
    ) {
        Ok(o) => o,
        Err(e) => return fail(e),
    };
    let branch = options["simc_branch"].as_str().unwrap_or("");
    let binary = match bins.resolve(branch) {
        Ok(p) => p,
        Err(e) => return fail(e),
    };
    // Pin the executable for the entire batch, even if the updater replaces it.
    let temp = match tempfile::tempdir() {
        Ok(t) => t,
        Err(e) => return fail(e.to_string()),
    };
    let pinned = temp.path().join("simc");
    if let Err(e) = std::fs::copy(&binary, &pinned) {
        return fail(e.to_string());
    }
    let metadata = match repo.pool() {
        Some(pool) => match ComboMetadataRepo::new(pool.clone())
            .list_for_job(&source_id, None)
            .await
        {
            Ok(m) => m,
            Err(e) => return fail(e.to_string()),
        },
        None => Vec::new(),
    };
    let mut inputs = Vec::new();
    for name in &names {
        let mut fragment = metadata
            .iter()
            .find(|m| &m.combo_name == name)
            .map(|m| m.profileset_simc.clone())
            .unwrap_or_default();
        if fragment.is_empty() {
            fragment = super::sim_handlers::extract_profileset_lines(&source.simc_input, name);
        }
        if fragment.is_empty() {
            return fail(format!("Cannot reconstruct {name}"));
        }
        let direct = super::sim_handlers::profileset_overrides_to_direct(&fragment);
        inputs.push((
            name.clone(),
            simc_runner::build_simc_input_from_options(&format!("{base}\n{direct}\n"), &options),
        ));
    }
    let mut job = Job::new(
        source.simc_input.clone(),
        source.sim_type.clone(),
        source.iterations.max(1_000_000),
        source.fight_style.clone(),
        target,
    );
    if let Some(id) = &req.automatic_id {
        job.id = id.clone();
    }
    job.request_json = source.request_json.clone();
    let id = job.id.clone();
    if let Err(e) = repo.insert(&job).await {
        return fail(e.to_string());
    }
    // Keep all reconstruction metadata so the copy supports row reruns and another refinement.
    if let Some(pool) = repo.pool() {
        if let Err(e) = sqlx::query("INSERT INTO combo_metadata (job_id,combo_id,combo_name,combo_key,batch_idx,cursor_json,profileset_simc,metadata_json) SELECT $1,combo_id,combo_name,combo_key,batch_idx,cursor_json,profileset_simc,metadata_json FROM combo_metadata WHERE job_id=$2").bind(&id).bind(&source_id).execute(pool).await {
            let _ = repo.set_error(&id, &e.to_string()).await; return fail(e.to_string());
        }
    }
    let task_id = id.clone();
    let repo = repo.get_ref().clone();
    let logs = logs.get_ref().clone();
    let queue = queue.get_ref().clone();
    let margin = req.margin_pct;
    let mode = req.mode;
    let min_probability = req.min_probability_pct;
    tokio::spawn(async move {
        let _temp = temp;
        let token = crate::cancel::CancelToken::new(repo.clone(), &task_id);
        let _ = repo
            .update_progress(&task_id, 0, "Queued", "Waiting for local simulation slot")
            .await;
        let work = async {
            let _permit = crate::compute::local::await_local_queue_permit(&queue, Some(&token)).await.map_err(|e| format!("{e:?}"))?;
            repo.update_status(&task_id, JobStatus::Running).await.map_err(|e| e.to_string())?;
            let mut updates = Vec::new();
            options["prebuilt"] = json!(true);
            for (i,(name,input)) in inputs.iter().enumerate() {
                if token.is_cancelled().await { return Err("Cancelled".to_owned()); }
                repo.update_progress(&task_id, ((i*100)/inputs.len()) as u8, "Refining", &format!("{} / {}: {}",i+1,inputs.len(),name)).await.map_err(|e| e.to_string())?;
                let output = simc_runner::run_simc(&pinned,&task_id,input,&options,|line| logs.push_line(&task_id,line.to_owned()),Some(token.clone())).await?;
                let parsed = result_parser::parse_simc_result(&output.json);
                // Reject a mismatch immediately instead of spending the rest of the batch.
                if parsed["simc_git_revision"] != original["simc_git_revision"] { return Err("SimC revision differs from the source. Restore the original engine before refining.".into()); }
                updates.push((name.clone(),parsed));
            }
            let mut merged = merge_result(&original,&updates,&source_id,margin,mode)?;
            if mode == SelectionMode::Probability { merged["refinement"]["min_probability_pct"] = json!(min_probability); }
            if token.is_cancelled().await { return Err("Cancelled".into()); }
            repo.set_result(&task_id,&merged.to_string(),None).await.map_err(|e| e.to_string())?;
            Ok::<(),String>(())
        }.await;
        if let Err(e) = work {
            if !token.is_cancelled().await {
                let _ = repo.set_error(&task_id, &e).await;
            }
        }
        logs.remove(&task_id);
    });
    HttpResponse::Ok().json(json!({"id":id,"count":names.len()}))
}

pub(super) fn automatic_threshold(request: Option<&str>, result: Option<&Value>) -> Option<f64> {
    if result
        .is_some_and(|r| r.get("refinement").is_some() || r.get("automatic_refinement").is_some())
    {
        return None;
    }
    let envelope: NormalizedRequest = serde_json::from_str(request?).ok()?;
    envelope.payload["options"]["auto_refine_probability"]
        .as_f64()
        .filter(|p| p.is_finite() && (0.0..=100.0).contains(p))
}

// Runs independently of the browser. Sources without a terminal marker are
// revisited after restart; the deterministic job ID prevents duplicate batches.
pub(super) fn start_automatic_refinement(
    repo: web::Data<JobRepo>,
    bins: web::Data<Arc<SimcBinaries>>,
    logs: web::Data<Arc<LogBuffer>>,
    queue: web::Data<crate::compute::local::LocalSimQueue>,
) {
    if repo.pool().is_none() {
        return;
    }
    let spawned = std::thread::Builder::new()
        .name("auto-refinement".into())
        .spawn(move || {
            actix_web::rt::System::new().block_on(async move {
                loop {
                    let outcome = automatic_refinement_tick(&repo, &bins, &logs, &queue).await;
                    if let Err(e) = outcome {
                        eprintln!("Automatic refinement: {e}");
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
            });
        });
    if let Err(e) = spawned {
        eprintln!("Cannot start automatic refinement worker: {e}");
    }
}

async fn automatic_refinement_tick(
    repo: &web::Data<JobRepo>,
    bins: &web::Data<Arc<SimcBinaries>>,
    logs: &web::Data<Arc<LogBuffer>>,
    queue: &web::Data<crate::compute::local::LocalSimQueue>,
) -> Result<(), String> {
    use sqlx::Row;
    let Some(pool) = repo.pool() else {
        return Ok(());
    };
    let rows = sqlx::query("SELECT id FROM jobs WHERE status='done' AND sim_type IN ('top_gear','droptimizer','upgrade_compare') AND request_json LIKE '%\"auto_refine_probability\":%' AND result_json NOT LIKE '%\"automatic_refinement\":%' AND result_json NOT LIKE '%\"refinement\":%' ORDER BY created_at LIMIT 32")
        .fetch_all(pool).await.map_err(|e| e.to_string())?;
    for row in rows {
        let id: String = row.get("id");
        let source = repo
            .get(&id)
            .await
            .map_err(|e| e.to_string())?
            .ok_or("Source disappeared")?;
        let parsed: Option<Value> = source
            .result_json
            .as_deref()
            .and_then(|r| serde_json::from_str(r).ok());
        let Some(threshold) = automatic_threshold(source.request_json.as_deref(), parsed.as_ref())
        else {
            continue;
        };
        let child_id = format!("auto-refine-{id}");
        let marker = if repo
            .get_status_summary(&child_id)
            .await
            .map_err(|e| e.to_string())?
            .is_some()
        {
            json!({"state":"started","id":child_id,"min_probability_pct":threshold})
        } else {
            let response = refine(
                web::Path::from(id.clone()),
                web::Json(RefineRequest {
                    margin_pct: 0.0,
                    mode: SelectionMode::Probability,
                    min_probability_pct: threshold,
                    automatic_id: Some(child_id.clone()),
                }),
                repo.clone(),
                bins.clone(),
                logs.clone(),
                queue.clone(),
            )
            .await;
            let success = response.status().is_success();
            let body = actix_web::body::to_bytes(response.into_body())
                .await
                .map_err(|e| e.to_string())?;
            let payload: Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
            if success {
                json!({"state":"started","id":child_id,"count":payload["count"],"min_probability_pct":threshold})
            } else {
                let detail = payload["detail"]
                    .as_str()
                    .unwrap_or("Automatic refinement could not start");
                json!({"state":if detail=="No combinations match this margin" {"skipped"} else {"failed"},"detail":detail,"min_probability_pct":threshold})
            }
        };
        // Read fresh to preserve any display-data backfill performed in parallel.
        if let Some(latest) = repo.get(&id).await.map_err(|e| e.to_string())? {
            if let Some(mut result) = latest
                .result_json
                .as_deref()
                .and_then(|r| serde_json::from_str::<Value>(r).ok())
            {
                result["automatic_refinement"] = marker;
                repo.update_result_json(&id, &result.to_string())
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source() -> Value {
        json!({"base_dps":100.0,"target_error":0.1,"simc_git_revision":"abc","results":[{"name":"Combo 1","dps":110.0,"precision_pct":1.0,"items":[1]},{"name":"Combo 2","dps":108.0,"precision_pct":0.1},{"name":"Combo 3","dps":107.0,"precision_pct":2.0}]})
    }
    #[test]
    fn refinement_inherits_fight_consumables_buffs_and_custom_options() {
        let source = json!({"fight_style":"DungeonRoute","desired_targets":5,"max_time":180,"food":"feast","override.bloodlust":false,"custom_apl":"raid_events+=/pull,pull=1","simc_branch":"nightly","threads":8,"target_error":2,"iterations":100});
        let options = refinement_options(&source, 0.1, 100, true).unwrap();
        for key in [
            "fight_style",
            "desired_targets",
            "max_time",
            "food",
            "override.bloodlust",
            "custom_apl",
            "simc_branch",
            "threads",
        ] {
            assert_eq!(options[key], source[key]);
        }
        assert_eq!(options["target_error"], 0.1);
        assert_eq!(options["iterations"], 1_000_000);
        assert_eq!(options["untrusted"], true);
    }
    #[test]
    fn margin_selects_only_rough_contenders() {
        assert_eq!(
            candidates(&source(), 0.0, SelectionMode::Custom, 20.0).unwrap(),
            vec!["Combo 1"]
        );
        assert_eq!(
            candidates(&source(), 1.0, SelectionMode::Custom, 20.0).unwrap(),
            vec!["Combo 1", "Combo 3"]
        );
        assert!(candidates(&source(), -1.0, SelectionMode::Custom, 20.0).is_err());
    }
    #[test]
    fn copy_replaces_numbers_and_keeps_source_and_gear() {
        let s = source();
        let r = merge_result(
            &s,
            &[(
                "Combo 1".into(),
                json!({"dps":105.0,"dps_error_pct":0.1,"simc_git_revision":"abc"}),
            )],
            "source",
            0.0,
            SelectionMode::Custom,
        )
        .unwrap();
        assert_eq!(r["results"][0]["name"], "Combo 2");
        assert_eq!(r["results"][2]["delta"], 5.0);
        assert_eq!(r["results"][2]["items"], json!([1]));
        assert_eq!(s["results"][0]["dps"], 110.0);
    }
    #[test]
    fn selection_mode_is_explicit_and_legacy_requests_still_work() {
        let old: RefineRequest = serde_json::from_value(json!({"margin_pct":0})).unwrap();
        assert!(old.mode == SelectionMode::Custom);
        let auto: RefineRequest = serde_json::from_value(json!({"mode":"auto"})).unwrap();
        assert!(auto.mode == SelectionMode::Auto);
        assert!(serde_json::from_value::<RefineRequest>(json!({"mode":"unknown"})).is_err());
        let merged = merge_result(&source(), &[], "source", 0.0, SelectionMode::Auto).unwrap();
        assert_eq!(merged["refinement"]["mode"], "auto");
    }
    #[test]
    fn auto_uses_each_error_range_and_reference_uncertainty() {
        let mut s = source();
        s["results"].as_array_mut().unwrap().extend([
            json!({"name":"Combo 4","dps":100.0,"precision_pct":1.0}),
            json!({"name":"Combo 5","dps":107.8,"precision_pct":0.11}),
            json!({"name":"Combo 6","dps":90.0}),
        ]);
        assert_eq!(
            candidates(&s, 0.0, SelectionMode::Auto, 20.0).unwrap(),
            vec!["Combo 1", "Combo 3", "Combo 5", "Combo 6"]
        );
        assert!(candidates(&s, 0.0, SelectionMode::Auto, 20.0)
            .unwrap()
            .iter()
            .all(|n| n != "Combo 2"));
    }
    #[test]
    fn probability_threshold_uses_combined_uncertainty() {
        assert!((normal_cdf(0.0) - 0.5).abs() < 1e-7);
        assert!((normal_cdf(1.96) - 0.975).abs() < 0.0001);
        let mut s = source();
        s["results"][2]["precision_pct"] = json!(3.0);
        s["results"].as_array_mut().unwrap().extend([
            json!({"name":"Combo 4","dps":100.0,"precision_pct":1.0}),
            json!({"name":"Combo 5","dps":90.0}),
        ]);
        assert_eq!(
            candidates(&s, 0.0, SelectionMode::Probability, 20.0).unwrap(),
            vec!["Combo 1", "Combo 3"]
        );
        assert_eq!(
            candidates(&s, 0.0, SelectionMode::Probability, 50.0).unwrap(),
            vec!["Combo 1"]
        );
        assert!(candidates(&s, 0.0, SelectionMode::Probability, 101.0).is_err());
        assert_eq!(improvement_probability(100.0, 0.0, 100.0, 0.0), 0.5);
    }
    #[test]
    fn automatic_refinement_is_opt_in_and_does_not_recurse() {
        let request = NormalizedRequest::new(
            "top_gear",
            json!({"options":{"auto_refine_probability":20}}),
        )
        .to_json_string()
        .unwrap();
        assert_eq!(
            automatic_threshold(Some(&request), Some(&source())),
            Some(20.0)
        );
        assert_eq!(automatic_threshold(None, Some(&source())), None);
        let mut refined = source();
        refined["refinement"] = json!({"source_id":"parent"});
        assert_eq!(automatic_threshold(Some(&request), Some(&refined)), None);
        let mut handled = source();
        handled["automatic_refinement"] = json!({"state":"skipped"});
        assert_eq!(automatic_threshold(Some(&request), Some(&handled)), None);
        let old: super::super::types::SimOptions = serde_json::from_value(json!({})).unwrap();
        assert!(old.to_json().get("auto_refine_probability").is_none());
        let enabled: super::super::types::SimOptions =
            serde_json::from_value(json!({"auto_refine_probability":20})).unwrap();
        assert_eq!(enabled.to_json()["auto_refine_probability"], 20.0);
        assert!(serde_json::from_value::<super::super::types::SimOptions>(
            json!({"auto_refine_probability":101})
        )
        .is_err());
    }
    #[test]
    fn incompatible_engine_rejected() {
        assert!(merge_result(
            &source(),
            &[(
                "Combo 1".into(),
                json!({"dps":105.0,"dps_error_pct":0.1,"simc_git_revision":"other"})
            )],
            "source",
            0.0,
            SelectionMode::Custom,
        )
        .is_err());
    }
}
