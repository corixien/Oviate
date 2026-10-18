//! Minimal MCP client (Streamable HTTP) with OAuth 2.1: dynamic client registration, PKCE, loopback redirect.
//! Used for the Liquid MCP (`get_news`). Tokens live in the OS keyring, never on disk.
use crate::model::{Error, Result};
use crate::news::{NewsItem};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

pub const LIQUID_URL: &str = "https://coinvest.liquid.trade/mcp";
/// Read-only access. The server also offers a `trade` scope, which Oviate must never request.
const SCOPE: &str = "read";
const PROTOCOL: &str = "2025-03-26";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tokens {
    pub access: String,
    pub refresh: Option<String>,
    pub expires_at: i64,
    pub client_id: String,
    pub token_endpoint: String,
}

fn other<E: ToString>(e: E) -> Error { Error::Other(e.to_string()) }

fn rand_string(n: usize) -> String {
    let bytes: Vec<u8> = (0..n).map(|_| rand::random::<u8>()).collect();
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn origin(url: &str) -> String {
    let u = reqwest::Url::parse(url).map(|u| u.origin().ascii_serialization());
    u.unwrap_or_else(|_| url.trim_end_matches('/').to_string())
}

/// Parse the query string of the loopback redirect request line: `GET /callback?code=..&state=.. HTTP/1.1`.
pub fn parse_callback(request: &str) -> Option<(String, String)> {
    let path = request.lines().next()?.split_whitespace().nth(1)?;
    let url = reqwest::Url::parse(&format!("http://127.0.0.1{path}")).ok()?;
    let get = |k: &str| url.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.to_string());
    if let Some(err) = get("error") { return Some((format!("error:{err}"), String::new())); }
    Some((get("code")?, get("state")?))
}

/// Full OAuth login. `open` receives the authorization URL (open it in the user's browser).
pub async fn login(http: &reqwest::Client, server_url: &str, open: impl FnOnce(&str) -> Result<()>) -> Result<Tokens> {
    let base = origin(server_url);
    let prm: Value = http.get(format!("{base}/.well-known/oauth-protected-resource")).send().await?.json().await.unwrap_or(Value::Null);
    let issuer = prm["authorization_servers"][0].as_str().map(|s| s.trim_end_matches('/').to_string()).unwrap_or(base.clone());
    let meta: Value = http.get(format!("{issuer}/.well-known/oauth-authorization-server")).send().await?.error_for_status()?.json().await?;
    let auth_ep = meta["authorization_endpoint"].as_str().ok_or_else(|| other("no authorization_endpoint"))?;
    let token_ep = meta["token_endpoint"].as_str().ok_or_else(|| other("no token_endpoint"))?.to_string();
    let reg_ep = meta["registration_endpoint"].as_str().ok_or_else(|| other("server has no dynamic client registration"))?;

    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(other)?;
    let port = listener.local_addr().map_err(other)?.port();
    let redirect = format!("http://127.0.0.1:{port}/callback");

    let reg: Value = http.post(reg_ep).json(&json!({
        "client_name": "Oviate", "redirect_uris": [redirect],
        "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
        "token_endpoint_auth_method": "none", "scope": SCOPE,
    })).send().await?.error_for_status()?.json().await?;
    let client_id = reg["client_id"].as_str().ok_or_else(|| other("registration returned no client_id"))?.to_string();

    let verifier = rand_string(48);
    let state = rand_string(16);
    let mut url = reqwest::Url::parse(auth_ep).map_err(other)?;
    url.query_pairs_mut()
        .append_pair("response_type", "code").append_pair("client_id", &client_id).append_pair("redirect_uri", &redirect)
        .append_pair("code_challenge", &pkce_challenge(&verifier)).append_pair("code_challenge_method", "S256")
        .append_pair("state", &state).append_pair("resource", server_url).append_pair("scope", SCOPE);
    open(url.as_str())?;

    let (mut sock, _) = tokio::time::timeout(std::time::Duration::from_secs(300), listener.accept())
        .await.map_err(|_| other("login timed out"))?.map_err(other)?;
    let mut buf = vec![0u8; 8192];
    let n = sock.read(&mut buf).await.map_err(other)?;
    let req = String::from_utf8_lossy(&buf[..n]).to_string();
    let parsed = parse_callback(&req);
    let ok = matches!(&parsed, Some((c, s)) if !c.starts_with("error:") && *s == state);
    let body = if ok { "<h2>Oviate is connected.</h2><p>You can close this tab.</p>" } else { "<h2>Login failed.</h2><p>Return to Oviate and try again.</p>" };
    let _ = sock.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await;
    let (code, got_state) = parsed.ok_or_else(|| other("invalid redirect"))?;
    if code.starts_with("error:") { return Err(other(format!("login denied ({code})"))); }
    if got_state != state { return Err(other("state mismatch")); }

    let tok: Value = http.post(&token_ep).form(&[
        ("grant_type", "authorization_code"), ("code", &code), ("redirect_uri", &redirect),
        ("client_id", &client_id), ("code_verifier", &verifier),
    ]).send().await?.error_for_status()?.json().await?;
    tokens_from(&tok, &client_id, &token_ep, None)
}

