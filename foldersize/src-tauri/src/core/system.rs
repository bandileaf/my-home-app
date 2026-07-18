use std::fs;
use std::path::{Path, PathBuf};

pub fn app_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn log_path(app_dir: &Path) -> PathBuf {
    app_dir.join("log").join("family_foldersize.log")
}

pub fn db_path(app_dir: &Path) -> PathBuf {
    app_dir.join("foldersize.db")
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
