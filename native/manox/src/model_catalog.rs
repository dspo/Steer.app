//! The host-owned pi model catalogue: one directory builder feeds both the
//! registration YAML and the UI's model menu, so "selectable" and
//! "registered" are the same fact (issue #55).
//!
//! Sources, all under `PI_CODING_AGENT_DIR` (else `~/.pi/agent`):
//! - `models.json` — the user's explicit provider entries, highest priority;
//! - `models-store.json` — pi's cached definitions, filling providers/models
//!   `models.json` does not declare;
//! - `auth.json` — only `type: api_key` providers are bridgeable. OAuth
//!   providers are not registered (manox cannot refresh their tokens) and
//!   therefore never appear in the directory.
//!
//! Nothing here is a pin or an upstream dependency: it is this host's read
//! of files that already exist on the developer's machine.

use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// A model the host can actually call, with a canonical registration ref.
#[derive(Debug, Clone, Default, PartialEq, nsh_core::prelude::JsObject)]
pub struct CatalogModel {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub reference: String,
    pub context_window: f64,
    pub max_tokens: f64,
    pub reasoning: bool,
    /// The reasoning efforts the host runtime can write today (`high|max`).
    pub efforts: Vec<String>,
}

/// A provider group of the host's model directory.
#[derive(Debug, Clone, Default, PartialEq, nsh_core::prelude::JsObject)]
pub struct CatalogProvider {
    pub id: String,
    pub name: String,
    pub models: Vec<CatalogModel>,
}

/// The whole directory: only providers with a bridgeable api key and at
/// least one callable model are present.
#[derive(Debug, Clone, Default, PartialEq, nsh_core::prelude::JsObject)]
pub struct ModelCatalog {
    pub providers: Vec<CatalogProvider>,
}

/// A test-only catalogue root. The app never sets it; the hermetic gate
/// points the host at a fixture agent dir so registration and the menu read
/// one deterministic snapshot (the same seam as `state.setAgentDir`).
static CATALOG_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

/// The catalogue the boot registered. The menu serves this exact snapshot:
/// AHP fixes a session's provider registry at creation, so a later file
/// change is a new-session/restart fact, never a live-session one.
static BOOT_CATALOG: Mutex<Option<ModelCatalog>> = Mutex::new(None);

/// Points the catalogue at `dir`; `None` restores the env/HOME lookup.
pub fn set_catalog_dir(dir: Option<PathBuf>) {
    if let Ok(mut slot) = CATALOG_DIR.lock() {
        *slot = dir;
    }
}

/// The boot snapshot the menu reads, when the boot registered one.
pub(crate) fn boot_catalog() -> Option<ModelCatalog> {
    BOOT_CATALOG.lock().ok().and_then(|slot| slot.clone())
}

/// The file root pi reads; an `Option` because a process without HOME has
/// no pi config to bridge.
pub fn pi_catalog_dir() -> Option<PathBuf> {
    if let Some(dir) = CATALOG_DIR.lock().ok().and_then(|dir| dir.clone()) {
        return Some(dir);
    }
    std::env::var_os("PI_CODING_AGENT_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".pi/agent")))
}

fn read_json(path: PathBuf) -> Option<Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Explicit entries in `models.json` win; `models-store.json` supplies only
/// the providers and models the explicit file does not declare.
fn providers_from(dir: &Path) -> Option<(Value, Value, Value)> {
    let explicit = read_json(dir.join("models.json"));
    let store = read_json(dir.join("models-store.json"));
    let auth = read_json(dir.join("auth.json")).unwrap_or(Value::Null);
    if explicit.is_none() && store.is_none() {
        return None;
    }
    Some((
        explicit.unwrap_or(Value::Null),
        store.unwrap_or(Value::Null),
        auth,
    ))
}

/// pi's `api` vocabulary onto the cx endpoint wire keys. The order is the
/// cx wire priority: when a model declares several wires, the first wins
/// for its canonical ref.
pub fn wire_key(api: &str) -> Option<&'static str> {
    match api {
        "anthropic-messages" | "anthropic" => Some("anthropic"),
        "openai-responses" | "responses" => Some("responses"),
        "openai-completions" | "openai-chat" | "completions" => Some("completions"),
        _ => None,
    }
}

