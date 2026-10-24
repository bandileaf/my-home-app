use reqwest::Client;
use serde_json::Value;
use std::time::Duration;

pub async fn http_get_json(url: &str, timeout_ms: u64) -> Result<Value, String> {
    let client = Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| e.to_string())?;
    client.get(url)
        .send().await.map_err(|e| e.to_string())?
        .json::<Value>().await.map_err(|e| e.to_string())
}

pub async fn http_get_text(url: &str, timeout_ms: u64) -> Result<String, String> {
    let client = Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| e.to_string())?;
    client.get(url)
        .send().await.map_err(|e| e.to_string())?
        .text().await.map_err(|e| e.to_string())
}

pub async fn http_get_bytes(url: &str, timeout_ms: u64) -> Result<Vec<u8>, String> {
    let client = Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() { return Err(format!("HTTP {}", resp.status())); }
    Ok(resp.bytes().await.map_err(|e| e.to_string())?.to_vec())
}

// apikey 헤더만 붙여 상태 코드를 확인하는 용도 (keepalive 핑 등). 본문은 필요 없다.
pub async fn http_get_with_apikey_status(url: &str, apikey: &str, timeout_ms: u64) -> Result<u16, String> {
    let client = Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(url)
        .header("apikey", apikey)
        .send().await.map_err(|e| e.to_string())?;
    Ok(resp.status().as_u16())
}

pub async fn http_post_json(url: &str, body: Value, timeout_ms: u64) -> Result<Value, String> {
    let client = Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| e.to_string())?;
    client.post(url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send().await.map_err(|e| e.to_string())?
        .json::<Value>().await.map_err(|e| e.to_string())
}
