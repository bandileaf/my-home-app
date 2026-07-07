use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum BinState {
    Pending,
    Downloading,
    Extracting,
    Installed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinStatusEntry {
    pub name:    String,
    pub state:   BinState,
    pub percent: u32,
}

#[derive(Debug, Clone)]
pub struct BinSpec {
    pub name:    &'static str,
    pub url:     &'static str,
    pub exe:     &'static str,
    pub in_zip:  Option<&'static str>,
}

pub const BINS: &[BinSpec] = &[
    BinSpec {
        name:   "yt-dlp",
        url:    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
        exe:    "yt-dlp.exe",
        in_zip: None,
    },
    BinSpec {
        name:   "ffmpeg",
        url:    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip",
        exe:    "ffmpeg.exe",
        in_zip: Some("ffmpeg-master-latest-win64-lgpl/bin/ffmpeg.exe"),
    },
    BinSpec {
        name:   "mp3val",
        url:    "https://prdownloads.sourceforge.net/mp3val/mp3val-0.1.8-win32-fixes.zip",
        exe:    "mp3val.exe",
        in_zip: Some("mp3val.exe"),
    },
];

fn fmt_ms(ms: u64) -> String {
    if ms < 1000 {
        return format!("{}ms", ms);
    }
    let s = ms as f64 / 1000.0;
    if ms % 1000 == 0 { format!("{}s", ms / 1000) } else { format!("{:.1}s", s) }
}

pub async fn ensure_bins<F>(
    bins_dir: &Path,
    on_status: F,
) -> HashMap<String, String>
where
    F: Fn(&str, BinState, u32) + Send + Sync + Clone + 'static,
{
    let _ = std::fs::create_dir_all(bins_dir);
    let mut result = HashMap::new();

    for spec in BINS {
        let dest = bins_dir.join(spec.exe);
        if dest.exists() {
            on_status(spec.name, BinState::Installed, 100);
            result.insert(spec.name.to_string(), dest.to_string_lossy().into_owned());
            continue;
        }

        on_status(spec.name, BinState::Downloading, 0);
        let t0 = std::time::Instant::now();

        let installed = if spec.in_zip.is_some() {
            download_zip(spec, bins_dir, {
                let on_status = on_status.clone();
                let name = spec.name;
                move |pct| on_status(name, BinState::Downloading, pct)
            }).await
        } else {
            download_direct(spec, bins_dir, {
                let on_status = on_status.clone();
                let name = spec.name;
                move |pct| on_status(name, BinState::Downloading, pct)
            }).await
        };

        let elapsed = fmt_ms(t0.elapsed().as_millis() as u64);
        if installed {
            on_status(spec.name, BinState::Installed, 100);
            result.insert(spec.name.to_string(), dest.to_string_lossy().into_owned());
            let _ = elapsed; // used in logging via caller
        } else {
            on_status(spec.name, BinState::Failed, 0);
        }
    }

    result
}

async fn download_direct<F>(spec: &BinSpec, bins_dir: &Path, on_progress: F) -> bool
where
    F: Fn(u32),
{
    let dest = bins_dir.join(spec.exe);
    let Ok(resp) = reqwest::get(spec.url).await else { return false };
    let _total = resp.content_length().unwrap_or(0);
    let Ok(bytes) = resp.bytes().await else { return false };
    on_progress(100);

    std::fs::write(&dest, &bytes).is_ok()
}

async fn download_zip<F>(spec: &BinSpec, bins_dir: &Path, on_progress: F) -> bool
where
    F: Fn(u32),
{
    let tmp = bins_dir.join(format!("_{}.zip", spec.name));
    let Ok(resp) = reqwest::get(spec.url).await else { return false };
    let Ok(bytes) = resp.bytes().await else { return false };
    on_progress(80);

    if std::fs::write(&tmp, &bytes).is_err() { return false; }

    let result = extract_from_zip(&tmp, spec.in_zip.unwrap_or(spec.exe), &bins_dir.join(spec.exe));
    let _ = std::fs::remove_file(&tmp);
    on_progress(100);
    result
}

fn extract_from_zip(zip_path: &Path, entry_path: &str, dest: &Path) -> bool {
    let Ok(f) = std::fs::File::open(zip_path) else { return false };
    let Ok(mut archive) = zip::ZipArchive::new(f) else { return false };

    for i in 0..archive.len() {
        let Ok(mut file) = archive.by_index(i) else { continue };
        let name = file.name().to_string();
        if name == entry_path || name.ends_with(entry_path) {
            let mut buf = Vec::new();
            let _ = file.read_to_end(&mut buf);
            return std::fs::write(dest, buf).is_ok();
        }
    }
    false
}

pub fn bins_dir(app_dir: &Path) -> PathBuf {
    app_dir.join("bins")
}

pub fn bin_path(app_dir: &Path, exe: &str) -> Option<PathBuf> {
    let p = bins_dir(app_dir).join(exe);
    if p.exists() { Some(p) } else { None }
}
