use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    #[serde(rename = "hub.supabase.url", default)]
    pub supabase_url: String,
    #[serde(rename = "hub.supabase.key", default)]
    pub supabase_key: String,
    #[serde(rename = "hub.device-id", default)]
    pub device_id: String,
    #[serde(rename = "hub.tag", skip_serializing_if = "Option::is_none", default)]
    pub tag: Option<String>,
    #[serde(rename = "hub.auto-update", default = "bool_true")]
    pub auto_update: bool,
    #[serde(rename = "hub.disabled", default)]
    pub disabled: bool,
    #[serde(rename = "hub.app.bulletin.admin", default)]
    pub admin: bool,
}

fn bool_true() -> bool { true }

pub fn read_settings(path: &str) -> Option<Settings> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

pub fn save_settings(path: &str, value: &serde_json::Value) -> std::io::Result<()> {
    fs::write(path, serde_json::to_string_pretty(value)?)
}

pub fn log(log_path: &str, msg: &str) {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let line = format!("[{}] {}\n", now, msg);
    let _ = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .and_then(|mut f| f.write_all(line.as_bytes()));
    eprint!("{}", line);
}

pub fn get_hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown".to_string())
}

pub fn get_mac_addresses() -> Vec<String> {
    use mac_address::MacAddressIterator;
    MacAddressIterator::new()
        .into_iter()
        .flatten()
        .map(|mac| mac.to_string())
        .filter(|s| s != "00:00:00:00:00:00")
        .filter(|s| {
            // filter virtual MAC addresses
            let lower = s.to_lowercase();
            let first_byte = u8::from_str_radix(&lower[..2], 16).unwrap_or(0);
            if (first_byte & 0x02) != 0 { return false; }
            let virtual_prefixes = ["00:0c:29", "00:50:56", "08:00:27", "52:54:00", "00:15:5d", "02:42:"];
            !virtual_prefixes.iter().any(|p| lower.starts_with(p))
        })
        .collect()
}

pub fn get_device_id() -> Option<String> {
    // Try BIOS UUID (Windows)
    #[cfg(target_os = "windows")]
    {
        if let Ok(out) = std::process::Command::new("wmic")
            .args(["csproduct", "get", "UUID", "/value"])
            .output()
        {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                if let Some(uuid) = line.strip_prefix("UUID=") {
                    let trimmed = uuid.trim();
                    if !trimmed.is_empty() && trimmed != "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF" {
                        return Some(trimmed.to_lowercase());
                    }
                }
            }
        }
    }
    None
}

pub fn get_local_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    Some(socket.local_addr().ok()?.ip().to_string())
}
