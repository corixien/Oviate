//! Economic calendar. Keyless default: the public Forex Factory weekly feed (this and next week, forecast and previous).
//! With a Financial Modeling Prep key (Settings) a wider window with actual values is fetched as well.
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
}

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
    CalEvent { id: format!("{provider}:{ts}:{country}:{title}"), ts, country: country.into(), title: title.into(), impact: impact_of(impact), actual, forecast, previous, provider: provider.into() }
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
}
