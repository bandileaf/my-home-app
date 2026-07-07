use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YoutubeResult {
    pub id:         String,
    pub url:        String,
    pub title:      String,
    pub duration:   f64,
    pub channel:    String,
    pub thumbnail:  String,
    #[serde(rename = "viewCount")]
    pub view_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct YoutubeProgress {
    pub url:     String,
    pub percent: f64,
    pub speed:   String,
    pub eta:     String,
}

pub async fn search(ytdlp: &Path, query: &str) -> Result<Vec<YoutubeResult>, String> {
    let search_url = format!("ytsearch10:{}", query);
    let out = Command::new(ytdlp)
        .args([
            &search_url,
            "--flat-playlist",
            "-J",
            "--no-warnings",
            "--no-check-certificate",
        ])
        .output()
        .await
        .map_err(|e| format!("yt-dlp spawn failed: {}", e))?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let v: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("yt-dlp json parse: {}", e))?;

    let entries = v["entries"].as_array().cloned().unwrap_or_default();
    let mut results = Vec::new();

    for e in &entries {
        let id = e["id"].as_str().unwrap_or("").to_string();
        if id.is_empty() { continue; }

        let thumbnail = e["thumbnails"].as_array()
            .and_then(|t| t.last())
            .and_then(|t| t["url"].as_str())
            .unwrap_or("")
            .to_string();
        let thumbnail = if thumbnail.is_empty() {
            format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", id)
        } else {
            thumbnail
        };

        results.push(YoutubeResult {
            id:         id.clone(),
            url:        format!("https://www.youtube.com/watch?v={}", id),
            title:      e["title"].as_str().unwrap_or("").to_string(),
            duration:   e["duration"].as_f64().unwrap_or(0.0),
            channel:    e["uploader"].as_str()
                            .or(e["channel"].as_str())
                            .unwrap_or("")
                            .to_string(),
            thumbnail,
            view_count: e["view_count"].as_u64(),
        });
    }

    Ok(results)
}

pub async fn download<F>(
    ytdlp:        &Path,
    url:          &str,
    output_dir:   &Path,
    audio_format: &str,
    cancel:       Arc<AtomicBool>,
    on_progress:  F,
    on_done:      impl Fn(String) + Send + 'static,
    on_error:     impl Fn(String) + Send + 'static,
) where
    F: Fn(f64, String, String) + Send + 'static,
{
    let fmt = if audio_format.is_empty() { "mp3" } else { audio_format };
    let out_tmpl = output_dir.join("%(title)s.%(ext)s");

    let mut child = match Command::new(ytdlp)
        .args([
            url,
            "-x",
            "--audio-format", fmt,
            "-o", &out_tmpl.to_string_lossy(),
            "--newline",
            "--progress",
            "--no-check-certificate",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => { on_error(e.to_string()); return; }
    };

    let stdout = child.stdout.take().unwrap();
    let mut lines = BufReader::new(stdout).lines();
    let mut dest_path = String::new();

    while let Ok(Some(line)) = lines.next_line().await {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill().await;
            return;
        }
        parse_progress(&line, url, &on_progress);
        if let Some(path) = parse_dest(&line) {
            dest_path = path;
        }
    }

    let status = child.wait().await;
    if cancel.load(Ordering::Relaxed) { return; }

    if status.map(|s| s.success()).unwrap_or(false) {
        on_done(dest_path);
    } else {
        on_error("yt-dlp exited with error".to_string());
    }
}

pub async fn download_video<F>(
    ytdlp:       &Path,
    url:         &str,
    output_dir:  &Path,
    cancel:      Arc<AtomicBool>,
    on_progress: F,
    on_done:     impl Fn(String) + Send + 'static,
    on_error:    impl Fn(String) + Send + 'static,
) where
    F: Fn(f64, String, String) + Send + 'static,
{
    let out_tmpl = output_dir.join("%(title)s.%(ext)s");

    let mut child = match Command::new(ytdlp)
        .args([
            url,
            "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "-o", &out_tmpl.to_string_lossy(),
            "--newline",
            "--progress",
            "--no-check-certificate",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => { on_error(e.to_string()); return; }
    };

    let stdout = child.stdout.take().unwrap();
    let mut lines = BufReader::new(stdout).lines();
    let mut dest_path = String::new();

    while let Ok(Some(line)) = lines.next_line().await {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill().await;
            return;
        }
        parse_progress(&line, url, &on_progress);
        if let Some(path) = parse_dest(&line) {
            dest_path = path;
        }
    }

    let status = child.wait().await;
    if cancel.load(Ordering::Relaxed) { return; }

    if status.map(|s| s.success()).unwrap_or(false) {
        on_done(dest_path);
    } else {
        on_error("yt-dlp video download failed".to_string());
    }
}

fn parse_progress(line: &str, _url: &str, on_progress: &impl Fn(f64, String, String)) {
    // [download]  45.2% of 4.56MiB at  3.12MiB/s ETA 00:01
    if !line.contains("[download]") { return; }
    let percent = extract_percent(line).unwrap_or(0.0);
    let speed   = extract_between(line, "at ", " ").unwrap_or_default();
    let eta     = extract_between(line, "ETA ", " ").unwrap_or_default();
    on_progress(percent, speed, eta);
}

fn parse_dest(line: &str) -> Option<String> {
    // [ExtractAudio] Destination: C:\...\file.mp3
    // [download] Destination: C:\...\file.mp4
    if line.contains("Destination:") {
        line.split("Destination:").nth(1).map(|s| s.trim().to_string())
    } else {
        None
    }
}

fn extract_percent(s: &str) -> Option<f64> {
    s.split_whitespace()
        .find(|w| w.ends_with('%'))
        .and_then(|w| w.trim_end_matches('%').parse().ok())
}

fn extract_between<'a>(s: &'a str, start: &str, end: &str) -> Option<String> {
    let i = s.find(start)? + start.len();
    let sub = &s[i..];
    let j = sub.find(end).unwrap_or(sub.len());
    Some(sub[..j].trim().to_string())
}
