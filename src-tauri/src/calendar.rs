//! Calendar of market events. Macro: the public Forex Factory weekly feed (USD, EUR, GBP, JPY, CAD, AUD, NZD, CHF, CNY; no key), plus Financial
//! Modeling Prep with a key (Settings: more countries, a wider window, actual values). Companies, keyless from Nasdaq: earnings (quarter, EPS estimate,
//! last year's EPS), ex-dividend dates, stock splits and IPOs.
use crate::cache::Cache;
use crate::model::{Error, Result};
use chrono::{DateTime, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

const UA: &str = "Mozilla/5.0 (X11; Linux x86_64) Oviate/0.1";
const FF_URLS: [&str; 2] = ["https://nfs.faireconomy.media/ff_calendar_thisweek.json", "https://nfs.faireconomy.media/ff_calendar_nextweek.json"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CalEvent {
    pub id: String,
    pub ts: i64,
    pub country: String,
    pub title: String,
    /// high | medium | low | holiday
    pub impact: String,
    pub actual: Option<String>,
    pub forecast: Option<String>,
    pub previous: Option<String>,
    pub provider: String,
    /// macro | earnings | dividend | split | ipo
    #[serde(default = "macro_kind")]
    pub kind: String,
    /// ticker of company events
    #[serde(default)]
    pub symbol: Option<String>,
    /// one line of context (fiscal quarter, market cap, payment date, ...)
    #[serde(default)]
    pub detail: Option<String>,
}

fn macro_kind() -> String { "macro".into() }

#[derive(Debug, Serialize)]
pub struct ProviderError { pub provider: String, pub error: String }

#[derive(Debug, Serialize)]
pub struct CalendarResult {
    pub items: Vec<CalEvent>,
    pub errors: Vec<ProviderError>,
    /// company data is still being fetched in the background: ask again in a moment
    pub pending: bool,
}

fn text(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn impact_of(s: &str) -> String {
    match s.to_lowercase().as_str() {
        "high" | "3" => "high",
        "medium" | "moderate" | "2" => "medium",
        "holiday" | "non-economic" => "holiday",
        _ => "low",
    }.into()
}

fn event(provider: &str, ts: i64, country: &str, title: &str, impact: &str, actual: Option<String>, forecast: Option<String>, previous: Option<String>) -> CalEvent {
    CalEvent { id: format!("{provider}:{ts}:{country}:{title}"), ts, country: country.into(), title: title.into(), impact: impact_of(impact), actual, forecast, previous, provider: provider.into(), kind: macro_kind(), symbol: None, detail: None }
}

/// Forex Factory feed rows: title, country (currency), date (RFC 3339 with offset), impact, forecast, previous.
pub fn parse_ff(v: &Value) -> Vec<CalEvent> {
    v.as_array().map(|rows| rows.iter().filter_map(|r| {
        let ts = DateTime::parse_from_rfc3339(r["date"].as_str()?).ok()?.timestamp();
        let title = r["title"].as_str()?;
        Some(event("ff", ts, r["country"].as_str().unwrap_or(""), title, r["impact"].as_str().unwrap_or("low"), text(&r["actual"]), text(&r["forecast"]), text(&r["previous"])))
    }).collect()).unwrap_or_default()
}

/// Financial Modeling Prep rows: date ("YYYY-MM-DD HH:MM:SS", UTC), country / currency, event, impact, estimate, previous, actual.
pub fn parse_fmp(v: &Value) -> Vec<CalEvent> {
    v.as_array().map(|rows| rows.iter().filter_map(|r| {
        let d = r["date"].as_str()?;
        let ts = NaiveDateTime::parse_from_str(d, "%Y-%m-%d %H:%M:%S").ok().map(|n| n.and_utc().timestamp())
            .or_else(|| DateTime::parse_from_rfc3339(d).ok().map(|x| x.timestamp()))?;
        let title = r["event"].as_str()?;
        let country = r["currency"].as_str().or_else(|| r["country"].as_str()).unwrap_or("");
        Some(event("fmp", ts, country, title, r["impact"].as_str().unwrap_or("low"), text(&r["actual"]), text(&r["estimate"]).or_else(|| text(&r["forecast"])), text(&r["previous"])))
    }).collect()).unwrap_or_default()
}

pub async fn forex_factory(http: &reqwest::Client) -> Result<Vec<CalEvent>> {
    let mut out = Vec::new();
    let mut last_err = None;
    for (i, url) in FF_URLS.iter().enumerate() {
        match http.get(*url).timeout(std::time::Duration::from_secs(12)).header("User-Agent", UA).send().await.and_then(|r| r.error_for_status()) {
            Ok(r) => out.extend(parse_ff(&r.json::<Value>().await?)),
            Err(e) => { if i == 0 { last_err = Some(e); } } // next week is published late in the week: a miss there is normal
        }
    }
    match last_err { Some(e) if out.is_empty() => Err(Error::from(e)), _ => Ok(out) }
}

pub async fn fmp(http: &reqwest::Client, key: &str, from: i64, to: i64) -> Result<Vec<CalEvent>> {
    let f = |t: i64| DateTime::<Utc>::from_timestamp(t, 0).unwrap_or_default().format("%Y-%m-%d").to_string();
    let v: Value = http.get("https://financialmodelingprep.com/stable/economic-calendar").header("User-Agent", UA)
        .query(&[("from", f(from)), ("to", f(to)), ("apikey", key.to_string())]).send().await?.error_for_status()?.json().await?;
    if let Some(msg) = v["Error Message"].as_str() { return Err(Error::Other(msg.to_string())); }
    Ok(parse_fmp(&v))
}

// ---------------------------------------------------------------- Nasdaq company calendars (keyless)

const NQ: &str = "https://api.nasdaq.com/api";

async fn nq_json(http: &reqwest::Client, path: &str, date: &str) -> Result<Value> {
    Ok(http.get(format!("{NQ}{path}")).query(&[("date", date)])
        .timeout(std::time::Duration::from_secs(12))
        .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/120.0").header("Accept", "application/json")
        .header("Origin", "https://www.nasdaq.com").header("Referer", "https://www.nasdaq.com/")
        .send().await?.error_for_status()?.json().await?)
}

/// "$740,324,150,000" -> 7.4e11, "($0.12)" -> -0.12
fn money(v: &Value) -> Option<f64> {
    let t = v.as_str()?.trim();
    let neg = t.starts_with('(') || t.starts_with('-');
    let n: String = t.chars().filter(|c| c.is_ascii_digit() || *c == '.').collect();
    n.parse::<f64>().ok().map(|x| if neg { -x } else { x })
}

fn big(n: f64) -> String {
    if n >= 1e12 { format!("${:.2}T", n / 1e12) } else if n >= 1e9 { format!("${:.0}B", n / 1e9) } else { format!("${:.0}M", n / 1e6) }
}

/// "MM/DD/YYYY" at a UTC hour -> unix seconds
fn us_date(s: &str, hour: u32, min: u32) -> Option<i64> {
    let d = chrono::NaiveDate::parse_from_str(s.trim(), "%m/%d/%Y").ok()?;
    Some(d.and_hms_opt(hour, min, 0)?.and_utc().timestamp())
}

fn company(kind: &str, provider: &str, ts: i64, symbol: &str, title: String, impact: &str, forecast: Option<String>, previous: Option<String>, actual: Option<String>, detail: Option<String>) -> CalEvent {
    CalEvent { id: format!("nq:{kind}:{ts}:{symbol}"), ts, country: "US".into(), title, impact: impact.into(), actual, forecast, previous, provider: provider.into(), kind: kind.into(), symbol: Some(symbol.to_string()), detail }
}

/// Nasdaq earnings rows of one day (`date` is the day, YYYY-MM-DD, used for the time of day only when a row has no date of its own).
pub fn parse_nq_earnings(v: &Value, date: &str) -> Vec<CalEvent> {
    let day = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok();
    v["data"]["rows"].as_array().map(|rows| rows.iter().filter_map(|r| {
        let sym = r["symbol"].as_str()?.trim();
        let name = r["name"].as_str().unwrap_or(sym).trim();
        let (h, m) = match r["time"].as_str() { Some("time-pre-market") => (12, 0), Some("time-after-hours") => (21, 0), _ => (16, 0) };
        let ts = day?.and_hms_opt(h, m, 0)?.and_utc().timestamp();
        let cap = money(&r["marketCap"]);
        let impact = match cap { Some(c) if c >= 2e11 => "high", Some(c) if c >= 2e10 => "medium", _ => "low" };
        let est = r["noOfEsts"].as_str().filter(|x| !x.trim().is_empty() && *x != "N/A");
        let detail = [r["fiscalQuarterEnding"].as_str().map(|q| format!("quarter {q}")), cap.map(|c| format!("market cap {}", big(c))), est.map(|e| format!("{e} estimates"))]
            .into_iter().flatten().collect::<Vec<_>>().join(" · ");
        let txt = |k: &str| r[k].as_str().map(|x| x.trim().to_string()).filter(|x| !x.is_empty() && x != "N/A");
        Some(company("earnings", "nasdaq", ts, sym, format!("{name} earnings"), impact, txt("epsForecast"), txt("lastYearEPS"), None, (!detail.is_empty()).then_some(detail)))
    }).collect()).unwrap_or_default()
}

pub fn parse_nq_dividends(v: &Value) -> Vec<CalEvent> {
    v["data"]["calendar"]["rows"].as_array().map(|rows| rows.iter().filter_map(|r| {
        let sym = r["symbol"].as_str()?.trim();
        let ts = us_date(r["dividend_Ex_Date"].as_str()?, 13, 30)?;
        let rate = r["dividend_Rate"].as_f64().map(|x| format!("${x:.4}").trim_end_matches('0').trim_end_matches('.').to_string());
        let detail = [r["payment_Date"].as_str().map(|d| format!("payment {d}")), r["indicated_Annual_Dividend"].as_f64().map(|a| format!("annual ${a:.2}"))].into_iter().flatten().collect::<Vec<_>>().join(" · ");
        Some(company("dividend", "nasdaq", ts, sym, format!("{} ex-dividend", r["companyName"].as_str().unwrap_or(sym).trim()), "low", None, None, rate, (!detail.is_empty()).then_some(detail)))
    }).collect()).unwrap_or_default()
}

pub fn parse_nq_splits(v: &Value) -> Vec<CalEvent> {
    v["data"]["rows"].as_array().map(|rows| rows.iter().filter_map(|r| {
        let sym = r["symbol"].as_str()?.trim();
        let ts = us_date(r["executionDate"].as_str()?, 13, 30)?;
        let ratio = r["ratio"].as_str().unwrap_or("").trim().to_string();
        Some(company("split", "nasdaq", ts, sym, format!("{} stock split {ratio}", r["name"].as_str().unwrap_or(sym).trim()), "low", None, None, None, None))
    }).collect()).unwrap_or_default()
}

/// IPOs of a month: priced ones and the upcoming table.
pub fn parse_nq_ipos(v: &Value) -> Vec<CalEvent> {
    let mut out = Vec::new();
    let d = &v["data"];
    let rows = |x: &Value| x.as_array().cloned().unwrap_or_default();
    let mut add = |r: &Value, date_keys: &[&str], status: &str| {
        let Some(sym) = r["proposedTickerSymbol"].as_str().map(str::trim).filter(|x| !x.is_empty()) else { return };
        let Some(ts) = date_keys.iter().find_map(|k| r[*k].as_str().and_then(|s| us_date(s, 14, 30))) else { return };
        let detail = [r["proposedExchange"].as_str().map(str::to_string), r["proposedSharePrice"].as_str().map(|p| format!("price {p}")), r["dollarValueOfSharesOffered"].as_str().filter(|x| !x.is_empty()).map(|a| format!("offer {a}"))]
            .into_iter().flatten().collect::<Vec<_>>().join(" · ");
        out.push(company("ipo", "nasdaq", ts, sym, format!("{} IPO ({status})", r["companyName"].as_str().unwrap_or(sym).trim()), "low", None, None, None, (!detail.is_empty()).then_some(detail)));
    };
    for r in rows(&d["priced"]["rows"]) { add(&r, &["pricedDate"], "priced"); }
    for r in rows(&d["upcoming"]["upcomingTable"]["rows"]) { add(&r, &["expectedPriceDate", "pricedDate"], "expected"); }
    out
}

/// All company events of one day: earnings, ex-dividends, splits.
pub async fn nasdaq_day(http: &reqwest::Client, date: &str) -> Result<Vec<CalEvent>> {
    let (e, d, s) = tokio::join!(nq_json(http, "/calendar/earnings", date), nq_json(http, "/calendar/dividends", date), nq_json(http, "/calendar/splits", date));
    let mut out = Vec::new();
    let e = e?;
    out.extend(parse_nq_earnings(&e, date));
    if let Ok(d) = d { out.extend(parse_nq_dividends(&d)); }
    if let Ok(s) = s { out.extend(parse_nq_splits(&s)); }
    Ok(out)
}

pub async fn nasdaq_ipos(http: &reqwest::Client, month: &str) -> Result<Vec<CalEvent>> {
    Ok(parse_nq_ipos(&nq_json(http, "/ipo/calendar", month).await?))
}

// ---------------------------------------------------------------- the window

static BG: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[derive(Serialize, Deserialize)]
struct Day { at: i64, ev: Vec<CalEvent> }

fn cached(cache: &Cache, key: &str) -> Option<Day> {
    cache.kv_get(key).ok().flatten().and_then(|j| serde_json::from_str(&j).ok())
}

fn store(cache: &Cache, key: &str, at: i64, ev: Vec<CalEvent>) {
    if let Ok(j) = serde_json::to_string(&Day { at, ev }) { let _ = cache.kv_set(key, &j); }
}

/// Clears the background flag however the refresh ends (also on a panic), so the calendar never reports "pending" forever.
struct BgGuard;
impl Drop for BgGuard { fn drop(&mut self) { BG.store(false, std::sync::atomic::Ordering::SeqCst); } }

/// Fetch company days and IPO months into the cache, nearest days first, 12 requests at a time.
async fn refresh(cache: Arc<Cache>, http: reqwest::Client, mut days: Vec<chrono::NaiveDate>, months: Vec<String>) {
    let _guard = BgGuard;
    let now = chrono::Utc::now().timestamp();
    let today = chrono::Utc::now().date_naive();
    days.sort_by_key(|d| (*d - today).num_days().abs());
    let mut first_error: Option<String> = None;
    for chunk in days.chunks(12) {
        let handles: Vec<_> = chunk.iter().map(|d| { let (http, date) = (http.clone(), d.to_string()); tokio::spawn(async move { nasdaq_day(&http, &date).await }) }).collect();
        for (d, h) in chunk.iter().zip(handles) {
            match h.await {
                Ok(Ok(ev)) => store(&cache, &format!("cal_nq_{d}"), now, ev),
                Ok(Err(e)) => { first_error.get_or_insert(e.to_string()); }
                Err(_) => {}
            }
        }
    }
    for month in months {
        match nasdaq_ipos(&http, &month).await {
            Ok(ev) => store(&cache, &format!("cal_ipo_{month}"), now, ev),
            Err(e) => { first_error.get_or_insert(e.to_string()); }
        }
    }
    let _ = cache.kv_set("cal_nq_error", &first_error.unwrap_or_default());
}

/// Events in [from, to] (unix seconds): macro (Forex Factory weekly feed always, Financial Modeling Prep with a key) and company events (earnings, ex-dividends,
/// splits per weekday, IPOs per month; keyless from Nasdaq, for the part of the window within 30 days back and 21 days ahead).
/// Answers at once with what is cached; missing or stale company days are fetched in the background (`pending` = ask again shortly).
/// Macro is refreshed hourly (or when `force`); company days: today and the next 2 days hourly, further out every 6 hours, past days once.
pub async fn window(cache: Arc<Cache>, http: reqwest::Client, fmp_key: Option<String>, from: i64, to: i64, force: bool) -> Result<CalendarResult> {
    use chrono::Datelike;
    let now = Utc::now().timestamp();
    let mut errors = Vec::new();
    let fmp_key_present = fmp_key.is_some();

    // ---- macro
    let mut all: Vec<CalEvent> = cache.kv_get("calendar")?.and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default();
    all.retain(|e| e.kind == "macro");
    let at: i64 = cache.kv_get("calendar_at")?.and_then(|v| v.parse().ok()).unwrap_or(0);
    let kv_i64 = |k: &str| cache.kv_get(k).ok().flatten().and_then(|v| v.parse::<i64>().ok()).unwrap_or(0);
    // a manual refresh may not hammer the providers: at most every 5 minutes
    if (force && now - at > 300) || now - at > 3600 {
        let keep_from = now - 120 * 86400;
        let mut ok = false;
        // Forex Factory rate-limits (HTTP 429): after a failure wait before asking again and keep showing the cached events
        if now >= kv_i64("cal_ff_until") {
            match forex_factory(&http).await {
                Ok(rows) => { all = merge(all, rows, keep_from); ok = true; }
                Err(e) => {
                    let msg = e.to_string();
                    let _ = cache.kv_set("cal_ff_until", &(now + if msg.contains("429") { 3600 } else { 300 }).to_string());
                    if all.is_empty() { errors.push(ProviderError { provider: "forexfactory".into(), error: msg }); }
                }
            }
        }
        if let Some(key) = fmp_key.clone() {
            if now >= kv_i64("fmp_until") {
                let (f, t) = (from.max(now - 90 * 86400), to.min(now + 60 * 86400));
                match fmp(&http, &key, f, t).await {
                    Ok(rows) => {
                        // FMP covers this window: drop the feed's rows inside it so nothing shows twice
                        all.retain(|e| !(e.provider == "ff" && e.ts >= f && e.ts <= t + 86400));
                        all = merge(all, rows, keep_from); ok = true;
                    }
                    Err(e) => {
                        let msg = e.to_string();
                        // 401 / 402 / 403: the plan or key does not include the calendar. Do not ask again for a day.
                        let denied = ["401", "402", "403"].iter().any(|c| msg.contains(c));
                        let _ = cache.kv_set("fmp_until", &(now + if denied { 86400 } else { 600 }).to_string());
                        if !denied { errors.push(ProviderError { provider: "fmp".into(), error: msg }); }
                    }
                }
            }
        }
        if ok {
            cache.kv_set("calendar", &serde_json::to_string(&all).map_err(|e| Error::Other(e.to_string()))?)?;
            cache.kv_set("calendar_at", &now.to_string())?;
        }
    }

    // ---- companies: serve the cache, refresh what is missing in the background
    let day_of = |t: i64| DateTime::<Utc>::from_timestamp(t, 0).unwrap_or_default().date_naive();
    let (cf, ct) = (day_of(from.max(now - 30 * 86400)), day_of(to.min(now + 21 * 86400)));
    let today = day_of(now);
    let mut company: Vec<CalEvent> = Vec::new();
    let mut todo = Vec::new();
    let mut d = cf;
    let mut n = 0;
    while d <= ct && n < 45 {
        if d.weekday().number_from_monday() <= 5 {
            n += 1;
            match cached(&cache, &format!("cal_nq_{d}")) {
                Some(c) => {
                    let ttl = if d <= today + chrono::Duration::days(2) { 3600 } else { 6 * 3600 };
                    let stale = !(d < today - chrono::Duration::days(1) || now - c.at < ttl) || (force && d >= today - chrono::Duration::days(1));
                    company.extend(c.ev);
                    if stale { todo.push(d); }
                }
                None => todo.push(d),
            }
        }
        d = d.succ_opt().unwrap_or(ct + chrono::Duration::days(1));
    }
    let mut months = Vec::new();
    let mut m = cf.with_day(1).unwrap_or(cf);
    while m <= ct && months.len() < 3 {
        let key = m.format("%Y-%m").to_string();
        match cached(&cache, &format!("cal_ipo_{key}")) {
            Some(c) => { let stale = now - c.at >= 12 * 3600 || force; company.extend(c.ev); if stale { months.push(key); } }
            None => months.push(key),
        }
        m = (m + chrono::Duration::days(32)).with_day(1).unwrap_or(ct + chrono::Duration::days(1));
    }
    let mut pending = BG.load(std::sync::atomic::Ordering::SeqCst);
    if (!todo.is_empty() || !months.is_empty()) && !BG.swap(true, std::sync::atomic::Ordering::SeqCst) {
        pending = true;
        tokio::spawn(refresh(cache.clone(), http.clone(), todo, months));
    }
    if fmp_key_present && now < kv_i64("fmp_until") && kv_i64("fmp_until") - now > 3600 {
        errors.push(ProviderError { provider: "fmp".into(), error: "your Financial Modeling Prep plan does not include the economic calendar (HTTP 402), so the key is ignored for now. Clear the key in Settings or upgrade the plan.".into() });
    }
    if let Some(e) = cache.kv_get("cal_nq_error")?.filter(|e| !e.is_empty()) { errors.push(ProviderError { provider: "nasdaq".into(), error: e }); }

    let mut seen = std::collections::HashSet::new();
    let mut items: Vec<CalEvent> = all.into_iter().chain(company).filter(|e| e.ts >= from && e.ts <= to && seen.insert(e.id.clone())).collect();
    items.sort_by(|a, b| a.ts.cmp(&b.ts).then_with(|| b.impact.cmp(&a.impact)).then_with(|| a.title.cmp(&b.title)));
    Ok(CalendarResult { items, errors, pending })
}

/// Merge fresh rows into the cached ones (same id replaces, older than `keep_from` is dropped), sorted by time.
pub fn merge(mut old: Vec<CalEvent>, fresh: Vec<CalEvent>, keep_from: i64) -> Vec<CalEvent> {
    let ids: std::collections::HashSet<String> = fresh.iter().map(|e| e.id.clone()).collect();
    old.retain(|e| !ids.contains(&e.id) && e.ts >= keep_from);
    old.extend(fresh.into_iter().filter(|e| e.ts >= keep_from));
    old.sort_by_key(|e| e.ts);
    old
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_forex_factory_rows() {
        let v = json!([{"title":"CPI y/y","country":"USD","date":"2026-10-14T08:30:00-04:00","impact":"High","forecast":"2.9%","previous":"2.9%"},
                       {"title":"Bank Holiday","country":"JPY","date":"2026-10-12T19:00:00-04:00","impact":"Holiday","forecast":"","previous":""}]);
        let e = parse_ff(&v);
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].ts, 1_791_981_000);
        assert_eq!(e[0].impact, "high");
        assert_eq!(e[0].forecast.as_deref(), Some("2.9%"));
        assert_eq!(e[1].impact, "holiday");
        assert_eq!(e[1].forecast, None);
    }

    #[test]
    fn parses_nasdaq_company_rows() {
        let e = parse_nq_earnings(&json!({"data":{"rows":[{"lastYearEPS":"$2.98","time":"time-after-hours","symbol":"V","name":"Visa Inc.","marketCap":"$740,324,150,000","fiscalQuarterEnding":"Sep/2026","epsForecast":"$3.43","noOfEsts":"12"}]}}), "2026-10-27");
        assert_eq!(e.len(), 1);
        assert_eq!((e[0].kind.as_str(), e[0].symbol.as_deref(), e[0].impact.as_str()), ("earnings", Some("V"), "high"));
        assert_eq!(e[0].forecast.as_deref(), Some("$3.43"));
        assert!(e[0].detail.as_deref().unwrap().contains("market cap $740B"));
        let d = parse_nq_dividends(&json!({"data":{"calendar":{"rows":[{"companyName":"ASML","symbol":"ASML","dividend_Ex_Date":"10/27/2026","payment_Date":"11/04/2026","dividend_Rate":2.107668,"indicated_Annual_Dividend":8.60288}]}}}));
        assert_eq!(d[0].actual.as_deref(), Some("$2.1077"));
        let s = parse_nq_splits(&json!({"data":{"rows":[{"symbol":"EFG","name":"iShares EAFE","ratio":"3 : 1","executionDate":"11/05/2026"}]}}));
        assert_eq!(s[0].kind, "split");
        let i = parse_nq_ipos(&json!({"data":{"priced":{"rows":[{"proposedTickerSymbol":"DAVI","companyName":"DAVION","pricedDate":"10/22/2026","proposedExchange":"NASDAQ"}]},"upcoming":{"upcomingTable":{"rows":null}}}}));
        assert_eq!(i.len(), 1);
    }

    #[test]
    fn parses_fmp_rows_and_merges() {
        let v = json!([{"date":"2026-10-14 12:30:00","country":"US","currency":"USD","event":"CPI YoY","impact":"High","estimate":2.9,"previous":2.8,"actual":3.0}]);
        let e = parse_fmp(&v);
        assert_eq!(e[0].ts, 1_791_981_000);
        assert_eq!(e[0].actual.as_deref(), Some("3.0"));
        assert_eq!(e[0].forecast.as_deref(), Some("2.9"));
        let mut newer = e[0].clone();
        newer.actual = Some("3.1".into());
        let merged = merge(e, vec![newer], 0);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].actual.as_deref(), Some("3.1"));
        assert!(merge(merged, vec![], 2_000_000_000).is_empty());
    }

    #[tokio::test]
    #[ignore] // network
    async fn live_nasdaq_and_forex_factory() {
        let http = reqwest::Client::new();
        let mut d = chrono::Utc::now().date_naive() + chrono::Duration::days(2);
        while chrono::Datelike::weekday(&d).number_from_monday() > 5 { d += chrono::Duration::days(1); }
        let ev = nasdaq_day(&http, &d.to_string()).await.unwrap();
        assert!(ev.iter().any(|e| e.kind == "earnings"), "no earnings on {d}");
        assert!(!forex_factory(&http).await.unwrap().is_empty());
        assert!(!nasdaq_ipos(&http, &d.format("%Y-%m").to_string()).await.unwrap().is_empty());
    }

    #[tokio::test]
    #[ignore] // network
    async fn live_window_returns_this_week_and_company_days() {
        let cache = Arc::new(Cache::memory().unwrap());
        let http = reqwest::Client::new();
        let now = Utc::now().timestamp();
        let (from, to) = (now - 2 * 86400, now + 5 * 86400);
        let first = window(cache.clone(), http.clone(), None, from, to, false).await.unwrap();
        assert!(first.items.iter().any(|e| e.kind == "macro"), "no macro events: {:?}", first.errors.iter().map(|e| &e.error).collect::<Vec<_>>());
        for _ in 0..40 {
            let r = window(cache.clone(), http.clone(), None, from, to, false).await.unwrap();
            if !r.pending {
                assert!(r.items.iter().any(|e| e.kind == "earnings"), "no earnings");
                let ids: std::collections::HashSet<_> = r.items.iter().map(|e| &e.id).collect();
                assert_eq!(ids.len(), r.items.len(), "duplicate ids");
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
        panic!("still pending after 20 s");
    }
}
