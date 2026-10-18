mod cache;
mod model;
mod providers;
mod stream;

use cache::Cache;
use model::{Candles, Error, Result, SymbolHit, Timeframe};
use providers::{alpaca, yahoo};
use std::sync::Arc;
use tauri::Manager;

const KEYRING_SERVICE: &str = "oviate";

struct AppState {
    cache: Cache,
    streams: stream::Streams,
    http: reqwest::Client,
}

type State<'a> = tauri::State<'a, Arc<AppState>>;

fn keyring_entry(name: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, name).map_err(|e| Error::Keyring(e.to_string()))
}

pub(crate) fn load_keys() -> Option<alpaca::Keys> {
    let id = keyring_entry("alpaca_key_id").ok()?.get_password().ok()?;
    let secret = keyring_entry("alpaca_secret").ok()?.get_password().ok()?;
    (!id.is_empty() && !secret.is_empty()).then_some(alpaca::Keys { id, secret })
}

async fn fetch(st: &AppState, symbol: &str, tf: Timeframe, from: i64, to: i64) -> Result<Candles> {
    if alpaca::supports(symbol) {
        if let Some(keys) = load_keys() {
            match alpaca::candles(&st.http, &keys, symbol, tf, from, to).await {
                Ok(c) if !c.is_empty() => return Ok(c),
                Ok(_) | Err(_) => {} // fall through to yfinance
            }
        }
    }
    // Yahoo uses BTC-USD instead of BTC/USD.
    yahoo::candles(&st.http, &symbol.replace('/', "-"), tf, from, to).await
}

/// Return candles in [from, to], fetching only what the local cache is missing.
#[tauri::command]
async fn get_candles(st: State<'_>, symbol: String, tf: Timeframe, from: i64, to: i64) -> Result<Candles> {
    let key = tf.key();
    let now = chrono::Utc::now().timestamp();
    let to_eff = to.min(now);
    let step = tf.seconds();
    match st.cache.coverage(&symbol, key)? {
        None => {
            let c = fetch(&st, &symbol, tf, from, to_eff).await?;
            st.cache.store(&symbol, key, &c, from, to_eff)?;
        }
        Some((cf, ct)) => {
            if from < cf {
                let c = fetch(&st, &symbol, tf, from, cf).await?;
                st.cache.store(&symbol, key, &c, from, cf)?;
            }
            if to_eff > ct - 2 * step {
                // Re-fetch the tail including the last (possibly partial) bars.
                let start = (ct - 2 * step).max(from);
                let c = fetch(&st, &symbol, tf, start, to_eff).await?;
                st.cache.store(&symbol, key, &c, start, to_eff)?;
            }
        }
    }
    st.cache.load(&symbol, key, from, to)
}

#[tauri::command]
async fn search_symbols(st: State<'_>, query: String) -> Result<Vec<SymbolHit>> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    yahoo::search(&st.http, query.trim()).await
}

#[tauri::command]
fn save_alpaca_keys(key_id: String, secret: String) -> Result<()> {
    keyring_entry("alpaca_key_id")?.set_password(key_id.trim()).map_err(|e| Error::Keyring(e.to_string()))?;
    keyring_entry("alpaca_secret")?.set_password(secret.trim()).map_err(|e| Error::Keyring(e.to_string()))?;
    Ok(())
}

#[tauri::command]
fn clear_alpaca_keys() -> Result<()> {
    for n in ["alpaca_key_id", "alpaca_secret"] {
        let _ = keyring_entry(n)?.delete_credential();
    }
    Ok(())
}

#[tauri::command]
fn alpaca_keys_set() -> bool {
    load_keys().is_some()
}

#[tauri::command]
fn stream_symbols(st: State<'_>, symbols: Vec<String>) {
    st.streams.set(symbols);
}

#[tauri::command]
fn kv_get(st: State<'_>, key: String) -> Result<Option<String>> {
    st.cache.kv_get(&key)
}

#[tauri::command]
fn kv_set(st: State<'_>, key: String, value: String) -> Result<()> {
    st.cache.kv_set(&key, &value)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let cache = Cache::open(&dir.join("oviate.db"))?;
            let http = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()?;
            let streams = stream::Streams::start(app.handle().clone());
            app.manage(Arc::new(AppState { cache, http, streams }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_candles,
            search_symbols,
            save_alpaca_keys,
            clear_alpaca_keys,
            alpaca_keys_set,
            stream_symbols,
            kv_get,
            kv_set
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
