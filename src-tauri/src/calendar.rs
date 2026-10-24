//! Calendar of market events. Macro: the public Forex Factory weekly feed (USD, EUR, GBP, JPY, CAD, AUD, NZD, CHF, CNY; no key), plus Financial
//! Modeling Prep with a key (Settings: more countries, a wider window, actual values). Companies, keyless from Nasdaq: earnings (quarter, EPS estimate,
//! last year's EPS), ex-dividend dates, stock splits and IPOs.
use crate::model::{Error, Result};
use chrono::{DateTime, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

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
pub struct CalendarResult { pub items: Vec<CalEvent>, pub errors: Vec<ProviderError> }

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
        match http.get(*url).header("User-Agent", UA).send().await.and_then(|r| r.error_for_status()) {
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
}
