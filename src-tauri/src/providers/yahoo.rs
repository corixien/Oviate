use crate::model::{aggregate, Candles, Error, Result, SymbolHit, Timeframe};
use serde_json::Value;

const UA: &str = "Mozilla/5.0 (X11; Linux x86_64) Oviate/0.1";

pub fn parse_chart(v: &Value) -> Result<Candles> {
    let res = v["chart"]["result"].get(0).ok_or_else(|| {
        let msg = v["chart"]["error"]["description"].as_str().unwrap_or("no data");
        Error::Other(format!("yahoo: {msg}"))
    })?;
    let ts = res["timestamp"].as_array().cloned().unwrap_or_default();
    let q = &res["indicators"]["quote"][0];
    let mut out = Candles::default();
    for (i, t) in ts.iter().enumerate() {
        let f = |k: &str| q[k][i].as_f64();
        if let (Some(t), Some(o), Some(h), Some(l), Some(c)) = (t.as_i64(), f("open"), f("high"), f("low"), f("close")) {
            out.push(t, o, h, l, c, f("volume").unwrap_or(0.0));
        }
    }
    Ok(out)
}

pub async fn candles(http: &reqwest::Client, symbol: &str, tf: Timeframe, from: i64, to: i64) -> Result<Candles> {
    // Yahoo limits intraday lookback (1m: 7d, <=30m: 60d, 1h: 730d); clamp so the request is not rejected.
    let now = chrono::Utc::now().timestamp();
    let max_back = match tf {
        Timeframe::M1 => 7 * 86400,
        Timeframe::M5 | Timeframe::M15 | Timeframe::M30 => 59 * 86400,
        Timeframe::H1 | Timeframe::H4 => 729 * 86400,
        _ => i64::MAX / 4,
    };
    let from = from.max(now - max_back);
    if from >= to {
        return Ok(Candles::default());
    }
    let url = format!("https://query1.finance.yahoo.com/v8/finance/chart/{}", urlenc(symbol));
    let v: Value = http
        .get(url)
        .header("User-Agent", UA)
        .query(&[
            ("interval", tf.yahoo()),
            ("period1", &from.to_string()),
            ("period2", &to.to_string()),
            ("includePrePost", "false"),
        ])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let c = parse_chart(&v)?;
    Ok(if tf == Timeframe::H4 { aggregate(&c, 14400) } else { c })
}

pub async fn search(http: &reqwest::Client, q: &str) -> Result<Vec<SymbolHit>> {
    let v: Value = http
        .get("https://query2.finance.yahoo.com/v1/finance/search")
        .header("User-Agent", UA)
        .query(&[("q", q), ("quotesCount", "12"), ("newsCount", "0")])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(v["quotes"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| {
                    Some(SymbolHit {
                        symbol: x["symbol"].as_str()?.to_string(),
                        name: x["longname"].as_str().or(x["shortname"].as_str()).unwrap_or("").to_string(),
                        exchange: x["exchDisp"].as_str().unwrap_or("").to_string(),
                        kind: x["quoteType"].as_str().unwrap_or("").to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

fn urlenc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_chart_and_skips_null_bars() {
        let v: Value = serde_json::from_str(
            r#"{"chart":{"result":[{"timestamp":[1,2,3],"indicators":{"quote":[{
            "open":[1.0,null,3.0],"high":[2.0,null,4.0],"low":[0.5,null,2.5],"close":[1.5,null,3.5],"volume":[10,null,30]}]}}]}}"#,
        )
        .unwrap();
        let c = parse_chart(&v).unwrap();
        assert_eq!(c.len(), 2);
        assert_eq!(c.t, vec![1, 3]);
        assert_eq!(c.v[1], 30.0);
    }
}
