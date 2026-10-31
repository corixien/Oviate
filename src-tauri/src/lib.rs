mod ai;
mod calendar;
mod cache;
mod mcp;
mod model;
mod news;
mod pine_files;
mod regions;
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
    /// one fetch at a time per symbol + timeframe: a second chart asking for the same candles waits and then reads the cache
    fetch_locks: std::sync::Mutex<std::collections::HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    prefetch: std::sync::Mutex<PrefetchStatus>,
}

type State<'a> = tauri::State<'a, Arc<AppState>>;

/// API keys and tokens live in the OS keyring. Android has none: there they are kept in the app's private database instead.
#[cfg(not(target_os = "android"))]
fn keyring_entry(name: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, name).map_err(|e| Error::Keyring(e.to_string()))
}

#[cfg(target_os = "android")]
static SECRET_DB: std::sync::OnceLock<Arc<Cache>> = std::sync::OnceLock::new();

#[cfg(not(target_os = "android"))]
pub(crate) fn secret_get(name: &str) -> Option<String> {
    keyring_entry(name).ok()?.get_password().ok().filter(|v| !v.is_empty())
}
#[cfg(target_os = "android")]
pub(crate) fn secret_get(name: &str) -> Option<String> {
    SECRET_DB.get()?.kv_get(&format!("secret:{name}")).ok().flatten().filter(|v| !v.is_empty())
}

#[cfg(not(target_os = "android"))]
fn secret_set(name: &str, value: &str) -> Result<()> {
    keyring_entry(name)?.set_password(value).map_err(|e| Error::Keyring(e.to_string()))
}
#[cfg(target_os = "android")]
fn secret_set(name: &str, value: &str) -> Result<()> {
    SECRET_DB.get().ok_or_else(|| Error::Other("secret store not ready".into()))?.kv_set(&format!("secret:{name}"), value)
}

#[cfg(not(target_os = "android"))]
fn secret_del(name: &str) {
    if let Ok(e) = keyring_entry(name) { let _ = e.delete_credential(); }
}
#[cfg(target_os = "android")]
fn secret_del(name: &str) {
    if let Some(c) = SECRET_DB.get() { let _ = c.kv_set(&format!("secret:{name}"), ""); }
}

