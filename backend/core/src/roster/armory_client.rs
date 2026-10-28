use secrecy::{ExposeSecret, SecretString};
use serde_json::Value;

/// Forward only item-specific data. Never attach a newer snapshot to a
/// different item from the proxy's cached character profile.
fn merge_equipment(armory: &mut Value, equipment: &Value) -> Result<(), ArmoryError> {
    let equipped = equipment
        .get("equipped_items")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            ArmoryError::Http("Blizzard equipment response is missing equipped_items".into())
        })?;
    let items = armory
        .get_mut("gear")
        .and_then(|g| g.get_mut("items"))
        .and_then(Value::as_array_mut)
        .ok_or_else(|| ArmoryError::Http("Armory response is missing gear items".into()))?;
    for item in items {
        let Some(slot) = item.get("slot").and_then(Value::as_str) else {
            continue;
        };
        if matches!(slot, "SHIRT" | "TABARD") {
            continue;
        }
        let raw = equipped.iter().find(|raw| raw.pointer("/slot/type").and_then(Value::as_str) == Some(slot))
            .ok_or_else(|| ArmoryError::Http("Armory gear changed while importing. Retry after the cached profile refreshes.".into()))?;
        let sorted = |v: Option<&Value>| {
            let mut ids: Vec<u64> = v
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_u64)
                .collect();
            ids.sort_unstable();
            ids
        };
        if item.get("itemId").and_then(Value::as_u64)
            != raw.pointer("/item/id").and_then(Value::as_u64)
            || item.get("itemLevel").and_then(Value::as_u64)
                != raw.pointer("/level/value").and_then(Value::as_u64)
            || sorted(item.get("bonusIds")) != sorted(raw.get("bonus_list"))
        {
            return Err(ArmoryError::Http(
                "Armory gear changed while importing. Retry after the cached profile refreshes."
                    .into(),
            ));
        }
        for key in ["stats", "modified_crafting_stat"] {
            if let Some(value) = raw.get(key) {
                item[key] = value.clone();
            }
        }
    }
    Ok(())
}

#[derive(Debug)]
pub enum ArmoryError {
    NotFound,
    Http(String),
}

#[async_trait::async_trait]
pub trait ArmoryClient: Send + Sync {
    /// Fetch the simhammer.com `/armory` payload (character + gear + talents) for
    /// one character. The shape is SimHammer's own, not raw Blizzard JSON.
    async fn fetch(&self, region: &str, realm: &str, name: &str) -> Result<Value, ArmoryError>;
}

/// Blizzard realm slug: lowercase, spaces/apostrophes -> hyphens.
pub fn realm_slug(realm: &str) -> String {
    realm.trim().to_lowercase().replace([' ', '\''], "-")
}

pub struct HttpArmoryClient {
    http: reqwest::Client,
    base: String,
}

