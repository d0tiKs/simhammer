//! Compact, persisted simulation settings for the run library.
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

pub fn extract(request: &Option<String>, result: &Option<String>) -> Value {
    let request: Value = request
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(Value::Null);
    let result: Value = result
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(Value::Null);
    let payload = request.get("payload").unwrap_or(&request);
    let options = &payload["options"];
    let setup = &result["setup"];
    let raw = payload["raw"].as_bool().unwrap_or(false);
    let mut globals = BTreeMap::<String, Value>::new();
    let mut settings = BTreeMap::<String, Value>::new();
    // Parse only scenario/environment directives. Gear and talents are the
    // subject of comparisons, not the scenario; never send the full input.
    if let Some(input) = payload["simc_input"].as_str() {
        for line in input
            .lines()
            .map(str::trim)
            .filter(|line| !line.starts_with('#'))
        {
            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim();
                let value = value.trim();
                globals.insert(
                    key.into(),
                    value
                        .parse::<f64>()
                        .ok()
                        .map(|n| json!(n))
                        .unwrap_or_else(|| json!(value)),
                );
                if key.starts_with("override.")
                    || key.starts_with("raid_events")
                    || matches!(
                        key,
                        "flask"
                            | "potion"
                            | "food"
                            | "augmentation"
                            | "temporary_enchant"
                            | "fixed_time"
                            | "vary_combat_length"
                            | "skill"
                            | "default_skill"
                            | "distance"
                            | "target_level"
                            | "target_race"
                            | "target_health_pct"
                            | "optimal_raid"
                            | "world_lag"
                            | "default_world_lag"
                    )
                {
                    settings.insert(key.into(), json!(value.trim()));
                }
            }
        }
    }
    if let Some(values) = options.as_object().filter(|_| !raw) {
        for (key, value) in values {
            if !matches!(
                key.as_str(),
                "desired_targets"
                    | "fight_style"
                    | "max_time"
                    | "rotation_mode"
                    | "iterations"
                    | "target_error"
                    | "threads"
                    | "single_actor_batch"
                    | "sim_type"
            ) && !key.starts_with("triage_")
            {
                settings.insert(key.clone(), value.clone());
            }
        }
    }
    let choose = |key: &str| {
        // Completed report settings describe what actually ran. Raw input does
        // not apply the launch form's stored defaults.
        setup
            .get(key)
            .or_else(|| result.get(key))
            .cloned()
            .or_else(|| {
                if raw {
                    globals.get(key).cloned()
                } else {
                    options.get(key).cloned()
                }
            })
            .unwrap_or(Value::Null)
    };
    let mut rotation = options
        .get("rotation_mode")
        .filter(|_| !raw)
        .cloned()
        .unwrap_or_else(|| {
            if payload.is_object() {
                json!("default")
            } else {
                Value::Null
            }
        });
    if rotation == json!("default")
        && payload["simc_input"].as_str().is_some_and(|input| {
            input
                .lines()
                .any(|line| line.trim_start().starts_with("actions"))
        })
    {
        rotation = json!("custom");
    }
    if raw
        && globals
            .get("use_blizzard_action_list")
            .and_then(Value::as_f64)
            == Some(1.0)
    {
        rotation = if globals.get("one_button_mode").and_then(Value::as_f64) == Some(1.0) {
            json!("one_button")
        } else {
            json!("assisted_combat")
        };
    }
    // Resolved setup also supplies defaults absent from saved options.
    {
        for key in ["raid_buffs", "consumables"] {
            if let Some(value) = setup.get(key) {
                settings.insert(key.into(), value.clone());
            }
        }
    }
    let mut buffs = settings
        .remove("raid_buffs")
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    for key in settings
        .keys()
        .filter(|k| k.starts_with("override."))
        .cloned()
        .collect::<Vec<_>>()
    {
        if let Some(value) = settings.remove(&key) {
            let name = key.trim_start_matches("override.");
            if !buffs.contains_key(name) {
                let enabled = match value.as_str() {
                    Some("1" | "true") => Some(true),
                    Some("0" | "false") => Some(false),
                    _ => value.as_bool(),
                };
                if let Some(enabled) = enabled {
                    buffs.insert(name.into(), json!(enabled));
                }
            }
        }
    }
    if !buffs.is_empty() {
        settings.insert("raid_buffs".into(), json!(buffs));
    }
    let mut consumables = settings
        .remove("consumables")
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    for (directive, slot) in [
        ("flask", "flask"),
        ("potion", "potion"),
        ("food", "food"),
        ("augmentation", "augmentation"),
        ("temporary_enchant", "weapon_rune"),
    ] {
        if let Some(value) = settings.remove(directive) {
            consumables
                .entry(slot)
                .or_insert_with(|| match value.as_str() {
                    Some("disabled" | "none" | "") => Value::Null,
                    _ => json!({"value":value}),
                });
        }
    }
    if !consumables.is_empty() {
        settings.insert("consumables".into(), json!(consumables));
    }
    let revision = result
        .get("simc_git_revision")
        .cloned()
        .unwrap_or(Value::Null);
    let baseline = result.get("base_dps").cloned().unwrap_or(Value::Null);
    let variation = if choose("vary_combat_length").is_null() {
        settings
            .get("vary_combat_length")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<f64>().ok())
            .map(|v| json!(v))
            .unwrap_or(Value::Null)
    } else {
        choose("vary_combat_length")
    };
    let settings: Map<String, Value> = settings.into_iter().collect();
    json!({"fight_style": choose("fight_style"), "actual_iterations": result.get("iterations"), "achieved_error_pct": result.get("dps_error_pct"), "targets": choose("desired_targets"), "duration": choose("max_time"),
        "variation": variation, "rotation": rotation,
        "settings": settings, "simc_revision": revision, "baseline_dps": baseline,
        "baseline_error_pct": result.get("dps_error_pct"), "target_error": result.get("target_error")})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extracts_saved_scenario_without_exposing_profile_or_execution_settings() {
        let request = Some(json!({"payload":{"simc_input":"shaman=\"Test\"\nhead=id=123\nflask=one\noverride.bloodlust=0\n# potion=ignored\n", "options":{"desired_targets":7,"max_time":300,"rotation_mode":"assisted_combat","threads":16,"target_error":0.1}}}).to_string());
        let result = Some(json!({"base_dps":100,"simc_git_revision":"abc"}).to_string());
        let v = extract(&request, &result);
        assert_eq!(v["targets"], 7);
        assert_eq!(v["rotation"], "assisted_combat");
        assert_eq!(v["settings"]["raid_buffs"]["bloodlust"], false);
        assert!(v["settings"].get("head").is_none());
        assert!(v["settings"].get("threads").is_none());
        assert!(v["variation"].is_null());
    }
    #[test]
    fn missing_historical_settings_stay_unknown() {
        let v = extract(&None, &Some(json!({"setup":{"desired_targets":10,"max_time":300,"raid_buffs":{"bloodlust":true}}}).to_string()));
        assert_eq!(v["targets"], 10);
        assert!(v["rotation"].is_null());
        assert_eq!(v["settings"]["raid_buffs"]["bloodlust"], true);
    }
    #[test]
    fn raw_run_uses_report_or_input_not_form_defaults_and_resolves_duplicate_buffs() {
        let request = Some(json!({"payload":{"raw":true,"simc_input":"fight_style=DungeonSlice\nmax_time=360\noverride.bloodlust=1\nflask=disabled\ntemporary_enchant=\n", "options":{"fight_style":"Patchwerk","max_time":300}}}).to_string());
        let result = Some(json!({"setup":{"fight_style":"DungeonSlice","max_time":360,"raid_buffs":{"bloodlust":true},"consumables":{"flask":null,"weapon_rune":{"value":"oil"}}},"dps_error_pct":0.17,"target_error":0,"iterations":4999}).to_string());
        let v = extract(&request, &result);
        assert_eq!(v["fight_style"], "DungeonSlice");
        assert_eq!(v["duration"], 360);
        assert_eq!(v["settings"]["raid_buffs"]["bloodlust"], true);
        assert!(v["settings"].get("override.bloodlust").is_none());
        assert_eq!(v["settings"]["consumables"]["weapon_rune"]["value"], "oil");
        assert_eq!(extract(&request, &None)["duration"], 360.0);
    }
}
