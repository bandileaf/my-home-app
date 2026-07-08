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

// Derive a short display name from the first exe path (e.g. "ffmpeg.exe" → "ffmpeg")
fn bin_name(exes: &[String]) -> String {
    exes.first()
        .and_then(|e| Path::new(e).file_stem())
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

// Destination filename = basename of the exe path inside zip
fn dest_name(exe_path: &str) -> String {
    Path::new(exe_path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| exe_path.to_string())
}

pub fn initial_statuses_from_settings(settings: &serde_json::Value) -> Vec<BinStatusEntry> {
    let Some(arr) = settings["hub.bins"].as_array() else { return vec![] };
    arr.iter().filter_map(|b| {
        let exes: Vec<String> = b["exes"].as_array()?
            .iter().filter_map(|v| v.as_str().map(String::from)).collect();
        if exes.is_empty() { return None; }
        Some(BinStatusEntry { name: bin_name(&exes), state: BinState::Pending, percent: 0 })
    }).collect()
}

pub async fn ensure_bins<F>(
    bins_dir: &Path,
    settings: &serde_json::Value,
    on_status: F,
) -> HashMap<String, String>
where
    F: Fn(&str, BinState, u32, Option<String>) + Send + Sync + Clone + 'static,
{
    let _ = std::fs::create_dir_all(bins_dir);
    let mut result = HashMap::new();

    let bins = match settings["hub.bins"].as_array() {
        Some(a) => a.clone(),
        None    => return result,
    };

    for bin_entry in &bins {
        let url = bin_entry["url"].as_str().unwrap_or("");
        let exes: Vec<String> = bin_entry["exes"].as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();

        if url.is_empty() || exes.is_empty() { continue; }

        let dests: Vec<String> = exes.iter().map(|e| dest_name(e)).collect();
        let name = bin_name(&dests);

        // Already installed?
        let all_present = dests.iter().all(|d| bins_dir.join(d).exists());
        if all_present {
            on_status(&name, BinState::Installed, 100, Some(format!("확인: {}", dests.join(", "))));
            for d in &dests {
                result.insert(d.clone(), bins_dir.join(d).to_string_lossy().into_owned());
            }
            continue;
        }

        // Pass URL + destination files as detail on first Downloading callback
        let detail = if url.to_lowercase().ends_with(".zip") {
            format!("{} → {}", url, dests.join(", "))
        } else {
            url.to_string()
        };
        on_status(&name, BinState::Downloading, 0, Some(detail));

        let on_pct = {
            let on_status = on_status.clone();
            let name = name.clone();
            move |pct| on_status(&name, BinState::Downloading, pct, None)
        };

        let res = if url.to_lowercase().ends_with(".zip") {
            download_zip(url, &name, bins_dir, &exes, &dests, on_pct).await
        } else {
            download_direct(url, bins_dir, &dests[0], on_pct).await
        };

        match res {
            Ok(()) => {
                on_status(&name, BinState::Installed, 100, None);
                for d in &dests {
                    result.insert(d.clone(), bins_dir.join(d).to_string_lossy().into_owned());
                }
            }
            Err(e) => {
                on_status(&name, BinState::Failed, 0, Some(e));
            }
        }
    }

    result
}

fn make_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::limited(15))
        .default_headers({
            let mut h = reqwest::header::HeaderMap::new();
            h.insert("Accept", "*/*".parse().unwrap());
            h.insert("Referer", "https://sourceforge.net/".parse().unwrap());
            h
        })
        .build()
        .unwrap_or_default()
}

async fn download_direct<F>(url: &str, bins_dir: &Path, dest: &str, on_progress: F) -> Result<(), String>
where F: Fn(u32),
{
    let resp = make_client().get(url).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() { return Err(format!("HTTP {}", status)); }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    on_progress(100);
    std::fs::write(bins_dir.join(dest), &bytes).map_err(|e| e.to_string())
}

async fn download_zip<F>(
    url:      &str,
    name:     &str,
    bins_dir: &Path,
    exes:     &[String],   // paths inside zip
    dests:    &[String],   // destination filenames
    on_progress: F,
) -> Result<(), String>
where F: Fn(u32),
{
    let tmp  = bins_dir.join(format!("_{}.zip", name));
    let resp = make_client().get(url).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() { return Err(format!("HTTP {}", status)); }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    on_progress(50);

    std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    on_progress(80);

    for (exe_path, dest) in exes.iter().zip(dests.iter()) {
        if !extract_from_zip(&tmp, exe_path, &bins_dir.join(dest)) {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("zip extraction failed: {} not found", exe_path));
        }
    }

    let _ = std::fs::remove_file(&tmp);
    on_progress(100);
    Ok(())
}

fn extract_from_zip(zip_path: &Path, entry_path: &str, dest: &Path) -> bool {
    let Ok(f) = std::fs::File::open(zip_path) else { return false };
    let Ok(mut archive) = zip::ZipArchive::new(f) else { return false };

    let entry_name = dest_name(entry_path); // basename to match even if path differs

    for i in 0..archive.len() {
        let Ok(mut file) = archive.by_index(i) else { continue };
        let name = file.name().to_string();
        // Match exact path or filename suffix or basename
        if name == entry_path || name.ends_with(entry_path) || dest_name(&name) == entry_name {
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
