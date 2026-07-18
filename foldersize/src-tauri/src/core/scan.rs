use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize)]
pub struct FolderChild {
    pub name: String,
    pub path: String,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    #[serde(rename = "itemCount")]
    pub item_count: u64,
    pub error: Option<String>,
}

pub fn list_drives() -> Vec<String> {
    let mut drives = vec![];
    for letter in b'A'..=b'Z' {
        let root = format!("{}:\\", letter as char);
        if Path::new(&root).exists() {
            drives.push(root);
        }
    }
    drives
}

fn dir_size(path: &Path, cancel: &AtomicBool) -> (u64, u64, Option<String>) {
    let mut total_size = 0u64;
    let mut count = 0u64;
    let mut had_error = false;

    for entry in WalkDir::new(path).into_iter() {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        match entry {
            Ok(e) if e.file_type().is_file() => {
                if let Ok(meta) = e.metadata() {
                    total_size += meta.len();
                    count += 1;
                }
            }
            Ok(_) => {}
            Err(_) => had_error = true,
        }
    }

    let error = if had_error { Some("일부 항목에 접근할 수 없음".to_string()) } else { None };
    (total_size, count, error)
}

pub fn scan_one_level<F: Fn(usize, usize, &str)>(
    path: &str,
    cancel: &AtomicBool,
    on_progress: F,
) -> Result<Vec<FolderChild>, String> {
    let root = Path::new(path);
    let read_dir = std::fs::read_dir(root).map_err(|e| e.to_string())?;

    let mut entries: Vec<PathBuf> = read_dir.filter_map(|e| e.ok()).map(|e| e.path()).collect();
    entries.sort();

    let total = entries.len();
    let mut children = Vec::with_capacity(total);

    for (i, entry_path) in entries.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let name = entry_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        on_progress(i, total, &name);

        let is_dir = entry_path.is_dir();
        let (size_bytes, item_count, error) = if is_dir {
            dir_size(entry_path, cancel)
        } else {
            let size = std::fs::metadata(entry_path).map(|m| m.len()).unwrap_or(0);
            (size, 0, None)
        };

        children.push(FolderChild {
            name,
            path: entry_path.to_string_lossy().to_string(),
            size_bytes,
            is_dir,
            item_count,
            error,
        });
    }

    children.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    Ok(children)
}
