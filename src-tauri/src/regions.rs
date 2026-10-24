//! Economic regions of a symbol, for the calendar: which macro-event currencies belong on its chart.
//! Known symbols come from the bundled table in the UI; this resolves the rest: the Nasdaq company profile (country, keyless) first,
//! else Groq (works for ETFs, foreign tickers, indices). Results are cached in the kv table for good.
use crate::model::{Error, Result};
use serde_json::Value;

/// Currencies the macro calendar uses.
pub const CURRENCIES: [&str; 9] = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "NZD", "CHF", "CNY"];

const EURO: [&str; 20] = ["Netherlands", "Germany", "France", "Spain", "Italy", "Ireland", "Belgium", "Luxembourg", "Finland", "Austria", "Portugal", "Greece", "Cyprus", "Estonia", "Latvia", "Lithuania", "Malta", "Slovakia", "Slovenia", "Croatia"];

/// Home currency first, USD second (ADRs trade in dollars). Same rule as `scripts/gen-symbol-regions.mjs`.
pub fn country_currencies(country: &str) -> Vec<String> {
    let c = country.trim();
    let home = if EURO.contains(&c) { "EUR" } else {
        match c {
            "Canada" => "CAD",
            "United Kingdom" | "Guernsey" | "Jersey" | "Isle of Man" => "GBP",
            "Japan" => "JPY",
            "Australia" => "AUD",
            "New Zealand" => "NZD",
            "Switzerland" => "CHF",
            "China" | "Hong Kong" | "Macau" => "CNY",
            _ => return vec!["USD".into()],
        }
    };
    vec![home.into(), "USD".into()]
}

pub async fn nasdaq_country(http: &reqwest::Client, symbol: &str) -> Result<String> {
    let v: Value = http.get(format!("https://api.nasdaq.com/api/company/{symbol}/company-profile"))
        .timeout(std::time::Duration::from_secs(10))
        .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/120.0").header("Accept", "application/json")
        .header("Origin", "https://www.nasdaq.com").header("Referer", "https://www.nasdaq.com/")
        .send().await?.error_for_status()?.json().await?;
    v["data"]["Country"]["value"].as_str().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).ok_or_else(|| Error::Other("no country in profile".into()))
}

pub fn messages(symbol: &str) -> Value {
    let system = "You map a traded security (stock, ETF, index, currency pair or crypto) to the economic regions whose macro news move it. \
        Answer ONLY with one JSON object {\"currencies\": [...]} holding 1 to 3 codes from USD, EUR, GBP, JPY, CAD, AUD, NZD, CHF, CNY, the home economy first. \
        US-listed securities include USD. Examples: AAPL -> [\"USD\"], ASML -> [\"EUR\",\"USD\"], EUR/USD -> [\"EUR\",\"USD\"], SPY -> [\"USD\"], ^N225 -> [\"JPY\"], BTC/USD -> [\"USD\"].";
    serde_json::json!([{"role": "system", "content": system}, {"role": "user", "content": format!("Symbol: {symbol}")}])
}

pub fn parse_currencies(content: &str) -> Result<Vec<String>> {
    let a = content.find('{').ok_or_else(|| Error::Other("model returned no JSON".into()))?;
    let b = content.rfind('}').ok_or_else(|| Error::Other("model returned no JSON".into()))?;
    let v: Value = serde_json::from_str(&content[a..=b]).map_err(|e| Error::Other(format!("bad model JSON: {e}")))?;
    let mut out: Vec<String> = Vec::new();
    for c in v["currencies"].as_array().into_iter().flatten().filter_map(|x| x.as_str()) {
        let u = c.trim().to_uppercase();
        if CURRENCIES.contains(&u.as_str()) && !out.contains(&u) { out.push(u); }
    }
    out.truncate(3);
    if out.is_empty() { Err(Error::Other("no usable currency".into())) } else { Ok(out) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_countries_and_parses_the_model_answer() {
        assert_eq!(country_currencies("United States"), vec!["USD"]);
        assert_eq!(country_currencies("Netherlands"), vec!["EUR", "USD"]);
        assert_eq!(country_currencies("Hong Kong"), vec!["CNY", "USD"]);
        assert_eq!(parse_currencies("```json\n{\"currencies\":[\"eur\",\"XXX\",\"USD\",\"EUR\"]}\n```").unwrap(), vec!["EUR", "USD"]);
        assert!(parse_currencies("{\"currencies\":[\"XXX\"]}").is_err());
    }
}
