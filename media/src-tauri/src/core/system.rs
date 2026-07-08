use std::fs;
use std::path::{Path, PathBuf};

pub fn app_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn log_path(app_dir: &Path) -> PathBuf {
    app_dir.join("log").join("family_media.log")
}

pub fn settings_path(app_dir: &Path) -> PathBuf {
    app_dir.join("settings.json")
}

pub fn db_path(app_dir: &Path, settings: &serde_json::Value) -> PathBuf {
    let name = settings["hub.app.media.db"].as_str().unwrap_or("indexing.db");
    app_dir.join(name)
}

pub fn log(log_path: &Path, msg: &str) {
    let _ = fs::create_dir_all(log_path.parent().unwrap_or(Path::new(".")));
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let line = format!("[{}] {}\n", now, msg);
    use std::io::Write;
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = f.write_all(line.as_bytes());
    }
}

pub fn read_settings(settings_path: &Path) -> serde_json::Value {
    fs::read_to_string(settings_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::Value::Object(serde_json::Map::new()))
}

pub fn default_settings_text() -> &'static str {
    r#"{
  "musicSearch.searchDirectories": [],
  "musicSearch.exclude": {
    "**/*.jpg": true,
    "**/*.png": true
  },
  "musicSearch.downloadDirectory": "",
  "musicSearch.ytdlpPath": "",
  "musicSearch.ffmpegPath": "",
  "musicSearch.mp3valPath": ""
}
"#
}

pub struct MusicSettings {
    pub search_directories: Vec<String>,
    pub exclude: Vec<String>,
    pub download_directory: String,
}

pub fn load_music_settings(settings: &serde_json::Value) -> MusicSettings {
    let dirs = settings["musicSearch.searchDirectories"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let exclude = settings["musicSearch.exclude"]
        .as_object()
        .map(|m| m.iter().filter_map(|(k, v)| if v.as_bool().unwrap_or(false) { Some(k.clone()) } else { None }).collect())
        .unwrap_or_default();

    let download_directory = settings["musicSearch.downloadDirectory"]
        .as_str()
        .unwrap_or("")
        .to_string();

    MusicSettings { search_directories: dirs, exclude, download_directory }
}

pub fn resolve_download_dir(app_dir: &Path, configured: &str) -> PathBuf {
    let dir = if configured.trim().is_empty() {
        app_dir.join("Downloads")
    } else {
        PathBuf::from(configured.trim())
    };
    let _ = fs::create_dir_all(&dir);
    dir
}
