//! Groq OpenAI-compatible API: news summaries and Pine code generation.
use crate::model::{Error, Result};
use crate::news::NewsItem;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const BASE: &str = "https://api.groq.com/openai/v1";
const PREFERRED: &[&str] = &["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "llama-3.1-70b-versatile", "openai/gpt-oss-20b", "llama-3.1-8b-instant"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AiSummary {
    pub what: String,
    pub impact: String,
    /// bullish | bearish | neutral | mixed
    pub direction: String,
    /// 1 (minor) .. 5 (major)
    pub intensity: u8,
    pub assets: Vec<String>,
    pub horizon: String,
    pub model: String,
}

pub fn build_messages(item: &NewsItem, lang: &str) -> Value {
    let language = if lang == "de" { "German" } else { "English" };
    let system = format!(
        "You are a concise markets analyst. Given a news item, answer ONLY with one JSON object with these keys: \
         \"what\" (1-2 sentences: what happened), \"impact\" (1-2 sentences: how this will likely affect markets and why), \
         \"direction\" (one of bullish, bearish, neutral, mixed), \"intensity\" (integer 1-5, 1 = minor, 5 = major market mover), \
         \"assets\" (array of up to 4 affected tickers, sectors or asset classes), \"horizon\" (one of intraday, days, weeks, months). \
         Be factual and brief. If the information is thin, say so in \"impact\" and use low intensity. Do not give investment advice. Write in {language}."
    );
    let when = chrono::DateTime::<chrono::Utc>::from_timestamp(item.ts, 0).map(|d| d.to_rfc3339()).unwrap_or_default();
    let user = format!(
        "Headline: {}\nSource: {}\nPublished: {}\nSymbols: {}\nSummary: {}",
        item.headline, item.source, when, item.symbols.join(", "), if item.summary.is_empty() { "(none)" } else { &item.summary }
    );
    json!([{"role": "system", "content": system}, {"role": "user", "content": user}])
}

pub fn parse_summary(content: &str, model: &str) -> Result<AiSummary> {
    let start = content.find('{').ok_or_else(|| Error::Other("model returned no JSON".into()))?;
    let end = content.rfind('}').ok_or_else(|| Error::Other("model returned no JSON".into()))?;
    let v: Value = serde_json::from_str(&content[start..=end]).map_err(|e| Error::Other(format!("bad model JSON: {e}")))?;
    let s = |k: &str| v[k].as_str().unwrap_or("").trim().to_string();
    let dir = s("direction").to_lowercase();
    Ok(AiSummary {
        what: s("what"),
        impact: s("impact"),
        direction: if ["bullish", "bearish", "neutral", "mixed"].contains(&dir.as_str()) { dir } else { "neutral".into() },
        intensity: v["intensity"].as_f64().map(|x| x.round().clamp(1.0, 5.0) as u8).unwrap_or(1),
        assets: v["assets"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).take(4).collect()).unwrap_or_default(),
        horizon: s("horizon"),
        model: model.to_string(),
    })
}

pub async fn pick_model(http: &reqwest::Client, key: &str) -> Result<String> {
    let v: Value = http.get(format!("{BASE}/models")).bearer_auth(key).send().await?.error_for_status()
        .map_err(|e| Error::Other(format!("groq: {e}")))?.json().await?;
    let ids: Vec<String> = v["data"].as_array().map(|a| a.iter().filter_map(|m| m["id"].as_str().map(str::to_string)).collect()).unwrap_or_default();
    PREFERRED.iter().find(|p| ids.iter().any(|i| i == *p)).map(|p| p.to_string())
        .or_else(|| ids.into_iter().find(|i| !i.contains("whisper") && !i.contains("guard") && !i.contains("tts")))
        .ok_or_else(|| Error::Other("groq: no usable model".into()))
}

/// One chat completion; returns the message content.
pub async fn chat(http: &reqwest::Client, key: &str, model: &str, messages: Value, temperature: f64, max_tokens: u32, json_mode: bool) -> Result<String> {
    let mut body = json!({ "model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens });
    if json_mode { body["response_format"] = json!({"type": "json_object"}); }
    let resp = http.post(format!("{BASE}/chat/completions")).bearer_auth(key).json(&body).send().await?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<Value>(&body).ok().and_then(|v| v["error"]["message"].as_str().map(str::to_string)).unwrap_or(body);
        return Err(Error::Other(format!("groq {}: {}", status.as_u16(), msg.chars().take(200).collect::<String>())));
    }
    let v: Value = resp.json().await?;
    Ok(v["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_model_json_with_noise() {
        let c = "Sure!\n```json\n{\"what\":\"Fed holds.\",\"impact\":\"Calm.\",\"direction\":\"Bullish\",\"intensity\":7,\"assets\":[\"SPY\",\"TLT\"],\"horizon\":\"days\"}\n```";
        let s = parse_summary(c, "m").unwrap();
        assert_eq!(s.direction, "bullish");
        assert_eq!(s.intensity, 5);
        assert_eq!(s.assets, vec!["SPY", "TLT"]);
    }

    #[test]
    fn rejects_non_json_and_defaults_direction() {
        assert!(parse_summary("no json here", "m").is_err());
        assert_eq!(parse_summary("{\"what\":\"x\",\"direction\":\"up\"}", "m").unwrap().direction, "neutral");
    }
}
