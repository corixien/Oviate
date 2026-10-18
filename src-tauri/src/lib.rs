mod cache;
mod mcp;
mod model;
mod news;
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

fn secret_get(name: &str) -> Option<String> {
    keyring_entry(name).ok()?.get_password().ok().filter(|v| !v.is_empty())
}

fn news_keys() -> news::NewsKeys {
    news::NewsKeys { finnhub: secret_get("finnhub_key"), newsapi: secret_get("newsapi_key"), alpaca: load_keys() }
}

fn liquid_tokens() -> Option<mcp::Tokens> {
    serde_json::from_str(&secret_get("liquid_tokens")?).ok()
}

fn save_liquid_tokens(t: &mcp::Tokens) -> Result<()> {
    keyring_entry("liquid_tokens")?.set_password(&serde_json::to_string(t).map_err(|e| Error::Other(e.to_string()))?).map_err(|e| Error::Keyring(e.to_string()))
}

#[derive(serde::Serialize)]
struct NewsStatus { finnhub: bool, newsapi: bool, alpaca: bool, liquid: bool }

#[tauri::command]
fn news_status() -> NewsStatus {
    let k = news_keys();
    NewsStatus { finnhub: k.finnhub.is_some(), newsapi: k.newsapi.is_some(), alpaca: k.alpaca.is_some(), liquid: liquid_tokens().is_some() }
}

/// Save (non-empty value) or clear (empty value) a news provider key: `finnhub` or `newsapi`.
#[tauri::command]
fn save_news_key(provider: String, value: String) -> Result<()> {
    let name = match provider.as_str() { "finnhub" => "finnhub_key", "newsapi" => "newsapi_key", p => return Err(Error::Other(format!("unknown provider {p}"))) };
    let e = keyring_entry(name)?;
    if value.trim().is_empty() { let _ = e.delete_credential(); Ok(()) } else { e.set_password(value.trim()).map_err(|e| Error::Keyring(e.to_string())) }
}

#[tauri::command]
async fn liquid_login(app: tauri::AppHandle, st: State<'_>) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    let t = mcp::login(&st.http, mcp::LIQUID_URL, |url| app.opener().open_url(url, None::<&str>).map_err(|e| Error::Other(e.to_string()))).await?;
    save_liquid_tokens(&t)
}

#[tauri::command]
fn liquid_logout() {
    if let Ok(e) = keyring_entry("liquid_tokens") { let _ = e.delete_credential(); }
}

async fn liquid_brief(st: &AppState) -> Result<(Vec<news::NewsItem>, Vec<mcp::Unusual>)> {
    let t = liquid_tokens().ok_or_else(|| Error::Other("not logged in".into()))?;
    let t = mcp::ensure_fresh(&st.http, t).await?;
    save_liquid_tokens(&t)?;
    let text = mcp::call_tool(&st.http, mcp::LIQUID_URL, &t.access, "get_news", serde_json::json!({})).await?;
    Ok(mcp::parse_liquid(&text))
}

/// Aggregated news. `symbol = None` returns market-wide news (and the Liquid brief when logged in).
#[tauri::command]
async fn get_news(st: State<'_>, symbol: Option<String>, limit: Option<usize>) -> Result<news::NewsResult> {
    let limit = limit.unwrap_or(60).clamp(1, 200);
    let mut extra = Vec::new();
    let mut liquid_err = None;
    if symbol.is_none() && liquid_tokens().is_some() {
        match liquid_brief(&st).await { Ok((n, _)) => extra = n, Err(e) => liquid_err = Some(e.to_string()) }
    }
    let mut res = news::fetch_all(&st.http, &news_keys(), symbol.as_deref(), extra, limit).await;
    if let Some(error) = liquid_err { res.errors.push(news::ProviderError { provider: "liquid".into(), error }); }
    Ok(res)
}

/// Liquid "unusual activity" list (needs a Liquid login).
#[tauri::command]
async fn liquid_unusual(st: State<'_>) -> Result<Vec<mcp::Unusual>> {
    Ok(liquid_brief(&st).await?.1)
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
            news_status,
            save_news_key,
            liquid_login,
            liquid_logout,
            get_news,
            liquid_unusual,
            kv_get,
            kv_set
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
