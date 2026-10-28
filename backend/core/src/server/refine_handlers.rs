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

#[derive(Deserialize)]
pub(super) struct RefineRequest {
    pub margin_pct: f64,
}

fn candidates(result: &Value, margin: f64) -> Result<Vec<String>, String> {
    if !margin.is_finite() || !(0.0..=10.0).contains(&margin) {
        return Err("Margin must be between 0 and 10 percent".into());
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
    let cutoff = best * (1.0 - margin / 100.0);
    Ok(rows
        .iter()
        .filter(|r| !precise(r))
        .filter(|r| {
            r["dps"]
                .as_f64()
                .is_some_and(|d| if margin == 0.0 { d > best } else { d >= cutoff })
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
) -> Result<Value, String> {
    let mut result = source.clone();
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
    result["refinement"] = json!({"source_id":source_id,"margin_pct":margin,"target_error":target,"combinations":updates.iter().map(|(name,_)| name).collect::<Vec<_>>()});
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
    if source.status != JobStatus::Done || source.sim_type != "top_gear" {
        return fail("Only completed Top Gear reports can be refined".into());
    }
    let original: Value = match source
        .result_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
    {
        Some(v) => v,
        None => return fail("Source result is missing".into()),
    };
    let names = match candidates(&original, req.margin_pct) {
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
        "top_gear".into(),
        source.iterations.max(1_000_000),
        source.fight_style.clone(),
        target,
    );
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
            let merged = merge_result(&original,&updates,&source_id,margin)?;
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
        assert_eq!(candidates(&source(), 0.0).unwrap(), vec!["Combo 1"]);
        assert_eq!(
            candidates(&source(), 1.0).unwrap(),
            vec!["Combo 1", "Combo 3"]
        );
        assert!(candidates(&source(), -1.0).is_err());
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
        )
        .unwrap();
        assert_eq!(r["results"][0]["name"], "Combo 2");
        assert_eq!(r["results"][2]["delta"], 5.0);
        assert_eq!(r["results"][2]["items"], json!([1]));
        assert_eq!(s["results"][0]["dps"], 110.0);
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
            0.0
        )
        .is_err());
    }
}
