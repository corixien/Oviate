//! News aggregation. Providers mirror the Market-Data-MCP server:
//! Finnhub, NewsAPI, Google News RSS, Yahoo RSS, Seeking Alpha, central-bank and press RSS feeds,
//! plus Alpaca News (same keys as market data) and the Liquid MCP brief.
use crate::model::{Error, Result};
use crate::providers::alpaca;
use chrono::{DateTime, Duration, Utc};
use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;

const UA: &str = "Mozilla/5.0 (X11; Linux x86_64) Oviate/0.1";

#[derive(Debug, Clone, Serialize)]
pub struct NewsItem {
    pub id: String,
    pub headline: String,
    pub source: String,
    pub provider: String,
    pub summary: String,
    pub url: String,
    pub ts: i64,
    pub symbols: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderError {
    pub provider: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct NewsResult {
    pub items: Vec<NewsItem>,
    pub errors: Vec<ProviderError>,
}

#[derive(Clone, Default)]
pub struct NewsKeys {
    pub finnhub: Option<String>,
    pub newsapi: Option<String>,
    pub alpaca: Option<alpaca::Keys>,
}

pub const RSS_FEEDS: &[(&str, &str)] = &[
    ("fed_press", "https://www.federalreserve.gov/feeds/press_all.xml"),
    ("fed_monetary", "https://www.federalreserve.gov/feeds/press_monetary.xml"),
    ("ecb_press", "https://www.ecb.europa.eu/rss/press.xml"),
    ("tagesschau_wirtschaft", "https://www.tagesschau.de/wirtschaft/index~rss2.xml"),
    ("handelsblatt_finanzen", "https://www.handelsblatt.com/contentexport/feed/finanzen"),
    ("marketwatch_top", "https://feeds.marketwatch.com/marketwatch/topstories/"),
    ("cnbc_business", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147"),
    ("seekingalpha_currents", "https://seekingalpha.com/market_currents.xml"),
];

// ---------- helpers ----------

fn item(provider: &str, headline: &str, source: &str, summary: &str, url: &str, ts: i64, symbols: Vec<String>) -> NewsItem {
    NewsItem {
        id: format!("{provider}:{}", &url_or_headline(url, headline)),
        headline: headline.trim().to_string(),
        source: source.trim().to_string(),
        provider: provider.to_string(),
        summary: summary.trim().chars().take(400).collect(),
        url: url.to_string(),
        ts,
        symbols,
    }
}

fn url_or_headline(url: &str, headline: &str) -> String {
    if url.is_empty() { headline.chars().take(80).collect() } else { url.to_string() }
}

pub fn strip_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut depth = 0;
    for c in s.chars() {
        match c {
            '<' => depth += 1,
            '>' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&nbsp;", " ")
        .split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_ts(s: &str) -> i64 {
    DateTime::parse_from_rfc2822(s.trim())
        .or_else(|_| DateTime::parse_from_rfc3339(s.trim()))
        .map(|d| d.timestamp())
        .unwrap_or(0)
}

/// Parse an RSS 2.0 document into items (publisher falls back to `fallback_source`).
pub fn parse_rss(xml: &str, provider: &str, fallback_source: &str) -> Result<Vec<NewsItem>> {
    let doc = roxmltree::Document::parse_with_options(xml, roxmltree::ParsingOptions { allow_dtd: true, ..Default::default() })
        .map_err(|e| Error::Other(format!("rss parse: {e}")))?;
    let mut out = Vec::new();
    for it in doc.descendants().filter(|n| n.has_tag_name("item")) {
        let text = |name: &str| it.children().find(|c| c.has_tag_name(name)).and_then(|c| c.text()).unwrap_or("").to_string();
        let mut title = strip_html(&text("title"));
        let source = it.children().find(|c| c.has_tag_name("source")).and_then(|c| c.text()).map(str::to_string);
        if let Some(p) = &source {
            // Google News appends " - Publisher" to titles.
            if let Some(t) = title.strip_suffix(&format!(" - {p}")) { title = t.to_string(); }
        }
        if title.is_empty() { continue; }
        let ts = parse_ts(&text("pubDate"));
        out.push(item(provider, &title, source.as_deref().unwrap_or(fallback_source), &strip_html(&text("description")), text("link").trim(), ts, vec![]));
    }
    Ok(out)
}

/// Remove duplicate headlines (exact prefix and >=50% word overlap), newest first.
pub fn dedupe(mut items: Vec<NewsItem>, limit: usize) -> Vec<NewsItem> {
    items.sort_by(|a, b| b.ts.cmp(&a.ts));
    let stop: HashSet<&str> = ["the", "and", "with", "for", "from", "that", "its", "after", "says", "will", "has", "are", "was"].into();
    let word = Regex::new(r"[a-z0-9]{3,}").unwrap();
    let mut seen: HashSet<String> = HashSet::new();
    let mut sets: Vec<HashSet<String>> = Vec::new();
    let mut out = Vec::new();
    for it in items {
        let low = it.headline.to_lowercase();
        let key: String = low.chars().take(80).collect();
        if it.headline.is_empty() || it.headline == "[Removed]" || !seen.insert(key) { continue; }
        let words: HashSet<String> = word.find_iter(&low).map(|m| m.as_str().trim_end_matches('s').to_string()).filter(|w| !stop.contains(w.as_str())).collect();
        if !words.is_empty() && sets.iter().any(|o| (words.intersection(o).count() as f64) / (words.union(o).count() as f64) >= 0.5) { continue; }
        sets.push(words);
        out.push(it);
        if out.len() >= limit { break; }
    }
    out
}

async fn get_json(http: &reqwest::Client, url: &str, q: &[(&str, String)], headers: &[(&str, &str)]) -> Result<Value> {
    let mut r = http.get(url).header("User-Agent", UA).query(q);
    for (k, v) in headers { r = r.header(*k, *v); }
    Ok(r.send().await?.error_for_status()?.json().await?)
}

async fn get_text(http: &reqwest::Client, url: &str, q: &[(&str, String)]) -> Result<String> {
    Ok(http.get(url).header("User-Agent", UA).query(q).send().await?.error_for_status()?.text().await?)
}

fn ymd(d: DateTime<Utc>) -> String { d.format("%Y-%m-%d").to_string() }

// ---------- providers ----------

pub async fn finnhub_company(http: &reqwest::Client, key: &str, symbol: &str, days: i64) -> Result<Vec<NewsItem>> {
    let now = Utc::now();
    let v = get_json(http, "https://finnhub.io/api/v1/company-news", &[
        ("symbol", symbol.into()), ("from", ymd(now - Duration::days(days))), ("to", ymd(now)), ("token", key.into()),
    ], &[]).await?;
    Ok(finnhub_rows(&v, "finnhub", Some(symbol)))
}

pub async fn finnhub_market(http: &reqwest::Client, key: &str, category: &str) -> Result<Vec<NewsItem>> {
    let v = get_json(http, "https://finnhub.io/api/v1/news", &[("category", category.into()), ("token", key.into())], &[]).await?;
    Ok(finnhub_rows(&v, "finnhub", None))
}

fn finnhub_rows(v: &Value, provider: &str, sym: Option<&str>) -> Vec<NewsItem> {
    v.as_array().map(|a| a.iter().filter_map(|r| {
        let h = r["headline"].as_str()?;
        Some(item(provider, h, r["source"].as_str().unwrap_or(""), r["summary"].as_str().unwrap_or(""), r["url"].as_str().unwrap_or(""),
            r["datetime"].as_i64().unwrap_or(0), sym.map(|s| vec![s.to_string()]).unwrap_or_default()))
    }).collect()).unwrap_or_default()
}

pub async fn newsapi(http: &reqwest::Client, key: &str, query: &str, days: i64) -> Result<Vec<NewsItem>> {
    let from = ymd(Utc::now() - Duration::days(days.min(29)));
    let v = get_json(http, "https://newsapi.org/v2/everything", &[
        ("q", query.into()), ("from", from), ("sortBy", "publishedAt".into()), ("pageSize", "30".into()), ("language", "en".into()),
    ], &[("X-Api-Key", key)]).await?;
    if v["status"] != "ok" { return Err(Error::Other(format!("newsapi: {}", v["code"].as_str().unwrap_or("error")))); }
    Ok(v["articles"].as_array().map(|a| a.iter().filter_map(|r| {
        let h = r["title"].as_str()?;
        Some(item("newsapi", h, r["source"]["name"].as_str().unwrap_or(""), r["description"].as_str().unwrap_or(""), r["url"].as_str().unwrap_or(""),
            parse_ts(r["publishedAt"].as_str().unwrap_or("")), vec![]))
    }).collect()).unwrap_or_default())
}

pub async fn newsapi_headlines(http: &reqwest::Client, key: &str) -> Result<Vec<NewsItem>> {
    let v = get_json(http, "https://newsapi.org/v2/top-headlines", &[("category", "business".into()), ("language", "en".into()), ("pageSize", "30".into())], &[("X-Api-Key", key)]).await?;
    if v["status"] != "ok" { return Err(Error::Other(format!("newsapi: {}", v["code"].as_str().unwrap_or("error")))); }
    Ok(v["articles"].as_array().map(|a| a.iter().filter_map(|r| {
        let h = r["title"].as_str()?;
        Some(item("newsapi", h, r["source"]["name"].as_str().unwrap_or(""), r["description"].as_str().unwrap_or(""), r["url"].as_str().unwrap_or(""),
            parse_ts(r["publishedAt"].as_str().unwrap_or("")), vec![]))
    }).collect()).unwrap_or_default())
}

pub async fn google_news(http: &reqwest::Client, query: &str, days: i64) -> Result<Vec<NewsItem>> {
    let q = format!("{query} when:{days}d");
    let xml = get_text(http, "https://news.google.com/rss/search", &[("q", q), ("hl", "en".into()), ("gl", "US".into()), ("ceid", "US:en".into())]).await?;
    parse_rss(&xml, "google", "Google News")
}

pub async fn yahoo_rss(http: &reqwest::Client, symbol: &str) -> Result<Vec<NewsItem>> {
    let xml = get_text(http, "https://feeds.finance.yahoo.com/rss/2.0/headline", &[("s", symbol.into()), ("region", "US".into()), ("lang", "en-US".into())]).await?;
    let mut v = parse_rss(&xml, "yahoo", "Yahoo Finance")?;
    for i in &mut v { i.symbols = vec![symbol.to_string()]; }
    Ok(v)
}

pub async fn rss_feed(http: &reqwest::Client, name: &str, url: &str) -> Result<Vec<NewsItem>> {
    let xml = get_text(http, url, &[]).await?;
    parse_rss(&xml, name, name)
}

pub async fn alpaca_news(http: &reqwest::Client, keys: &alpaca::Keys, symbols: Option<&str>, limit: usize) -> Result<Vec<NewsItem>> {
    let mut q: Vec<(&str, String)> = vec![("limit", limit.to_string()), ("sort", "desc".into())];
    if let Some(s) = symbols { q.push(("symbols", s.replace('/', ""))); }
    let v = get_json(http, "https://data.alpaca.markets/v1beta1/news", &q, &[("APCA-API-KEY-ID", &keys.id), ("APCA-API-SECRET-KEY", &keys.secret)]).await?;
    Ok(v["news"].as_array().map(|a| a.iter().filter_map(|r| {
        let h = r["headline"].as_str()?;
        Some(item("alpaca", h, r["source"].as_str().unwrap_or("Benzinga"), r["summary"].as_str().unwrap_or(""), r["url"].as_str().unwrap_or(""),
            parse_ts(r["created_at"].as_str().unwrap_or("")),
            r["symbols"].as_array().map(|s| s.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default()))
    }).collect()).unwrap_or_default())
}

/// US/CA-style tickers work with Finnhub company news.
fn finnhub_ok(symbol: &str) -> bool { !symbol.contains(['/', '^', '=', '.']) }

fn query_for(symbol: &str) -> String { symbol.replace(['/', '-'], " ") }

type Job<'a> = std::pin::Pin<Box<dyn std::future::Future<Output = (String, Result<Vec<NewsItem>>)> + Send + 'a>>;

/// Query every configured provider concurrently. `symbol = None` returns market-wide news.
pub async fn fetch_all(http: &reqwest::Client, keys: &NewsKeys, symbol: Option<&str>, extra: Vec<NewsItem>, limit: usize) -> NewsResult {
    let mut jobs: Vec<Job> = Vec::new();
    macro_rules! job { ($name:expr, $fut:expr) => { jobs.push(Box::pin(async move { ($name.to_string(), $fut.await) })) }; }
    match symbol {
        Some(sym) => {
            let q = query_for(sym);
            if let Some(k) = &keys.finnhub { if finnhub_ok(sym) { let k = k.clone(); let s = sym.to_string(); let h = http.clone(); job!("finnhub", async move { finnhub_company(&h, &k, &s, 7).await }); } }
            if let Some(k) = &keys.newsapi { let k = k.clone(); let q = q.clone(); let h = http.clone(); job!("newsapi", async move { newsapi(&h, &k, &q, 7).await }); }
            if let Some(k) = &keys.alpaca { if alpaca::supports(sym) { let k = k.clone(); let s = sym.to_string(); let h = http.clone(); job!("alpaca", async move { alpaca_news(&h, &k, Some(&s), 30).await }); } }
            { let q = format!("{q} stock"); let h = http.clone(); job!("google", async move { google_news(&h, &q, 7).await }); }
            { let s = sym.replace('/', "-"); let h = http.clone(); job!("yahoo", async move { yahoo_rss(&h, &s).await }); }
        }
        None => {
            if let Some(k) = &keys.finnhub { let k = k.clone(); let h = http.clone(); job!("finnhub", async move { finnhub_market(&h, &k, "general").await }); }
            if let Some(k) = &keys.newsapi { let k = k.clone(); let h = http.clone(); job!("newsapi", async move { newsapi_headlines(&h, &k).await }); }
            if let Some(k) = &keys.alpaca { let k = k.clone(); let h = http.clone(); job!("alpaca", async move { alpaca_news(&h, &k, None, 30).await }); }
            { let h = http.clone(); job!("google", async move { google_news(&h, "stock market OR economy", 2).await }); }
            for (name, url) in RSS_FEEDS { let h = http.clone(); let (n, u) = (*name, *url); job!(n, async move { rss_feed(&h, n, u).await }); }
        }
    }
    let results = futures_util::future::join_all(jobs).await;
    let mut all = extra;
    let mut errors = Vec::new();
    for (provider, r) in results {
        match r { Ok(v) => all.extend(v), Err(e) => errors.push(ProviderError { provider, error: e.to_string() }) }
    }
    NewsResult { items: dedupe(all, limit), errors }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RSS: &str = r#"<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>Fed holds rates steady - Reuters</title><link>https://x/1</link><pubDate>Mon, 13 Oct 2025 14:00:00 GMT</pubDate><description>&lt;p&gt;Rates &amp;amp; markets&lt;/p&gt;</description><source url="https://reuters.com">Reuters</source></item>
      <item><title>Fed holds rates steady - Bloomberg</title><link>https://x/2</link><pubDate>Mon, 13 Oct 2025 15:00:00 GMT</pubDate><source url="https://b.com">Bloomberg</source></item>
      <item><title>Oil jumps on supply fears</title><link>https://x/3</link><pubDate>Mon, 13 Oct 2025 13:00:00 GMT</pubDate></item>
    </channel></rss>"#;

    #[test]
    fn parses_rss_and_strips_publisher() {
        let v = parse_rss(RSS, "google", "fallback").unwrap();
        assert_eq!(v.len(), 3);
        assert_eq!(v[0].headline, "Fed holds rates steady");
        assert_eq!(v[0].source, "Reuters");
        assert_eq!(v[0].summary, "Rates & markets");
        assert_eq!(v[2].source, "fallback");
        assert_eq!(v[0].ts, 1760364000);
    }

    #[test]
    fn dedupes_reworded_stories_and_sorts_newest_first() {
        let v = dedupe(parse_rss(RSS, "g", "f").unwrap(), 10);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].source, "Bloomberg");
    }

    #[test]
    fn finnhub_symbol_filter() {
        assert!(finnhub_ok("AAPL"));
        assert!(!finnhub_ok("BTC/USD"));
        assert!(!finnhub_ok("SAP.DE"));
    }

    /// Live network check of the keyless providers: `cargo test live_keyless -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn live_keyless() {
        let http = reqwest::Client::new();
        for sym in [None, Some("AAPL"), Some("BTC/USD")] {
            let r = fetch_all(&http, &NewsKeys::default(), sym, vec![], 40).await;
            println!("{:?}: {} items, errors: {:?}", sym, r.items.len(), r.errors.iter().map(|e| format!("{}: {}", e.provider, e.error)).collect::<Vec<_>>());
            for i in r.items.iter().take(3) { println!("  [{}] {} ({}) ts={}", i.provider, i.headline, i.source, i.ts); }
            assert!(!r.items.is_empty());
        }
    }
}