fn wire_priority(wire: &str) -> u8 {
    match wire {
        "anthropic" => 0,
        "responses" => 1,
        "completions" => 2,
        _ => 3,
    }
}

/// One model definition as pi stores it, with its provider-level fallback.
#[derive(Clone)]
struct ModelSpec {
    id: String,
    name: String,
    api: Option<String>,
    base: Option<String>,
    context: Option<u64>,
    max: Option<u64>,
    reasoning: bool,
}

/// Collects a provider's models from one JSON document's `providers` map.
/// `explicit` marks the primary file: its entries override the store's,
/// and a model declared there with no `api` still uses the provider's wire.
fn collect_models(doc: &Value, provider: &str, out: &mut BTreeMap<String, ModelSpec>) {
    let entry = if let Some(entry) = doc.get("providers").and_then(|p| p.get(provider)) {
        entry
    } else if let Some(providers) = doc.as_array().and_then(|rows| {
        rows.iter()
            .find(|row| row.get("id").and_then(Value::as_str) == Some(provider))
    }) {
        providers
    } else {
        // A provider object nested under a top-level provider id (the
        // models-store layout) is readable without a `providers` wrapper.
        doc.get(provider).unwrap_or(&Value::Null)
    };
    if entry.is_null() {
        return;
    }
    let api = entry.get("api").and_then(Value::as_str).map(str::to_owned);
    let base = entry
        .get("baseUrl")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let Some(models) = entry.get("models").and_then(Value::as_array) else {
        return;
    };
    for model in models {
        let Some(id) = model.get("id").and_then(Value::as_str) else {
            continue;
        };
        let spec = ModelSpec {
            id: id.to_owned(),
            name: model
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(id)
                .to_owned(),
            api: model
                .get("api")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| api.clone()),
            base: model
                .get("baseUrl")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| base.clone()),
            context: model
                .get("contextWindow")
                .and_then(Value::as_u64)
                .or_else(|| model.get("context_window").and_then(Value::as_u64))
                .or_else(|| entry.get("contextWindow").and_then(Value::as_u64)),
            max: model
                .get("maxTokens")
                .and_then(Value::as_u64)
                .or_else(|| model.get("max_tokens").and_then(Value::as_u64))
                .or_else(|| entry.get("maxTokens").and_then(Value::as_u64)),
            reasoning: model
                .get("reasoning")
                .and_then(Value::as_bool)
                .or_else(|| entry.get("reasoning").and_then(Value::as_bool))
                .unwrap_or(false),
        };
        // Explicit file wins wholesale for a model id it declares.
        out.entry(spec.id.clone()).or_insert(spec);
    }
}

/// A provider's display name from the explicit file (or a store row that
/// carries one), falling back to its id.
fn provider_name(explicit: &Value, store: &Value, id: &str) -> String {
    for doc in [explicit, store] {
        let entry = doc
            .get("providers")
            .and_then(|p| p.get(id))
            .unwrap_or(&Value::Null);
        if let Some(name) = entry.get("name").and_then(Value::as_str) {
            return name.to_owned();
        }
        if let Some(rows) = doc.as_array()
            && let Some(row) = rows
                .iter()
                .find(|row| row.get("id").and_then(Value::as_str) == Some(id))
            && let Some(name) = row.get("name").and_then(Value::as_str)
        {
            return name.to_owned();
        }
    }
    id.to_owned()
}

