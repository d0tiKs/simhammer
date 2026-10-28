//! Low-level helpers for reading and mutating SimulationCraft gear lines.
//!
//! These operate on the value portion of a simc gear directive (the text after
//! `slot=`). They don't depend on the game-data tables, so both `item_db` and
//! `profileset_generator` can use them without circular imports.

use once_cell::sync::Lazy;
use regex::Regex;

static ENCHANT_ID_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"enchant_id=\d+").unwrap());
static ENCHANT_ID_CAPTURE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"enchant_id=(\d+)").unwrap());
// `gem_id` can hold a slash-separated list for multi-socket items
// (e.g. `gem_id=213470/213470` for a 2-socket neck). All regex/capture
// helpers below accept the multi-value form; single-value is just the
// length-1 case.
static GEM_ID_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"gem_id=[\d/]+").unwrap());
static GEM_ID_CAPTURE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"gem_id=([\d/]+)").unwrap());
static ITEM_ID_CAPTURE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"id=(\d+)").unwrap());
static AFTER_ITEM_ID_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(,id=\d+)").unwrap());
static BONUS_ID_CAPTURE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"bonus_id=([0-9/:]+)").unwrap());
static STRIP_GEM_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r",?gem_id=[\d/]+").unwrap());
static STRIP_ENCHANT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r",?enchant_id=\d+").unwrap());
static REDIRECTED_BASE_STATS_CAPTURE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"redirected_base_stats=(\d+)").unwrap());

/// Replace the existing `enchant_id=N` if present, otherwise insert one right after `,id=N`.
pub fn set_enchant_id(simc: &str, enchant_id: u64) -> String {
    if ENCHANT_ID_RE.is_match(simc) {
        ENCHANT_ID_RE
            .replace(simc, &format!("enchant_id={}", enchant_id))
            .to_string()
    } else {
        AFTER_ITEM_ID_RE
            .replace(simc, &format!("$1,enchant_id={}", enchant_id))
            .to_string()
    }
}

/// Replace the existing `gem_id=…` if present, otherwise insert one right after `,id=N`.
/// Convenience wrapper around `set_gem_ids` for the common single-socket case.
pub fn set_gem_id(simc: &str, gem_id: u64) -> String {
    set_gem_ids(simc, &[gem_id])
}

/// Join ids the way simc lists them: `a/b/c`. Shared by every `,x_id=` field.
pub fn join_ids(ids: &[u64]) -> String {
    ids.iter().map(u64::to_string).collect::<Vec<_>>().join("/")
}

/// Replace the existing `gem_id=…` with a slash-separated list, or insert one
/// right after `,id=N`. An empty slice strips any existing `gem_id` (use
/// `strip_gem_id` directly if that's all you want).
pub fn set_gem_ids(simc: &str, gem_ids: &[u64]) -> String {
    if gem_ids.is_empty() {
        return strip_gem_id(simc);
    }
    let joined = join_ids(gem_ids);
    if GEM_ID_RE.is_match(simc) {
        GEM_ID_RE
            .replace(simc, &format!("gem_id={}", joined))
            .to_string()
    } else {
        AFTER_ITEM_ID_RE
            .replace(simc, &format!("$1,gem_id={}", joined))
            .to_string()
    }
}

/// Strip any existing `gem_id=…` from a simc gear line (leading comma included).
pub fn strip_gem_id(simc: &str) -> String {
    STRIP_GEM_RE.replace(simc, "").to_string()
}

/// Strip any existing `enchant_id=N` from a simc gear line (leading comma included).
pub fn strip_enchant_id(simc: &str) -> String {
    STRIP_ENCHANT_RE.replace(simc, "").to_string()
}

pub fn extract_enchant_id(simc: &str) -> u64 {
    ENCHANT_ID_CAPTURE_RE
        .captures(simc)
        .and_then(|c| c[1].parse().ok())
        .unwrap_or(0)
}

