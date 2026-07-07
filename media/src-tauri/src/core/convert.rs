use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use walkdir::WalkDir;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ScanItem {
    pub path:         String,
    #[serde(rename = "needsFix", skip_serializing_if = "Option::is_none")]
    pub needs_fix:    Option<bool>,
    #[serde(rename = "fixMessage", skip_serializing_if = "Option::is_none")]
    pub fix_message:  Option<String>,
    #[serde(rename = "isBak", skip_serializing_if = "Option::is_none")]
    pub is_bak:       Option<bool>,
}

pub fn target_extensions(ext: &str) -> Vec<String> {
    match ext {
        "mp3"  => vec!["mp3".into()],
        "m4a"  => vec!["m4a".into()],
        "flac" => vec!["flac".into()],
        "wav"  => vec!["wav".into()],
        "mp4"  => vec!["mp4".into()],
        "mkv"  => vec!["mkv".into()],
        "webm" => vec!["webm".into()],
        _      => vec![ext.to_string()],
    }
}

pub async fn scan_folder<F>(
    dir: &Path,
    target_ext: &str,
    mp3val: Option<&Path>,
    on_item: F,
) where
    F: Fn(ScanItem) + Send + Sync + 'static,
{
    let exts: Vec<String> = target_extensions(target_ext)
        .into_iter().map(|s| s.to_lowercase()).collect();

    let entries: Vec<PathBuf> = WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .flatten()
        .filter(|e| e.path().is_file())
        .map(|e| e.path().to_path_buf())
        .collect();

    for path in entries.iter() {
        let ext = path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();

        if ext == "bak" {
            on_item(ScanItem {
                path:        path.to_string_lossy().into_owned(),
                needs_fix:   None,
                fix_message: None,
                is_bak:      Some(true),
            });
            continue;
        }

        if !exts.iter().any(|e| e == &ext) { continue; }

        let path_str = path.to_string_lossy().into_owned();

        // Check mp3 for ID3 tag issues when target_ext is mp3
        let (needs_fix, fix_message) = if target_ext == "mp3" {
            if let Some(mp3val_path) = mp3val {
                check_mp3(mp3val_path, path).await
            } else {
                (false, None)
            }
        } else {
            (false, None)
        };

        on_item(ScanItem {
            path: path_str,
            needs_fix:   if needs_fix { Some(true) } else { None },
            fix_message: fix_message,
            is_bak:      None,
        });
    }
}

async fn check_mp3(mp3val: &Path, path: &Path) -> (bool, Option<String>) {
    let out = tokio::process::Command::new(mp3val)
        .arg(path)
        .output()
        .await;

    match out {
        Ok(o) => {
            let text = String::from_utf8_lossy(&o.stdout).into_owned()
                + &String::from_utf8_lossy(&o.stderr);
            let needs_fix = text.contains("WARNING") || text.contains("ERROR") || text.contains("FIXED");
            let msg = if needs_fix { Some(text.lines().find(|l| l.contains("WARNING") || l.contains("ERROR")).unwrap_or("").to_string()) } else { None };
            (needs_fix, msg)
        }
        Err(_) => (false, None),
    }
}

pub async fn convert<F>(
    ffmpeg:          &Path,
    mp3val:          Option<&Path>,
    src_path:        &Path,
    target_fmt:      &str,
    delete_original: bool,
    needs_fix:       bool,
    cancel:          Arc<AtomicBool>,
    on_progress:     F,
    on_done:         impl Fn(String) + Send + 'static,
    on_error:        impl Fn(String) + Send + 'static,
) where
    F: Fn(f64) + Send + 'static,
{
    // First fix mp3 if needed
    if needs_fix {
        if let Some(mp3v) = mp3val {
            let _ = tokio::process::Command::new(mp3v)
                .arg("-f").arg(src_path)
                .output().await;
        }
    }

    let dest = src_path.with_extension(target_fmt);
    let dest_path = dest.to_string_lossy().into_owned();

    // Use ffmpeg to convert
    let duration_secs = get_duration(ffmpeg, src_path).await.unwrap_or(0.0);

    let mut child = match Command::new(ffmpeg)
        .args([
            "-i", &src_path.to_string_lossy(),
            "-y",
            "-vn",
            &dest.to_string_lossy(),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => { on_error(e.to_string()); return; }
    };

    let stderr = child.stderr.take().unwrap();
    let mut lines = BufReader::new(stderr).lines();

    while let Ok(Some(line)) = lines.next_line().await {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill().await;
            return;
        }
        if duration_secs > 0.0 {
            if let Some(pct) = parse_ffmpeg_progress(&line, duration_secs) {
                on_progress(pct);
            }
        }
    }

    let status = child.wait().await;
    if cancel.load(Ordering::Relaxed) { return; }

    if status.map(|s| s.success()).unwrap_or(false) {
        if delete_original {
            let _ = std::fs::remove_file(src_path);
        }
        on_done(dest_path);
    } else {
        on_error("ffmpeg conversion failed".to_string());
    }
}

async fn get_duration(ffmpeg: &Path, path: &Path) -> Option<f64> {
    // ffprobe would be better but ffmpeg can also print it
    let out = Command::new(ffmpeg)
        .args(["-i", &path.to_string_lossy()])
        .stderr(Stdio::piped())
        .output()
        .await.ok()?;

    let text = String::from_utf8_lossy(&out.stderr);
    for line in text.lines() {
        if line.contains("Duration:") {
            if let Some(dur) = parse_duration(line) {
                return Some(dur);
            }
        }
    }
    None
}

fn parse_duration(line: &str) -> Option<f64> {
    // Duration: 00:04:23.45
    let i = line.find("Duration:")? + "Duration:".len();
    let s = line[i..].trim().split(',').next()?;
    let parts: Vec<&str> = s.trim().split(':').collect();
    if parts.len() != 3 { return None; }
    let h: f64 = parts[0].trim().parse().ok()?;
    let m: f64 = parts[1].trim().parse().ok()?;
    let s: f64 = parts[2].trim().parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

fn parse_ffmpeg_progress(line: &str, duration: f64) -> Option<f64> {
    // time=00:01:23.45
    if !line.contains("time=") { return None; }
    let i = line.find("time=")? + 5;
    let s = &line[i..];
    let time_str = s.split_whitespace().next()?;
    let parts: Vec<&str> = time_str.split(':').collect();
    if parts.len() != 3 { return None; }
    let h: f64 = parts[0].parse().ok()?;
    let m: f64 = parts[1].parse().ok()?;
    let s: f64 = parts[2].parse().ok()?;
    let current = h * 3600.0 + m * 60.0 + s;
    Some((current / duration * 100.0).min(99.0))
}