/// Every provider id named by either source file.
fn provider_ids(explicit: &Value, store: &Value) -> Vec<String> {
    let mut ids: BTreeMap<String, ()> = BTreeMap::new();
    for doc in [explicit, store] {
        if let Some(providers) = doc.get("providers").and_then(Value::as_object) {
            for id in providers.keys() {
                ids.insert(id.clone(), ());
            }
        } else if let Some(rows) = doc.as_array() {
            for row in rows {
                if let Some(id) = row.get("id").and_then(Value::as_str) {
                    ids.insert(id.to_owned(), ());
                }
            }
        } else if let Some(providers) = doc.as_object() {
            for id in providers.keys() {
                ids.insert(id.clone(), ());
            }
        }
    }
    ids.into_keys().collect()
}

fn api_key<'a>(auth: &'a Value, provider: &str) -> Option<&'a str> {
    auth.get(provider)
        .filter(|a| a.get("type").and_then(Value::as_str) == Some("api_key"))
        .and_then(|a| a.get("key").and_then(Value::as_str))
}

/// One provider's callable wires, from explicit entries first, store second.
/// A model-level `api`/`baseUrl` can produce more than one wire per provider.
fn wires(explicit: &Value, store: &Value, provider: &str) -> Vec<(String, String)> {
    let mut found: BTreeMap<String, String> = BTreeMap::new();
    for doc in [explicit, store] {
        let mut models = BTreeMap::new();
        collect_models(doc, provider, &mut models);
        for spec in models.values() {
            let (Some(api), Some(base)) = (spec.api.as_deref(), spec.base.as_deref()) else {
                continue;
            };
            if let Some(wire) = wire_key(api) {
                found
                    .entry(wire.to_owned())
                    .or_insert_with(|| base.to_owned());
            }
        }
    }
    let mut rows: Vec<_> = found.into_iter().collect();
    rows.sort_by_key(|a| wire_priority(&a.0));
    rows
}

/// Builds the directory: credential-filtered, deduplicated, ref-complete.
pub fn model_catalog(dir: &Path) -> Option<ModelCatalog> {
    let (explicit, store, auth) = providers_from(dir)?;
    let mut providers = Vec::new();
    for id in provider_ids(&explicit, &store) {
        let Some(secret) = api_key(&auth, &id) else {
            tracing::debug!(provider = %id, "pi provider without a bridgeable api_key: skipped");
            continue;
        };
        let wires = wires(&explicit, &store, &id);
        let Some((primary_wire, _)) = wires.first() else {
            continue;
        };
        // Store first (lower priority), explicit file second: the explicit
        // entry replaces a cached spec of the same id.
        let mut specs = BTreeMap::new();
        collect_models(&store, &id, &mut specs);
        for (key, value) in {
            let mut explicit_specs = BTreeMap::new();
            collect_models(&explicit, &id, &mut explicit_specs);
            explicit_specs
        } {
            specs.insert(key, value);
        }
        let mut models = Vec::new();
        for spec in specs.values() {
            // A model that names an api cx cannot speak is not callable, so
            // it must not acquire the provider's primary wire by fallback.
            let wire = match spec.api.as_deref() {
                Some(api) => match wire_key(api) {
                    Some(wire) => wire,
                    None => continue,
                },
                None => primary_wire.as_str(),
            };
            let reference = format!("{id}-{wire}/{}", spec.id);
            models.push(CatalogModel {
                id: spec.id.clone(),
                name: spec.name.clone(),
                provider: id.clone(),
                reference,
                context_window: spec.context.unwrap_or(0) as f64,
                max_tokens: spec.max.unwrap_or(0) as f64,
                reasoning: spec.reasoning,
                // The host runtime's mutable config subset (AHP `high|max`).
                efforts: vec!["high".to_owned(), "max".to_owned()],
            });
        }
        if models.is_empty() {
            continue;
        }
        // SAFETY: boot-time setup, before any kernel turn; the value is the
        // process's own secret, re-read by the kernel per request. The same
        // happens in `pi_providers_yaml` (idempotent for the same key).
        unsafe { std::env::set_var(format!("ZU_PI_KEY_{}", id.to_uppercase()), secret) };
        providers.push(CatalogProvider {
            id: id.clone(),
            name: provider_name(&explicit, &store, &id),
            models,
        });
    }
    (!providers.is_empty()).then_some(ModelCatalog { providers })
}