fn tokens_from(tok: &Value, client_id: &str, token_ep: &str, old_refresh: Option<&str>) -> Result<Tokens> {
    Ok(Tokens {
        access: tok["access_token"].as_str().ok_or_else(|| other("no access_token"))?.to_string(),
        refresh: tok["refresh_token"].as_str().map(str::to_string).or(old_refresh.map(str::to_string)),
        expires_at: chrono::Utc::now().timestamp() + tok["expires_in"].as_i64().unwrap_or(3600),
        client_id: client_id.to_string(),
        token_endpoint: token_ep.to_string(),
    })
}

/// Refresh when expired (or about to). Returns the (possibly new) tokens.
pub async fn ensure_fresh(http: &reqwest::Client, t: Tokens) -> Result<Tokens> {
    if t.expires_at - 60 > chrono::Utc::now().timestamp() { return Ok(t); }
    let Some(rt) = t.refresh.clone() else { return Err(other("session expired, log in again")) };
    let tok: Value = http.post(&t.token_endpoint).form(&[("grant_type", "refresh_token"), ("refresh_token", &rt), ("client_id", &t.client_id)])
        .send().await?.error_for_status().map_err(|_| other("session expired, log in again"))?.json().await?;
    tokens_from(&tok, &t.client_id, &t.token_endpoint, Some(&rt))
}

/// Parse a Streamable-HTTP response body: plain JSON or an SSE stream; returns the message with the given id.
pub fn parse_body(body: &str, id: i64) -> Result<Value> {
    let trimmed = body.trim_start();
    if trimmed.starts_with('{') {
        return Ok(serde_json::from_str(trimmed).map_err(other)?);
    }
    for line in body.lines() {
        if let Some(d) = line.strip_prefix("data:") {
            if let Ok(v) = serde_json::from_str::<Value>(d.trim()) {
                if v["id"] == id { return Ok(v); }
            }
        }
    }
    Err(other("no response message"))
}

async fn rpc(http: &reqwest::Client, url: &str, token: &str, session: Option<&str>, msg: Value) -> Result<(Value, Option<String>)> {
    let mut r = http.post(url).bearer_auth(token)
        .header("Accept", "application/json, text/event-stream").header("MCP-Protocol-Version", PROTOCOL).json(&msg);
    if let Some(s) = session { r = r.header("Mcp-Session-Id", s); }
    let resp = r.send().await?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED { return Err(other("unauthorized, log in again")); }
    let resp = resp.error_for_status()?;
    let sid = resp.headers().get("mcp-session-id").and_then(|v| v.to_str().ok()).map(str::to_string);
    let text = resp.text().await?;
    let id = msg["id"].as_i64().unwrap_or(0);
    if id == 0 { return Ok((Value::Null, sid)); }
    Ok((parse_body(&text, id)?, sid))
}