/// Return the first gem id, or 0 if none. For a multi-socket line like
/// `gem_id=A/B` this returns `A` — sufficient for the binary "is any socket
/// filled" checks scattered through the generator. Use `extract_gem_ids`
/// when the full list matters.
pub fn extract_gem_id(simc: &str) -> u64 {
    extract_gem_ids(simc).into_iter().next().unwrap_or(0)
}

/// Return every gem id from a `gem_id=A/B/...` value. Empty Vec when no
/// `gem_id` is present.
pub fn extract_gem_ids(simc: &str) -> Vec<u64> {
    GEM_ID_CAPTURE_RE
        .captures(simc)
        .map(|c| c[1].split('/').filter_map(|s| s.parse().ok()).collect())
        .unwrap_or_default()
}

pub fn extract_item_id(simc: &str) -> u64 {
    ITEM_ID_CAPTURE_RE
        .captures(simc)
        .and_then(|c| c[1].parse().ok())
        .unwrap_or(0)
}

/// Parse the comma- or slash-separated bonus_id list from a simc gear line.
/// Returns an empty Vec when no `bonus_id=` is present.
pub fn extract_bonus_ids(simc: &str) -> Vec<u64> {
    BONUS_ID_CAPTURE_RE
        .captures(simc)
        .map(|c| {
            c[1].split(&['/', ':'][..])
                .filter_map(|s| s.parse().ok())
                .collect()
        })
        .unwrap_or_default()
}

/// Extract source item id from `redirected_base_stats=<id>`.
/// Returns 0 if none.
pub fn extract_redirected_base_stats(simc: &str) -> u64 {
    REDIRECTED_BASE_STATS_CAPTURE_RE
        .captures(simc)
        .and_then(|c| c[1].parse().ok())
        .unwrap_or(0)
}

/// Exact option lookup: `stats` must not match `crafted_stats` or
/// `redirected_base_stats`.
pub fn item_option<'a>(simc: &'a str, key: &str) -> Option<&'a str> {
    simc.split(',').find_map(|part| {
        let (name, value) = part.trim().split_once('=')?;
        (name == key).then_some(value)
    })
}

/// Distinguish two catalyst snapshots whose item and bonus ids are identical
/// but whose retained secondary allocations differ. Order is not identity.
pub fn item_stats_suffix(simc: &str) -> String {
    let Some(stats) = item_option(simc, "stats").filter(|s| !s.is_empty()) else {
        return String::new();
    };
    let mut tokens: Vec<&str> = stats.trim().split('_').collect();
    tokens.sort_unstable();
    format!(":stats:{}", tokens.join("_"))
}

