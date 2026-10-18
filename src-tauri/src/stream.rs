use crate::model::Result;
use crate::providers::alpaca;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;
use tokio_tungstenite::{connect_async, tungstenite::Message};

const STOCK_URL: &str = "wss://stream.data.alpaca.markets/v2/iex";
const CRYPTO_URL: &str = "wss://stream.data.alpaca.markets/v1beta3/crypto/us";

#[derive(Clone, Serialize)]
pub struct Tick {
    pub symbol: String,
    pub price: f64,
    pub size: f64,
    pub t: i64,
}

pub struct Streams {
    stock: watch::Sender<Vec<String>>,
    crypto: watch::Sender<Vec<String>>,
}

impl Streams {
    pub fn start(app: AppHandle) -> Self {
        let (stock, srx) = watch::channel(Vec::new());
        let (crypto, crx) = watch::channel(Vec::new());
        tauri::async_runtime::spawn(worker(app.clone(), STOCK_URL, srx));
        tauri::async_runtime::spawn(worker(app, CRYPTO_URL, crx));
        Self { stock, crypto }
    }

    pub fn set(&self, symbols: Vec<String>) {
        let (c, s): (Vec<_>, Vec<_>) = symbols.into_iter().partition(|x| alpaca::is_crypto(x));
        let upd = |tx: &watch::Sender<Vec<String>>, mut v: Vec<String>| {
            v.sort();
            v.dedup();
            tx.send_if_modified(|cur| if *cur != v { *cur = v; true } else { false });
        };
        upd(&self.stock, s.into_iter().filter(|x| alpaca::supports(x)).collect());
        upd(&self.crypto, c);
    }
}

async fn worker(app: AppHandle, url: &'static str, mut rx: watch::Receiver<Vec<String>>) {
    loop {
        let wanted = rx.borrow().clone();
        match (wanted.is_empty(), crate::load_keys()) {
            (false, Some(keys)) => {
                if let Err(e) = run(&app, url, &keys, &mut rx).await {
                    eprintln!("stream {url}: {e}");
                }
                tokio::time::sleep(std::time::Duration::from_secs(4)).await;
            }
            // Nothing to stream or no keys yet: re-check soon.
            _ => {
                tokio::select! {
                    r = rx.changed() => { if r.is_err() { return; } }
                    _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {}
                }
            }
        }
    }
}

async fn run(app: &AppHandle, url: &str, keys: &alpaca::Keys, rx: &mut watch::Receiver<Vec<String>>) -> Result<()> {
    let other = |e: String| crate::model::Error::Other(e);
    let (mut ws, _) = connect_async(url).await.map_err(|e| other(e.to_string()))?;
    ws.send(Message::text(json!({"action":"auth","key":keys.id,"secret":keys.secret}).to_string()))
        .await
        .map_err(|e| other(e.to_string()))?;
    let mut subscribed: HashSet<String> = HashSet::new();
    let mut authed = false;
    loop {
        tokio::select! {
            msg = ws.next() => {
                let Some(msg) = msg else { return Ok(()) };
                let msg = msg.map_err(|e| other(e.to_string()))?;
                let Message::Text(text) = msg else { continue };
                let Ok(Value::Array(items)) = serde_json::from_str::<Value>(&text) else { continue };
                for it in items {
                    match it["T"].as_str() {
                        Some("success") if it["msg"] == "authenticated" => authed = true,
                        Some("error") => return Err(other(format!("alpaca stream: {}", it["msg"]))),
                        Some("t") => {
                            if let (Some(s), Some(p)) = (it["S"].as_str(), it["p"].as_f64()) {
                                let t = it["t"].as_str().and_then(|x| x.parse::<chrono::DateTime<chrono::Utc>>().ok()).map(|d| d.timestamp()).unwrap_or(0);
                                let _ = app.emit("tick", Tick { symbol: s.to_string(), price: p, size: it["s"].as_f64().unwrap_or(0.0), t });
                            }
                        }
                        _ => {}
                    }
                }
            }
            r = rx.changed() => { if r.is_err() { return Ok(()); } }
        }
        if authed {
            let want: HashSet<String> = rx.borrow().iter().cloned().collect();
            let add: Vec<_> = want.difference(&subscribed).cloned().collect();
            let del: Vec<_> = subscribed.difference(&want).cloned().collect();
            if !add.is_empty() {
                ws.send(Message::text(json!({"action":"subscribe","trades":add}).to_string())).await.map_err(|e| other(e.to_string()))?;
            }
            if !del.is_empty() {
                ws.send(Message::text(json!({"action":"unsubscribe","trades":del}).to_string())).await.map_err(|e| other(e.to_string()))?;
            }
            subscribed = want;
        }
    }
}
