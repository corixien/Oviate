mod ai;
mod calendar;
mod cache;
mod mcp;
mod model;
mod news;
mod pine_files;
mod providers;
mod stream;

use cache::Cache;
use model::{Candles, Error, Result, SymbolHit, Timeframe};
use providers::{alpaca, yahoo};
use std::sync::Arc;
use tauri::Manager;

const KEYRING_SERVICE: &str = "oviate";

struct AppState {
    cache: Arc<Cache>,
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
struct NewsStatus { fmp: bool, finnhub: bool, newsapi: bool, alpaca: bool, liquid: bool, groq: bool, openrouter: bool }

#[tauri::command]
fn news_status() -> NewsStatus {
    let k = news_keys();
    NewsStatus { fmp: secret_get("fmp_key").is_some(), finnhub: k.finnhub.is_some(), newsapi: k.newsapi.is_some(), alpaca: k.alpaca.is_some(), liquid: liquid_tokens().is_some(), groq: secret_get("groq_key").is_some(), openrouter: secret_get("openrouter_key").is_some() }
}

/// Save (non-empty value) or clear (empty value) a news provider key: `finnhub` or `newsapi`.
#[tauri::command]
fn save_news_key(provider: String, value: String) -> Result<()> {
    let name = match provider.as_str() { "finnhub" => "finnhub_key", "newsapi" => "newsapi_key", "groq" => "groq_key", "openrouter" => "openrouter_key", "fmp" => "fmp_key", p => return Err(Error::Other(format!("unknown provider {p}"))) };
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

/// News in [from, to] (unix seconds). `symbol = None` is market-wide. Fetches only what the local cache is missing.
#[tauri::command]
async fn news_window(st: State<'_>, symbol: Option<String>, from: i64, to: i64, limit: Option<usize>) -> Result<news::NewsResult> {
    let now = chrono::Utc::now().timestamp();
    let key = symbol.clone().unwrap_or_else(|| "*".into());
    let ttl = 300; // recent windows are re-checked every 5 minutes (past windows never expire, see news_window_covered)
    let mut errors = Vec::new();
    if !st.cache.news_window_covered(&key, from, to, now, ttl)? {
        let mut extra = Vec::new();
        if symbol.is_none() && to >= now - 2 * 86400 && liquid_tokens().is_some() {
            match liquid_brief(&st).await {
                Ok((n, _)) => extra = n,
                Err(e) => errors.push(news::ProviderError { provider: "liquid".into(), error: e.to_string() }),
            }
        }
        let res = news::fetch_window(&st.http, &news_keys(), symbol.as_deref(), from, to, extra, 500).await;
        st.cache.news_put(&res.items)?;
        // Do not mark the window fetched when every provider failed (e.g. offline), so it is retried.
        if !res.items.is_empty() || res.errors.is_empty() { st.cache.news_window_mark(&key, from, to, now)?; }
        errors.extend(res.errors);
    }
    let items = news::dedupe(st.cache.news_query(symbol.as_deref(), from, to, 800)?, limit.unwrap_or(400));
    Ok(news::NewsResult { items, errors })
}

/// Calendar events in [from, to] (unix seconds): see `calendar::window`. Answers at once from the cache; missing company days load in the background (`pending`).
#[tauri::command]
async fn calendar_window(st: State<'_>, from: i64, to: i64, force: Option<bool>) -> Result<calendar::CalendarResult> {
    calendar::window(st.cache.clone(), st.http.clone(), secret_get("fmp_key"), from, to, force.unwrap_or(false)).await
}

/// AI summary of one calendar event (Groq): what it is, why it matters, what happens above / below the forecast. Cached per event, language and known actual value.
#[tauri::command]
async fn calendar_summary(st: State<'_>, event: calendar::CalEvent, lang: String, force: Option<bool>) -> Result<ai::CalSummary> {
    let ck = format!("cal:{}:{lang}:{}", event.id, event.actual.clone().unwrap_or_default());
    if !force.unwrap_or(false) {
        if let Some(body) = st.cache.ai_get(&ck)? {
            if let Ok(s) = serde_json::from_str::<ai::CalSummary>(&body) { return Ok(s); }
        }
    }
    let (content, model) = groq_chat(&st, ai::cal_messages(&event, &lang), 0.2, 600, true).await?;
    let summary = ai::parse_cal_summary(&content, &model)?;
    st.cache.ai_put(&ck, &serde_json::to_string(&summary).map_err(|e| Error::Other(e.to_string()))?, chrono::Utc::now().timestamp())?;
    Ok(summary)
}

/// Groq chat with the saved key and model; re-picks the model once if the saved one fails (it may have been retired).
async fn groq_chat(st: &State<'_>, messages: serde_json::Value, temperature: f64, max_tokens: u32, json_mode: bool) -> Result<(String, String)> {
    let key = secret_get("groq_key").ok_or_else(|| Error::Other("Groq API key not set (Settings)".into()))?;
    let mut model = match st.cache.kv_get("groq_model")? { Some(m) => m, None => ai::pick_model(&st.http, &key).await? };
    let content = match ai::chat(&st.http, ai::GROQ, &key, &model, messages.clone(), temperature, max_tokens, json_mode).await {
        Ok(c) => c,
        Err(_) => {
            model = ai::pick_model(&st.http, &key).await?;
            ai::chat(&st.http, ai::GROQ, &key, &model, messages, temperature, max_tokens, json_mode).await?
        }
    };
    st.cache.kv_set("groq_model", &model)?;
    Ok((content, model))
}

/// Code generation (Pine indicators and builder conditions) on OpenRouter free models.
#[tauri::command]
async fn ai_complete(st: State<'_>, messages: serde_json::Value) -> Result<String> {
    if !messages.is_array() { return Err(Error::Other("messages must be an array".into())); }
    let key = secret_get("openrouter_key").ok_or_else(|| Error::Other("OpenRouter API key not set (Settings)".into()))?;
    ai::code_chat(&st.http, &key, messages).await
}

/// Short AI summary of a cached news item (Groq). Cached per item and language.
#[tauri::command]
async fn ai_summary(st: State<'_>, id: String, lang: String, force: Option<bool>) -> Result<ai::AiSummary> {
    let ck = format!("{id}:{lang}");
    if !force.unwrap_or(false) {
        if let Some(body) = st.cache.ai_get(&ck)? {
            if let Ok(s) = serde_json::from_str::<ai::AiSummary>(&body) { return Ok(s); }
        }
    }
    let item = st.cache.news_get(&id)?.ok_or_else(|| Error::Other("news item not found".into()))?;
    let (content, model) = groq_chat(&st, ai::build_messages(&item, &lang), 0.2, 450, true).await?;
    let summary = ai::parse_summary(&content, &model)?;
    st.cache.ai_put(&ck, &serde_json::to_string(&summary).map_err(|e| Error::Other(e.to_string()))?, chrono::Utc::now().timestamp())?;
    Ok(summary)
}

/// Liquid "unusual activity" list (needs a Liquid login).
#[tauri::command]
async fn liquid_unusual(st: State<'_>) -> Result<Vec<mcp::Unusual>> {
    Ok(liquid_brief(&st).await?.1)
}

fn pine_dir(app: &tauri::AppHandle, kind: &str) -> Result<std::path::PathBuf> {
    pine_files::kind_dir(&app.path().app_data_dir().map_err(|e| Error::Other(e.to_string()))?, kind)
}

#[tauri::command]
fn pine_list(app: tauri::AppHandle, kind: String) -> Result<Vec<pine_files::PineFile>> {
    pine_files::list(&pine_dir(&app, &kind)?)
}

#[tauri::command]
fn pine_save(app: tauri::AppHandle, kind: String, name: String, code: String) -> Result<String> {
    pine_files::save(&pine_dir(&app, &kind)?, &name, &code)
}

#[tauri::command]
fn pine_delete(app: tauri::AppHandle, kind: String, name: String) -> Result<()> {
    pine_files::delete(&pine_dir(&app, &kind)?, &name)
}

/// Write bundled scripts that were never seeded before (a deleted bundled script stays deleted).
#[tauri::command]
fn pine_seed(app: tauri::AppHandle, st: State<'_>, kind: String, files: Vec<pine_files::PineFile>) -> Result<()> {
    let key = format!("pine_seeded:{kind}");
    let already: Vec<String> = st.cache.kv_get(&key)?.and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default();
    let seeded = pine_files::seed(&pine_dir(&app, &kind)?, &files, &already)?;
    st.cache.kv_set(&key, &serde_json::to_string(&seeded).map_err(|e| Error::Other(e.to_string()))?)
}

/// Absolute path of the scripts folder (created if needed).
#[tauri::command]
fn pine_folder(app: tauri::AppHandle, kind: String) -> Result<String> {
    let d = pine_dir(&app, &kind)?;
    std::fs::create_dir_all(&d).map_err(|e| Error::Other(e.to_string()))?;
    Ok(d.to_string_lossy().into_owned())
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
            app.manage(Arc::new(AppState { cache: Arc::new(cache), http, streams }));
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
            news_window,
            calendar_window,
            calendar_summary,
            ai_summary,
            ai_complete,
            liquid_unusual,
            pine_list,
            pine_save,
            pine_delete,
            pine_seed,
            pine_folder,
            kv_get,
            kv_set
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