/// Preserve the equipped allocation when changing item level. Explicit stats
/// override the item database, so changing bonus ids alone leaves them frozen.
/// Use SimC's documented manual-stat fallback coefficient (1.15 per 15 ilvls),
/// including its floor rounding. This is approximate, as in SimC, not a fresh
/// Blizzard item-stat snapshot. Gems and enchants are separate and never scaled.
pub fn rescale_item_stats(simc: &str, old_level: u64, new_level: u64) -> String {
    if old_level == 0
        || new_level == 0
        || old_level == new_level
        || item_option(simc, "stats").is_none()
    {
        return simc.to_string();
    }
    let coefficient = 1.15_f64.powf((new_level as f64 - old_level as f64) / 15.0);
    simc.split(',')
        .map(|part| {
            if let Some(value) = part.strip_prefix("stats=") {
                let scaled = value
                    .split('_')
                    .map(|stat| {
                        let end = stat
                            .find(|c: char| !c.is_ascii_digit())
                            .unwrap_or(stat.len());
                        let (amount, name) = stat.split_at(end);
                        // SimC does not scale corruption and corruption resistance.
                        if name.is_empty() || matches!(name, "corruption" | "corruption_resistance")
                        {
                            return stat.to_string();
                        }
                        match amount.parse::<u64>() {
                            Ok(n) => format!("{}{name}", (n as f64 * coefficient).floor() as u64),
                            Err(_) => stat.to_string(),
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("_");
                format!("stats={scaled}")
            } else if part.starts_with("ilevel=") || part.starts_with("ilvl=") {
                format!("ilevel={new_level}")
            } else {
                part.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(",")
}

#[cfg(test)]
mod gem_tests {
    use super::*;

    #[test]
    fn explicit_stats_scale_with_level_without_touching_gems_or_enchants() {
        let s = ",id=271456,ilevel=300,stats=100str_200sta_60haste_141mastery,enchant_id=8017,gem_id=1/2,crafted_stats=36/49,redirected_base_stats=251199";
        let scaled = rescale_item_stats(s, 300, 315);
        assert!(scaled.contains("ilevel=315"));
        assert!(
            scaled.contains("stats=114str_229sta_69haste_162mastery"),
            "{scaled}"
        );
        assert!(scaled.contains(
            "enchant_id=8017,gem_id=1/2,crafted_stats=36/49,redirected_base_stats=251199"
        ));
        assert_eq!(rescale_item_stats(s, 300, 300), s);
        assert_eq!(rescale_item_stats(s, 0, 315), s);
        let no_stats = ",id=100,crafted_stats=36/49,redirected_base_stats=251199";
        assert_eq!(rescale_item_stats(no_stats, 300, 315), no_stats);
    }

    #[test]
    fn set_gem_ids_emits_slash_separated_for_multi() {
        let s = ",id=100,bonus_id=12";
        assert_eq!(
            set_gem_ids(s, &[111, 222]),
            ",id=100,gem_id=111/222,bonus_id=12"
        );
    }

    #[test]
    fn set_gem_ids_replaces_existing_multi() {
        let s = ",id=100,gem_id=999/888,bonus_id=12";
        assert_eq!(
            set_gem_ids(s, &[111, 222]),
            ",id=100,gem_id=111/222,bonus_id=12"
        );
    }

    #[test]
    fn set_gem_ids_replaces_existing_single_with_multi() {
        let s = ",id=100,gem_id=999,bonus_id=12";
        assert_eq!(
            set_gem_ids(s, &[111, 222]),
            ",id=100,gem_id=111/222,bonus_id=12"
        );
    }

    #[test]
    fn set_gem_ids_empty_strips() {
        let s = ",id=100,gem_id=111/222,bonus_id=12";
        assert_eq!(set_gem_ids(s, &[]), ",id=100,bonus_id=12");
    }

    #[test]
    fn extract_gem_ids_parses_slash_list() {
        assert_eq!(
            extract_gem_ids(",id=100,gem_id=111/222/333"),
            vec![111, 222, 333]
        );
    }

    #[test]
    fn extract_gem_ids_returns_empty_when_no_gem() {
        assert!(extract_gem_ids(",id=100").is_empty());
    }

    #[test]
    fn extract_gem_id_returns_first_of_multi() {
        // Compat: legacy callers using single-valued extract still see a
        // non-zero answer when the line has any gem at all.
        assert_eq!(extract_gem_id(",id=100,gem_id=111/222"), 111);
    }

    #[test]
    fn strip_gem_id_handles_multi() {
        let s = ",id=100,gem_id=111/222,bonus_id=12";
        assert_eq!(strip_gem_id(s), ",id=100,bonus_id=12");
    }

    #[test]
    fn strip_enchant_id_removes_with_leading_comma() {
        let s = ",id=100,enchant_id=7449,bonus_id=12";
        assert_eq!(strip_enchant_id(s), ",id=100,bonus_id=12");
    }

    #[test]
    fn strip_enchant_id_noop_when_absent() {
        let s = ",id=100,bonus_id=12";
        assert_eq!(strip_enchant_id(s), ",id=100,bonus_id=12");
    }

    #[test]
    fn extract_redirected_base_stats_parses_source_id() {
        assert_eq!(
            extract_redirected_base_stats(",id=250045,bonus_id=123,redirected_base_stats=249629"),
            249629
        );
        assert_eq!(extract_redirected_base_stats(",id=250045,bonus_id=123"), 0);
    }
}