/// The cx registration YAML, generated from exactly the directory above.
/// `None` when there is nothing callable to register.
pub fn pi_providers_yaml(dir: &Path) -> Option<String> {
    let catalog = model_catalog(dir)?;
    let (explicit, store, _) = providers_from(dir)?;
    let mut yaml = String::from("providers:\n");
    for provider in &catalog.providers {
        let rows = wires(&explicit, &store, &provider.id);
        let mut models: BTreeMap<&str, &CatalogModel> = BTreeMap::new();
        for model in &provider.models {
            models.insert(model.id.as_str(), model);
        }
        yaml.push_str(&format!(
            "  - name: {}\n    apikey_source: env:ZU_PI_KEY_{}\n    endpoints:\n",
            provider.id,
            provider.id.to_uppercase()
        ));
        for (wire, base) in &rows {
            yaml.push_str(&format!("      {wire}: {base}\n"));
        }
        yaml.push_str("    models:\n");
        for (id, model) in models {
            let wire = model
                .reference
                .split_once('/')
                .and_then(|(prefix, _)| prefix.rsplit_once('-').map(|(_, wire)| wire))
                .unwrap_or_else(|| primary_wire_of(&rows));
            yaml.push_str(&format!(
                "      {id}:\n        context: {}\n        max_tokens: {}\n        wire_apis: [{wire}]\n",
                model.context_window as u64, model.max_tokens as u64
            ));
        }
    }
    Some(yaml)
}

fn primary_wire_of(rows: &[(String, String)]) -> &str {
    rows.first()
        .map(|(wire, _)| wire.as_str())
        .unwrap_or("anthropic")
}