/// Call one MCP tool and return its concatenated text content.
pub async fn call_tool(http: &reqwest::Client, url: &str, token: &str, tool: &str, args: Value) -> Result<String> {
    let (init, sid) = rpc(http, url, token, None, json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": {"name":"oviate","version":"0.1"}}})).await?;
    if init["error"].is_object() { return Err(other(format!("mcp init: {}", init["error"]["message"]))); }
    let _ = rpc(http, url, token, sid.as_deref(), json!({"jsonrpc":"2.0","method":"notifications/initialized"})).await;
    let (res, _) = rpc(http, url, token, sid.as_deref(), json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":tool,"arguments":args}})).await?;
    if res["error"].is_object() { return Err(other(format!("mcp {tool}: {}", res["error"]["message"]))); }
    Ok(res["result"]["content"].as_array().map(|a| a.iter().filter_map(|c| c["text"].as_str()).collect::<Vec<_>>().join("\n")).unwrap_or_default())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Unusual { pub symbol: String, pub multiple: f64, pub volume: String }

/// Parse the Liquid `get_news` text: "Headlines:" list ("N. title — source (url)") and "Unusual Activity".
pub fn parse_liquid(text: &str) -> (Vec<NewsItem>, Vec<Unusual>) {
    let head = Regex::new(r"^\s*\d+\.\s+(.+)\s+—\s+(.+?)\s+\((https?://\S+)\)\s*$").unwrap();
    let unusual = Regex::new(r"^\s*\d+\.\s+(\S+)\s+—\s+([\d.]+)x vs 24h avg \(\$([\d.]+[KMBkmb]?) last hour\)").unwrap();
    let now = chrono::Utc::now().timestamp();
    let (mut news, mut un) = (Vec::new(), Vec::new());
    for line in text.lines() {
        if let Some(c) = head.captures(line) {
            news.push(NewsItem {
                id: format!("liquid:{}", &c[3]), headline: c[1].to_string(), source: c[2].to_string(), provider: "liquid".into(),
                summary: String::new(), url: c[3].to_string(), ts: now, symbols: vec![],
            });
        } else if let Some(c) = unusual.captures(line) {
            un.push(Unusual { symbol: c[1].to_string(), multiple: c[2].parse().unwrap_or(0.0), volume: format!("${}", &c[3]) });
        }
    }
    (news, un)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_matches_rfc7636_vector() {
        assert_eq!(pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn parses_callback_request() {
        let r = "GET /callback?code=abc%20d&state=xyz HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        assert_eq!(parse_callback(r), Some(("abc d".into(), "xyz".into())));
        assert_eq!(parse_callback("GET /callback?error=access_denied HTTP/1.1").unwrap().0, "error:access_denied");
    }

    #[test]
    fn parses_json_and_sse_bodies() {
        assert_eq!(parse_body(r#"{"jsonrpc":"2.0","id":2,"result":{}}"#, 2).unwrap()["id"], 2);
        let sse = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{\"a\":1}}\n\n";
        assert_eq!(parse_body(sse, 7).unwrap()["result"]["a"], 1);
        assert!(parse_body(sse, 8).is_err());
    }

    #[test]
    fn parses_liquid_text() {
        let t = "Headlines:\n1. Fed Has A Problem — TradingView (https://news.google.com/rss/articles/abc?oc=5)\n2. Oil — A - B — Moneycontrol.com (https://x.y/z)\n\nUnusual Activity (Liquid markets, last hour vs 24h avg):\n1. PENGU — 5.8x vs 24h avg ($45.0M last hour)\n2. CFX — 4.4x vs 24h avg ($525.2K last hour)";
        let (n, u) = parse_liquid(t);
        assert_eq!(n.len(), 2);
        assert_eq!(n[0].source, "TradingView");
        assert_eq!(n[1].headline, "Oil — A - B");
        assert_eq!(u[0], Unusual { symbol: "PENGU".into(), multiple: 5.8, volume: "$45.0M".into() });
        assert_eq!(u[1].volume, "$525.2K");
    }
}