pub(crate) fn load_keys() -> Option<alpaca::Keys> {
    let id = secret_get("alpaca_key_id")?;
    let secret = secret_get("alpaca_secret")?;
    Some(alpaca::Keys { id, secret })
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

/// Make sure the cache covers [from, to] (fetching only what is missing). Returns whether the network was used.
async fn ensure_cached(st: &AppState, symbol: &str, tf: Timeframe, from: i64, to: i64) -> Result<bool> {
    let key = tf.key();
    let lock = st.fetch_locks.lock().unwrap().entry(format!("{symbol}|{key}")).or_default().clone();
    let _one_at_a_time = lock.lock().await;
    let now = chrono::Utc::now().timestamp();
    let to_eff = to.min(now);
    let step = tf.seconds();
    let mut fetched = false;
    match st.cache.coverage(symbol, key)? {
        None => {
            let c = fetch(st, symbol, tf, from, to_eff).await?;
            st.cache.store(symbol, key, &c, from, to_eff)?;
            fetched = true;
        }
        Some((cf, ct)) => {
            if from < cf {
                let c = fetch(st, symbol, tf, from, cf).await?;
                st.cache.store(symbol, key, &c, from, cf)?;
                fetched = true;
            }
            if to_eff > ct - 2 * step {
                // Re-fetch the tail including the last (possibly partial) bars; when that fails (offline, rate limit) the cached candles are still shown.
                let start = (ct - 2 * step).max(from);
                fetched = true;
                // a slow network must not hold the chart back: after 4 s the cached candles are shown and the next poll tries again
                match tokio::time::timeout(std::time::Duration::from_secs(4), fetch(st, symbol, tf, start, to_eff)).await {
                    Ok(Ok(c)) => st.cache.store(symbol, key, &c, start, to_eff)?,
                    Ok(Err(e)) => eprintln!("candle refresh failed for {symbol} {key}, using the cache: {e}"),
                    Err(_) => eprintln!("candle refresh for {symbol} {key} timed out, using the cache"),
                }
            }
        }
    }
    Ok(fetched)
}

/// Return candles in [from, to], fetching only what the local cache is missing.
#[tauri::command]
async fn get_candles(st: State<'_>, symbol: String, tf: Timeframe, from: i64, to: i64) -> Result<Candles> {
    ensure_cached(&st, &symbol, tf, from, to).await?;
    st.cache.load(&symbol, tf.key(), from, to)
}

/// Progress of the background download for the Strategy Tester / Optimizer.
#[derive(serde::Serialize, Default, Clone)]
struct PrefetchStatus {
    running: bool,
    done: usize,
    total: usize,
}

/// Background download of the test universe: daily / weekly / monthly (20 years) and hourly / 4 hour (2 years) candles of every symbol, one request at a time with a pause.
/// Later passes (every 6 hours) only fetch the newest candles. Sub-hour timeframes are not prefetched (too large); they are cached when first used.
#[tauri::command]
fn prefetch_start(st: State<'_>, symbols: Vec<String>) {
    {
        let mut s = st.prefetch.lock().unwrap();
        if s.running { return; }
        *s = PrefetchStatus { running: true, done: 0, total: 0 };
    }
    let st = st.inner().clone();
    tauri::async_runtime::spawn(async move {
        const YEAR: i64 = 365 * 86400;
        let plan: [(Timeframe, i64); 5] = [(Timeframe::D1, 20 * YEAR), (Timeframe::W1, 20 * YEAR), (Timeframe::Mo1, 20 * YEAR), (Timeframe::H1, 2 * YEAR), (Timeframe::H4, 2 * YEAR)];
        loop {
            st.prefetch.lock().unwrap().total = plan.len() * symbols.len();
            st.prefetch.lock().unwrap().done = 0;
            let mut failures = 0;
            'pass: for (tf, back) in plan {
                for sym in &symbols {
                    let now = chrono::Utc::now().timestamp();
                    match ensure_cached(&st, sym, tf, now - back, now).await {
                        Ok(true) => { failures = 0; tokio::time::sleep(std::time::Duration::from_millis(300)).await; }
                        Ok(false) => failures = 0,
                        Err(e) => {
                            eprintln!("prefetch {sym} {}: {e}", tf.key());
                            failures += 1;
                            if failures >= 8 { break 'pass; } // offline or blocked: try again next round
                            tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                        }
                    }
                    st.prefetch.lock().unwrap().done += 1;
                }
            }
            st.prefetch.lock().unwrap().running = false;
            tokio::time::sleep(std::time::Duration::from_secs(6 * 3600)).await;
            st.prefetch.lock().unwrap().running = true;
        }
    });
}

#[tauri::command]
fn prefetch_status(st: State<'_>) -> PrefetchStatus {
    st.prefetch.lock().unwrap().clone()
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
    secret_set("alpaca_key_id", key_id.trim())?;
    secret_set("alpaca_secret", secret.trim())?;
    Ok(())
}

#[tauri::command]
fn clear_alpaca_keys() -> Result<()> {
    for n in ["alpaca_key_id", "alpaca_secret"] {
        secret_del(n);
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

fn news_keys() -> news::NewsKeys {
    news::NewsKeys { finnhub: secret_get("finnhub_key"), newsapi: secret_get("newsapi_key"), alpaca: load_keys() }
}

fn liquid_tokens() -> Option<mcp::Tokens> {
    serde_json::from_str(&secret_get("liquid_tokens")?).ok()
}

fn save_liquid_tokens(t: &mcp::Tokens) -> Result<()> {
    secret_set("liquid_tokens", &serde_json::to_string(t).map_err(|e| Error::Other(e.to_string()))?)
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
    if value.trim().is_empty() { secret_del(name); Ok(()) } else { secret_set(name, value.trim()) }
}

/// The keys a user account keeps for all devices (the liquid login stays on its device).
const SYNCED_SECRETS: [&str; 7] = ["alpaca_key_id", "alpaca_secret", "finnhub_key", "newsapi_key", "groq_key", "openrouter_key", "fmp_key"];

/// Every stored key that the account sync handles, for the sync with the server.
#[tauri::command]
fn secrets_export() -> std::collections::BTreeMap<String, String> {
    SYNCED_SECRETS.iter().filter_map(|n| secret_get(n).map(|v| (n.to_string(), v))).collect()
}

/// Store keys that came from the account (and remove keys that were removed on another device).
#[tauri::command]
fn secrets_apply(set: std::collections::BTreeMap<String, String>, remove: Vec<String>) -> Result<()> {
    for (n, v) in set {
        if SYNCED_SECRETS.contains(&n.as_str()) && !v.trim().is_empty() { secret_set(&n, v.trim())?; }
    }
    for n in remove {
        if SYNCED_SECRETS.contains(&n.as_str()) { secret_del(&n); }
    }
    Ok(())
}

#[tauri::command]
async fn liquid_login(app: tauri::AppHandle, st: State<'_>) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    let t = mcp::login(&st.http, mcp::LIQUID_URL, |url| app.opener().open_url(url, None::<&str>).map_err(|e| Error::Other(e.to_string()))).await?;
    save_liquid_tokens(&t)
}

#[tauri::command]
fn liquid_logout() {
    secret_del("liquid_tokens");
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

/// Calendar currencies of a symbol (the regions whose macro events matter for it): cached; else the Nasdaq company profile; else the AI.
/// The UI knows ~1500 symbols itself (bundled table) and only asks for the rest.
#[tauri::command]
async fn symbol_regions(st: State<'_>, symbol: String) -> Result<Vec<String>> {
    let sym = symbol.trim().to_uppercase();
    if sym.is_empty() { return Err(Error::Other("empty symbol".into())); }
    let key = format!("symreg_{sym}");
    if let Some(v) = st.cache.kv_get(&key)?.and_then(|j| serde_json::from_str::<Vec<String>>(&j).ok()).filter(|v| !v.is_empty()) { return Ok(v); }
    let plain = !sym.contains(['/', '^', '=', '.', '-']);
    let found = if plain {
        match regions::nasdaq_country(&st.http, &sym).await { Ok(c) => Some(regions::country_currencies(&c)), Err(_) => None }
    } else { None };
    let cur = match found {
        Some(c) => c,
        None => {
            let (content, _) = groq_chat(&st, regions::messages(&sym), 0.0, 120, true).await?;
            regions::parse_currencies(&content)?
        }
    };
    st.cache.kv_set(&key, &serde_json::to_string(&cur).map_err(|e| Error::Other(e.to_string()))?)?;
    Ok(cur)
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

/// Light structured tasks (code -> builder model, text -> builder model, mirrored side): Groq first (fast, own rate limits), OpenRouter when Groq is not set up or fails.
#[tauri::command]
async fn ai_complete_light(st: State<'_>, messages: serde_json::Value) -> Result<String> {
    if !messages.is_array() { return Err(Error::Other("messages must be an array".into())); }
    if secret_get("groq_key").is_some() {
        match groq_chat(&st, messages.clone(), 0.2, 6000, false).await {
            Ok((c, _)) if !c.trim().is_empty() => return Ok(c),
            Ok(_) => {}
            Err(e) => eprintln!("groq failed, falling back to OpenRouter: {e}"),
        }
    }
    ai_complete(st, messages).await
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
            let cache = Arc::new(cache);
            #[cfg(target_os = "android")]
            let _ = SECRET_DB.set(cache.clone());
            let builder = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .connect_timeout(std::time::Duration::from_secs(10))
                .pool_idle_timeout(std::time::Duration::from_secs(15))
                ;
            #[cfg(target_os = "android")]
            let builder = builder.tls_certs_only(webpki_root_certs::TLS_SERVER_ROOT_CERTS.iter().filter_map(|c| reqwest::Certificate::from_der(c.as_ref()).ok()));
            let http = builder
                .build()?;
            let streams = stream::Streams::start(app.handle().clone());
            app.manage(Arc::new(AppState { cache, http, streams, fetch_locks: Default::default(), prefetch: Default::default() }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_candles,
            prefetch_start,
            prefetch_status,
            secrets_export,
            secrets_apply,
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
            symbol_regions,
            ai_summary,
            ai_complete,
            ai_complete_light,
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