/// Registers the directory into the kernel's provider registry and keeps the
/// same snapshot for the menu, so "listed" and "registered" are one fact for
/// every session created after boot.
pub(crate) fn register_pi_providers() {
    let Some(dir) = pi_catalog_dir() else { return };
    let Some(yaml) = pi_providers_yaml(&dir) else {
        return;
    };
    let catalog = model_catalog(&dir);
    let registry = manox_agent::provider_glue::global();
    match manox_harness::provider::register_providers_yaml(&registry, &yaml) {
        Ok(count) if count > 0 => {
            if let (Some(catalog), Ok(mut slot)) = (catalog, BOOT_CATALOG.lock()) {
                *slot = Some(catalog);
            }
            tracing::info!(
                count,
                "registered the machine's pi providers into the manox kernel"
            )
        }
        Ok(_) => {}
        Err(error) => tracing::warn!(%error, "the pi provider bridge registered nothing"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str, models: &str, store: &str, auth: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("zu-model-catalog-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("models.json"), models).unwrap();
        std::fs::write(dir.join("models-store.json"), store).unwrap();
        std::fs::write(dir.join("auth.json"), auth).unwrap();
        dir
    }

    #[test]
    fn explicit_models_win_and_store_fills_the_gaps() {
        let dir = fixture(
            "merge",
            r#"{"providers":{"bailian":{"api":"anthropic-messages","baseUrl":"https://explicit","models":[{"id":"m","contextWindow":1000}]}}}"#,
            r#"{"providers":{"bailian":{"api":"anthropic-messages","baseUrl":"https://store","models":[{"id":"m","contextWindow":1},{"id":"n","maxTokens":64}]},"opencode-go":{"api":"openai-completions","baseUrl":"https://go","models":[{"id":"g","reasoning":true}]}}}"#,
            r#"{"bailian":{"type":"api_key","key":"k"},"opencode-go":{"type":"api_key","key":"k2"},"oauth":{"type":"oauth"}}"#,
        );
        let catalog = model_catalog(&dir).unwrap();
        let bailian = catalog
            .providers
            .iter()
            .find(|p| p.id == "bailian")
            .unwrap();
        assert_eq!(bailian.models.len(), 2);
        let m = bailian.models.iter().find(|x| x.id == "m").unwrap();
        assert_eq!(m.context_window, 1000.0, "explicit definition wins");
        assert_eq!(m.reference, "bailian-anthropic/m");
        let go = catalog
            .providers
            .iter()
            .find(|p| p.id == "opencode-go")
            .unwrap();
        assert_eq!(go.models[0].reference, "opencode-go-completions/g");
        assert!(go.models[0].reasoning);
        assert!(catalog.providers.iter().all(|p| p.id != "oauth"));
        let yaml = pi_providers_yaml(&dir).unwrap();
        assert!(yaml.contains("anthropic: https://explicit"), "{yaml}");
        assert!(yaml.contains("      m:"), "{yaml}");
        assert!(!yaml.contains("opencode-go-completions/g"), "{yaml}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn store_only_and_missing_store_both_work() {
        let dir = fixture(
            "store-only",
            "{}",
            r#"{"providers":{"x":{"api":"responses","baseUrl":"https://x","models":[{"id":"r"}]}}}"#,
            r#"{"x":{"type":"api_key","key":"k"}}"#,
        );
        let catalog = model_catalog(&dir).unwrap();
        assert_eq!(catalog.providers[0].models[0].reference, "x-responses/r");
        std::fs::remove_file(dir.join("models-store.json")).unwrap();
        assert!(
            model_catalog(&dir).is_none(),
            "models.json declares no provider here"
        );
        std::fs::write(dir.join("models.json"), r#"{"providers":{"x":{"api":"responses","baseUrl":"https://x","models":[{"id":"r"}]}}}"#).unwrap();
        assert_eq!(
            model_catalog(&dir).unwrap().providers[0].models[0].reference,
            "x-responses/r"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_model_level_wire_overrides_the_provider_wire() {
        let dir = fixture(
            "model-wire",
            r#"{"providers":{"p":{"api":"anthropic-messages","baseUrl":"https://p","models":[{"id":"m","api":"openai-completions","baseUrl":"https://m"}]}}}"#,
            "{}",
            r#"{"p":{"type":"api_key","key":"k"}}"#,
        );
        let catalog = model_catalog(&dir).unwrap();
        assert_eq!(catalog.providers[0].models[0].reference, "p-completions/m");
        let yaml = pi_providers_yaml(&dir).unwrap();
        assert!(yaml.contains("completions: https://m"), "{yaml}");
        assert!(yaml.contains("      m:"), "{yaml}");
        let _ = std::fs::remove_dir_all(&dir);
    }
    #[test]
    fn a_model_with_an_unsupported_api_is_not_listed_or_registered() {
        let dir = fixture(
            "unknown-api",
            r#"{"providers":{"p":{"api":"anthropic-messages","baseUrl":"https://p","models":[{"id":"ok"},{"id":"google","api":"google-generative-ai","baseUrl":"https://g"}]}}}"#,
            "{}",
            r#"{"p":{"type":"api_key","key":"k"}}"#,
        );
        let catalog = model_catalog(&dir).unwrap();
        let ids: Vec<_> = catalog.providers[0]
            .models
            .iter()
            .map(|m| m.id.as_str())
            .collect();
        assert_eq!(ids, vec!["ok"], "unknown api must not get a fake wire");
        let yaml = pi_providers_yaml(&dir).unwrap();
        assert!(yaml.contains("      ok:"), "{yaml}");
        assert!(!yaml.contains("google:"), "{yaml}");
        assert!(yaml.contains("wire_apis: [anthropic]"), "{yaml}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
