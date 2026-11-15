//! The machine's pi model configuration: `models.json` (providers and their
//! models) gated by `auth.json` (which providers carry credentials), read
//! from pi's agent dir (`PI_CODING_AGENT_DIR`, else `~/.pi/agent`).
//!
//! This is the **single model source for both harnesses' pickers** (user
//! ruling, 2026-11-13): the manox harness does not use its cx provider
//! config for model selection here — whatever pi would offer is the list.
//! A read-only, synchronous snapshot; pi itself stays the authority (this
//! file is exactly what `pi --list-models` serves from).

use std::path::PathBuf;

use nsh_core::prelude::*;
use serde::Deserialize;

const ERR_HOME: &str = "ERR_MODELS_HOME";
const ERR_READ: &str = "ERR_MODELS_READ";
const ERR_PARSE: &str = "ERR_MODELS_PARSE";

/// One model of a provider, as pi's `models.json` describes it.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct PiModelInfo {
    /// The model id within its provider (`qwen3.8-max`).
    pub id: String,
    /// The display name (`Qwen3.8 Max (1M)`).
    pub name: String,
    /// The context window in tokens, when the config states one.
    pub context_window: Option<u64>,
}

/// One provider and its models.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct PiProvider {
    /// The provider id (`bailian`) — the auth.json key namespace.
    pub id: String,
    /// The display name (`百炼`).
    pub name: String,
    /// Whether auth.json carries credentials for this provider: pi serves
    /// its models only then, so the picker marks the rest.
    pub has_auth: bool,
    /// pi's wire api for this provider (`anthropic-messages`), when stated —
    /// the manox bridge maps it onto the kernel's endpoint wire keys.
    pub api: Option<String>,
    pub models: Vec<PiModelInfo>,
}

#[derive(Default, Deserialize)]
struct ModelsDoc {
    #[serde(default)]
    providers: serde_json::Map<String, serde_json::Value>,
}

fn agent_dir() -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("PI_CODING_AGENT_DIR") {
        return Ok(PathBuf::from(dir));
    }
    let home =
        std::env::var_os("HOME").ok_or_else(|| err(ERR_HOME, "no HOME to find pi's agent dir"))?;
    Ok(PathBuf::from(home).join(".pi/agent"))
}

fn err(code: &str, message: impl Into<String>) -> String {
    format!("{code}: {}", message.into())
}

/// The machine's pi model configuration, as `list` serves it.
#[module]
pub struct PiModels;

#[module]
impl PiModels {
    /// The providers and models of the machine's pi configuration, providers
    /// with credentials first, each newest-listed order preserved.
    pub async fn list() -> Result<Vec<PiProvider>, String> {
        list_at(&agent_dir()?)
    }
}

/// The synchronous core, so tests can point at a fixture dir directly.
fn list_at(dir: &std::path::Path) -> Result<Vec<PiProvider>, String> {
    let doc: ModelsDoc = serde_json::from_str(
        &std::fs::read_to_string(dir.join("models.json"))
            .map_err(|e| err(ERR_READ, format!("models.json: {e}")))?,
    )
    .map_err(|e| err(ERR_PARSE, format!("models.json: {e}")))?;
    let auth: serde_json::Map<String, serde_json::Value> =
        std::fs::read_to_string(dir.join("auth.json"))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
    let mut providers = Vec::new();
    for (id, value) in doc.providers {
        let Ok(entry) = serde_json::from_value::<ProviderDoc>(value.clone()) else {
            continue; // one malformed provider must not hide the rest
        };
        let models = entry
            .models
            .unwrap_or_default()
            .into_iter()
            .map(|model| PiModelInfo {
                name: model.name.unwrap_or_else(|| model.id.clone()),
                id: model.id,
                context_window: model.context_window,
            })
            .collect();
        providers.push(PiProvider {
            api: entry.api,
            has_auth: auth.contains_key(&id),
            id,
            name: entry.name.unwrap_or_default(),
            models,
        });
    }
    providers.sort_by_key(|provider| !provider.has_auth);
    Ok(providers)
}

#[derive(Deserialize)]
struct ProviderDoc {
    name: Option<String>,
    api: Option<String>,
    models: Option<Vec<ModelDoc>>,
}

#[derive(Deserialize)]
struct ModelDoc {
    id: String,
    name: Option<String>,
    context_window: Option<u64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn models_doc_parses_the_pi_shape() {
        let doc: ModelsDoc = serde_json::from_str(
            r#"{"providers": {"bailian": {"name": "百炼", "models": [
                {"id": "qwen3.8-max", "name": "Qwen3.8 Max", "contextWindow": 1000000}
            ]}}}"#,
        )
        .unwrap();
        assert_eq!(doc.providers.len(), 1);
    }

    #[test]
    fn a_missing_agent_dir_is_a_coded_error_not_a_panic() {
        let error = list_at(std::path::Path::new("/nonexistent-zu-test")).unwrap_err();
        assert!(error.starts_with(ERR_READ), "{error}");
    }

    #[test]
    fn auth_gates_and_orders_the_providers() {
        let dir = std::env::temp_dir().join("zu-pimodels-test");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("models.json"),
            r#"{"providers": {
                "none": {"name": "No Auth", "models": [{"id": "x"}]},
                "bailian": {"name": "百炼", "models": [{"id": "qwen3.8-max", "name": "Qwen3.8 Max", "contextWindow": 1000000}]}
            }}"#,
        )
        .unwrap();
        std::fs::write(dir.join("auth.json"), r#"{"bailian": {}}"#).unwrap();
        let providers = list_at(&dir).unwrap();
        assert_eq!(providers.len(), 2);
        assert_eq!(providers[0].id, "bailian");
        assert!(providers[0].has_auth);
        assert!(!providers[1].has_auth);
        assert_eq!(providers[0].models[0].name, "Qwen3.8 Max");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
