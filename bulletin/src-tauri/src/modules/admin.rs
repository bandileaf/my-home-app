use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use crate::core::http::{http_get_json, http_get_text, http_post_json};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceStatus {
    pub ip: String,
    #[serde(rename = "deviceId")]
    pub device_id: String,
    pub hostname: String,
    pub version: String,
    #[serde(rename = "hasSettings")]
    pub has_settings: bool,
    pub disabled: bool,
}

pub fn get_local_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    Some(socket.local_addr().ok()?.ip().to_string())
}

async fn probe_and_fetch(ip: String) -> Option<DeviceStatus> {
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Duration};

    // TCP probe first (800ms)
    let conn = timeout(Duration::from_millis(800), TcpStream::connect(format!("{}:61799", ip))).await;
    if conn.is_err() || conn.unwrap().is_err() { return None; }

    // Fetch /status
    let json = http_get_json(&format!("http://{}:61799/status", ip), 2000).await.ok()?;
    Some(DeviceStatus {
        ip,
        device_id: json["deviceId"].as_str().unwrap_or("").to_string(),
        hostname: json["hostname"].as_str().unwrap_or("").to_string(),
        version: json["version"].as_str().unwrap_or("").to_string(),
        has_settings: json["has_settings"].as_bool().unwrap_or(false),
        disabled: json["disabled"].as_bool().unwrap_or(false),
    })
}

pub async fn scan_subnet(on_progress: Option<impl Fn(String) + Send + 'static>) -> Result<Vec<DeviceStatus>, String> {
    let local_ip = get_local_ip().ok_or("cannot determine local IP")?;
    let prefix = local_ip.rsplitn(2, '.').last().ok_or("invalid IP")?;

    const BATCH: usize = 50;
    let ips: Vec<String> = (1u8..=254).map(|i| format!("{}.{}", prefix, i)).collect();

    let mut results = vec![];
    for chunk in ips.chunks(BATCH) {
        if let Some(ref cb) = on_progress {
            cb(chunk[0].clone());
        }
        let handles: Vec<_> = chunk.iter().map(|ip| {
            let ip = ip.clone();
            tokio::spawn(probe_and_fetch(ip))
        }).collect();
        for h in handles {
            if let Ok(Some(d)) = h.await {
                results.push(d);
            }
        }
    }
    Ok(results)
}

pub async fn fetch_client_log(ip: &str) -> Result<String, String> {
    http_get_text(&format!("http://{}:61799/log", ip), 5000).await
}

pub async fn fetch_client_settings(ip: &str) -> Result<String, String> {
    http_get_text(&format!("http://{}:61799/settings", ip), 3000).await
}

pub async fn send_settings(ip: &str, body: Value) -> Result<Value, String> {
    http_post_json(&format!("http://{}:61799/settings", ip), body, 5000).await
}

pub async fn send_restart(ip: &str) -> Result<Value, String> {
    http_post_json(&format!("http://{}:61799/restart", ip), json!({}), 5000).await
}

pub async fn send_update(ip: &str) -> Result<Value, String> {
    http_post_json(&format!("http://{}:61799/update", ip), json!({}), 5000).await
}

pub async fn send_disable(ip: &str) -> Result<Value, String> {
    http_post_json(&format!("http://{}:61799/disable", ip), json!({}), 5000).await
}

pub async fn send_enable(ip: &str) -> Result<Value, String> {
    http_post_json(&format!("http://{}:61799/enable", ip), json!({}), 5000).await
}
