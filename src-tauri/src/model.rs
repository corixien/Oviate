use serde::{Deserialize, Serialize};

/// Columnar candle block, cheap to serialize and hand to the renderer.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Candles {
    pub t: Vec<i64>,
    pub o: Vec<f64>,
    pub h: Vec<f64>,
    pub l: Vec<f64>,
    pub c: Vec<f64>,
    pub v: Vec<f64>,
}

impl Candles {
    pub fn len(&self) -> usize {
        self.t.len()
    }
    pub fn is_empty(&self) -> bool {
        self.t.is_empty()
    }
    pub fn push(&mut self, t: i64, o: f64, h: f64, l: f64, c: f64, v: f64) {
        self.t.push(t);
        self.o.push(o);
        self.h.push(h);
        self.l.push(l);
        self.c.push(c);
        self.v.push(v);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Timeframe {
    #[serde(rename = "1m")]
    M1,
    #[serde(rename = "5m")]
    M5,
    #[serde(rename = "15m")]
    M15,
    #[serde(rename = "30m")]
    M30,
    #[serde(rename = "1h")]
    H1,
    #[serde(rename = "4h")]
    H4,
    #[serde(rename = "1d")]
    D1,
    #[serde(rename = "1w")]
    W1,
    #[serde(rename = "1M")]
    Mo1,
}

impl Timeframe {
    pub fn key(self) -> &'static str {
        match self {
            Self::M1 => "1m",
            Self::M5 => "5m",
            Self::M15 => "15m",
            Self::M30 => "30m",
            Self::H1 => "1h",
            Self::H4 => "4h",
            Self::D1 => "1d",
            Self::W1 => "1w",
            Self::Mo1 => "1M",
        }
    }
    pub fn seconds(self) -> i64 {
        match self {
            Self::M1 => 60,
            Self::M5 => 300,
            Self::M15 => 900,
            Self::M30 => 1800,
            Self::H1 => 3600,
            Self::H4 => 14400,
            Self::D1 => 86400,
            Self::W1 => 604800,
            Self::Mo1 => 2_592_000,
        }
    }
    /// Alpaca `timeframe` query value.
    pub fn alpaca(self) -> &'static str {
        match self {
            Self::M1 => "1Min",
            Self::M5 => "5Min",
            Self::M15 => "15Min",
            Self::M30 => "30Min",
            Self::H1 => "1Hour",
            Self::H4 => "4Hour",
            Self::D1 => "1Day",
            Self::W1 => "1Week",
            Self::Mo1 => "1Month",
        }
    }
    /// Yahoo interval; 4h is not offered and gets aggregated from 1h.
    pub fn yahoo(self) -> &'static str {
        match self {
            Self::M1 => "1m",
            Self::M5 => "5m",
            Self::M15 => "15m",
            Self::M30 => "30m",
            Self::H1 | Self::H4 => "60m",
            Self::D1 => "1d",
            Self::W1 => "1wk",
            Self::Mo1 => "1mo",
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("db: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("keyring: {0}")]
    Keyring(String),
    #[error("{0}")]
    Other(String),
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone, Serialize)]
pub struct SymbolHit {
    pub symbol: String,
    pub name: String,
    pub exchange: String,
    pub kind: String,
}

/// Aggregate candles into buckets of `bucket` seconds (used for 4h from 1h).
pub fn aggregate(src: &Candles, bucket: i64) -> Candles {
    let mut out = Candles::default();
    let mut cur = i64::MIN;
    for i in 0..src.len() {
        let b = src.t[i].div_euclid(bucket) * bucket;
        if b != cur {
            out.push(b, src.o[i], src.h[i], src.l[i], src.c[i], src.v[i]);
            cur = b;
        } else {
            let k = out.len() - 1;
            out.h[k] = out.h[k].max(src.h[i]);
            out.l[k] = out.l[k].min(src.l[i]);
            out.c[k] = src.c[i];
            out.v[k] += src.v[i];
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aggregates_hourly_into_4h() {
        let mut c = Candles::default();
        for i in 0..8 {
            c.push(i * 3600, 1.0 + i as f64, 2.0 + i as f64, 0.5, 1.5 + i as f64, 10.0);
        }
        let a = aggregate(&c, 14400);
        assert_eq!(a.len(), 2);
        assert_eq!(a.v[0], 40.0);
        assert_eq!(a.o[1], 5.0);
        assert_eq!(a.c[0], 4.5);
    }
}