impl HttpArmoryClient {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        // Mirror the app's shared client timeouts so a slow/hung proxy can't
        // stall the (sequential) import loop indefinitely.
        let http = reqwest::Client::builder()
            .user_agent(concat!("simhammer/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap_or_default();
        Self {
            http,
            base: "https://simhammer.com".to_string(),
        }
    }

    async fn get_json(&self, url: &str) -> Result<Value, ArmoryError> {
        let resp = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|e| ArmoryError::Http(e.to_string()))?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(ArmoryError::NotFound);
        }
        if !resp.status().is_success() {
            return Err(ArmoryError::Http(format!("status {}", resp.status())));
        }
        resp.json::<Value>()
            .await
            .map_err(|e| ArmoryError::Http(e.to_string()))
    }

    /// Optional server-owned credentials let self-hosted installs retrieve the
    /// equipment fields the public proxy currently strips. No user login and
    /// no credentials in the browser, profile text, or query strings.
    async fn equipment(
        &self,
        region: &str,
        realm: &str,
        name: &str,
    ) -> Result<Option<Value>, ArmoryError> {
        let client_id = std::env::var("BLIZZARD_CLIENT_ID")
            .ok()
            .filter(|s| !s.trim().is_empty());
        let secret_file = std::env::var("BLIZZARD_CLIENT_SECRET_FILE")
            .ok()
            .filter(|s| !s.is_empty());
        let secret = if let Some(path) = secret_file {
            Some(
                std::fs::read_to_string(path)
                    .map_err(|_| {
                        ArmoryError::Http("Cannot read Blizzard client secret file".into())
                    })?
                    .trim()
                    .to_string(),
            )
        } else {
            std::env::var("BLIZZARD_CLIENT_SECRET")
                .ok()
                .filter(|s| !s.is_empty())
        };
        let (client_id, secret) = match (client_id, secret) {
            (None, None) => return Ok(None),
            (Some(id), Some(secret)) if !secret.is_empty() => (id, SecretString::from(secret)),
            _ => {
                return Err(ArmoryError::Http(
                    "Configure both BLIZZARD_CLIENT_ID and a Blizzard client secret".into(),
                ))
            }
        };
        if !matches!(region, "eu" | "us" | "kr" | "tw") {
            return Err(ArmoryError::Http("Unsupported Blizzard region".into()));
        }
        let token_response = self
            .http
            .post("https://oauth.battle.net/token")
            .basic_auth(client_id, Some(secret.expose_secret()))
            .form(&[("grant_type", "client_credentials")])
            .send()
            .await
            .map_err(|_| ArmoryError::Http("Blizzard authentication request failed".into()))?;
        if !token_response.status().is_success() {
            return Err(ArmoryError::Http(format!(
                "Blizzard authentication returned status {}",
                token_response.status()
            )));
        }
        let token_json: Value = token_response
            .json()
            .await
            .map_err(|_| ArmoryError::Http("Invalid Blizzard authentication response".into()))?;
        let token = token_json
            .get("access_token")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                ArmoryError::Http("Blizzard authentication response has no access token".into())
            })?;
        let mut url = reqwest::Url::parse(&format!("https://{region}.api.blizzard.com"))
            .map_err(|_| ArmoryError::Http("Invalid Blizzard API URL".into()))?;
        url.path_segments_mut()
            .map_err(|_| ArmoryError::Http("Invalid Blizzard API URL".into()))?
            .extend(["profile", "wow", "character", realm, name, "equipment"]);
        let response = self
            .http
            .get(url)
            .bearer_auth(token)
            .query(&[
                ("namespace", format!("profile-{region}")),
                ("locale", "en_US".into()),
            ])
            .send()
            .await
            .map_err(|_| ArmoryError::Http("Blizzard equipment request failed".into()))?;
        if !response.status().is_success() {
            return Err(ArmoryError::Http(format!(
                "Blizzard equipment returned status {}",
                response.status()
            )));
        }
        response
            .json::<Value>()
            .await
            .map(Some)
            .map_err(|_| ArmoryError::Http("Invalid Blizzard equipment response".into()))
    }
}

#[async_trait::async_trait]
impl ArmoryClient for HttpArmoryClient {
    async fn fetch(&self, region: &str, realm: &str, name: &str) -> Result<Value, ArmoryError> {
        let slug = realm_slug(realm);
        let name_l = name.trim().to_lowercase();
        let url = format!(
            "{}/api/blizzard/character/{}/{}/{}/armory",
            self.base, region, slug, name_l
        );
        let mut armory = self.get_json(&url).await?;
        if let Some(equipment) = self.equipment(region, &slug, &name_l).await? {
            merge_equipment(&mut armory, &equipment)?;
        }
        Ok(armory)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn equipment_stats_merge_only_into_the_matching_snapshot() {
        let mut armory = json!({"gear":{"items":[{
            "slot":"HEAD","itemId":271456,"itemLevel":334,"bonusIds":[2,1]
        }]}});
        let equipment = json!({"equipped_items":[{
            "slot":{"type":"HEAD"},"item":{"id":271456},"level":{"value":334},"bonus_list":[1,2],
            "stats":[{"type":{"type":"HASTE_RATING"},"value":60},{"type":{"type":"MASTERY_RATING"},"value":141}],
            "modified_crafting_stat":[{"id":36},{"id":49}]
        }]});
        merge_equipment(&mut armory, &equipment).unwrap();
        assert_eq!(
            armory["gear"]["items"][0]["stats"],
            equipment["equipped_items"][0]["stats"]
        );
        assert_eq!(
            armory["gear"]["items"][0]["modified_crafting_stat"],
            json!([{"id":36},{"id":49}])
        );
        let mut changed = equipment.clone();
        changed["equipped_items"][0]["item"]["id"] = json!(42);
        assert!(merge_equipment(&mut armory, &changed).is_err());
        changed = equipment.clone();
        changed["equipped_items"][0]["level"]["value"] = json!(337);
        assert!(merge_equipment(&mut armory, &changed).is_err());
        changed = equipment;
        changed["equipped_items"][0]["bonus_list"] = json!([3]);
        assert!(merge_equipment(&mut armory, &changed).is_err());
    }

    #[test]
    fn slugifies_realm() {
        assert_eq!(realm_slug("Tarren Mill"), "tarren-mill");
        assert_eq!(realm_slug("Lightbringer"), "lightbringer");
        assert_eq!(realm_slug("Quel'Thalas"), "quel-thalas");
    }
}
