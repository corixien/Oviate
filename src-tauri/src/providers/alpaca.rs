use crate::model::{Candles, Error, Result, Timeframe};
use chrono::{DateTime, Utc};
use serde_json::Value;

#[derive(Clone)]
pub struct Keys {
    pub id: String,
    pub secret: String,
}

/// Crypto pairs look like BTC/USD.
pub fn is_crypto(symbol: &str) -> bool {
    symbol.contains('/')
}

/// Alpaca covers US equities/ETFs and crypto only.
pub fn supports(symbol: &str) -> bool {
    is_crypto(symbol)
        || (!symbol.contains(['^', '=', '.']) && symbol.chars().all(|c| c.is_ascii_alphabetic() || c == '-'))
}

pub fn parse_bars(arr: &[Value], out: &mut Candles) {
    for b in arr {
        let t = b["t"].as_str().and_then(|s| s.parse::<DateTime<Utc>>().ok()).map(|d| d.timestamp());
        if let (Some(t), Some(o), Some(h), Some(l), Some(c)) =
            (t, b["o"].as_f64(), b["h"].as_f64(), b["l"].as_f64(), b["c"].as_f64())
        {
            out.push(t, o, h, l, c, b["v"].as_f64().unwrap_or(0.0));
        }
    }
}

pub async fn candles(
    http: &reqwest::Client,
    keys: &Keys,
    symbol: &str,
    tf: Timeframe,
    from: i64,
    to: i64,
) -> Result<Candles> {
    let crypto = is_crypto(symbol);
    let url = if crypto {
        "https://data.alpaca.markets/v1beta3/crypto/us/bars".to_string()
    } else {
        format!("https://data.alpaca.markets/v2/stocks/{symbol}/bars")
    };
    let fmt = |t: i64| DateTime::<Utc>::from_timestamp(t, 0).unwrap_or_default().to_rfc3339();
    if from >= to {
        return Ok(Candles::default());
    }
    let mut out = Candles::default();
    let mut token: Option<String> = None;
    loop {
        let mut q: Vec<(&str, String)> = vec![
            ("timeframe", tf.alpaca().into()),
            ("start", fmt(from)),
            ("end", fmt(to)),
            ("limit", "10000".into()),
            ("sort", "asc".into()),
        ];
        if crypto {
            q.push(("symbols", symbol.into()));
        } else {
            q.push(("adjustment", "split".into()));
            q.push(("feed", "iex".into()));
        }
        if let Some(t) = &token {
            q.push(("page_token", t.clone()));
        }
        let v: Value = http
            .get(&url)
            .header("APCA-API-KEY-ID", &keys.id)
            .header("APCA-API-SECRET-KEY", &keys.secret)
            .query(&q)
            .send()
            .await?
            .error_for_status()
            .map_err(|e| Error::Other(format!("alpaca: {e}")))?
            .json()
            .await?;
        let arr = if crypto { &v["bars"][symbol] } else { &v["bars"] };
        if let Some(a) = arr.as_array() {
            parse_bars(a, &mut out);
        }
        match v["next_page_token"].as_str() {
            Some(t) => token = Some(t.to_string()),
            None => break,
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bars() {
        let v: Value = serde_json::from_str(
            r#"[{"t":"2024-01-02T14:30:00Z","o":1,"h":2,"l":0.5,"c":1.5,"v":100}]"#,
        )
        .unwrap();
        let mut c = Candles::default();
        parse_bars(v.as_array().unwrap(), &mut c);
        assert_eq!(c.t[0], 1704205800);
    }

    #[test]
    fn symbol_support() {
        assert!(supports("AAPL"));
        assert!(supports("BTC/USD"));
        assert!(!supports("^GSPC"));
        assert!(!supports("EURUSD=X"));
        assert!(!supports("SAP.DE"));
    }
}
