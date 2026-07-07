use serde::{Deserialize, Serialize};
use globset::{Glob, GlobSet, GlobSetBuilder};
use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub full_path:   String,
    pub file_name:   String,
    pub dir_path:    String,
    pub ext:         String,
    pub size_bytes:  i64,
    pub modified_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexSummary {
    pub scanned:    u64,
    pub indexed:    u64,
    pub excluded:   u64,
    #[serde(rename = "hasTarget")]
    pub has_target: bool,
    pub missing:    Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct IndexProgress {
    pub scanned:     u64,
    pub indexed:     u64,
    pub excluded:    u64,
    #[serde(rename = "currentDir")]
    pub current_dir: String,
}

pub fn build_excluder(patterns: &[String]) -> GlobSet {
    let mut builder = GlobSetBuilder::new();
    for p in patterns {
        if let Ok(g) = Glob::new(p) {
            builder.add(g);
        }
    }
    builder.build().unwrap_or_else(|_| GlobSet::empty())
}

pub fn to_posix(path: &str) -> String {
    path.replace('\\', "/")
}

pub fn is_under_dir(root: &str, full_path: &str) -> bool {
    let root_posix = to_posix(root);
    let path_posix = to_posix(full_path);
    path_posix.len() > root_posix.len() && path_posix.starts_with(&root_posix)
}

pub fn entry_from_path(path: &Path) -> Option<FileEntry> {
    if !path.is_file() { return None; }
    let (size_bytes, modified_ms) = path.metadata()
        .map(|m| {
            let sz = m.len() as i64;
            let ms = m.modified().ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            (sz, ms)
        })
        .unwrap_or((0, 0));
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).unwrap_or_default();
    Some(FileEntry {
        full_path:   path.to_string_lossy().into_owned(),
        file_name:   path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        dir_path:    path.parent().unwrap_or(Path::new("")).to_string_lossy().into_owned(),
        ext,
        size_bytes,
        modified_ms,
    })
}

// Incremental scan: only returns new/modified entries and deleted paths.
// existing: path → modified_ms from DB. Empty on first scan → behaves like full scan.
pub fn scan_dir_incremental<F>(
    root:          &str,
    exclude:       &GlobSet,
    on_progress:   &F,
    existing:      &std::collections::HashMap<String, i64>,
    new_entries:   &mut Vec<FileEntry>,
    deleted_paths: &mut Vec<String>,
) -> (u64, u64)
where
    F: Fn(IndexProgress),
{
    let mut seen      = std::collections::HashSet::new();
    let mut scanned   = 0u64;
    let mut excluded  = 0u64;
    let mut last_tick = std::time::Instant::now();

    for result in WalkDir::new(root).follow_links(false).into_iter().flatten() {
        let path = result.path();
        if !path.is_file() { continue; }
        scanned += 1;

        let rel = path.strip_prefix(root)
            .map(|r| to_posix(&r.to_string_lossy()))
            .unwrap_or_default();
        if exclude.is_match(&rel) { excluded += 1; continue; }

        let path_str = path.to_string_lossy().into_owned();
        let (size_bytes, modified_ms) = path.metadata()
            .map(|m| {
                let sz = m.len() as i64;
                let ms = m.modified().ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                (sz, ms)
            })
            .unwrap_or((0, 0));

        seen.insert(path_str.clone());

        // Only write to DB if new or modified
        if existing.get(&path_str).copied() != Some(modified_ms) {
            let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).unwrap_or_default();
            new_entries.push(FileEntry {
                full_path: path_str,
                file_name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
                dir_path:  path.parent().unwrap_or(Path::new("")).to_string_lossy().into_owned(),
                ext, size_bytes, modified_ms,
            });
        }

        if last_tick.elapsed().as_millis() >= 150 {
            last_tick = std::time::Instant::now();
            on_progress(IndexProgress {
                scanned,
                indexed:     (existing.len() + new_entries.len()) as u64,
                excluded,
                current_dir: path.parent().unwrap_or(Path::new("")).to_string_lossy().into_owned(),
            });
        }
    }

    // Files in DB that no longer exist on disk
    for path_str in existing.keys() {
        if !seen.contains(path_str) {
            deleted_paths.push(path_str.clone());
        }
    }

    (scanned, excluded)
}

pub fn scan_dir<F>(
    root: &str,
    exclude: &GlobSet,
    on_progress: &F,
    entries_out: &mut Vec<FileEntry>,
) -> (u64, u64)
where
    F: Fn(IndexProgress),
{
    let mut scanned  = 0u64;
    let mut excluded = 0u64;
    let mut last_tick = std::time::Instant::now();

    for result in WalkDir::new(root).follow_links(false).into_iter().flatten() {
        let path = result.path();
        if !path.is_file() { continue; }

        scanned += 1;

        // relative path for glob matching
        let rel = path.strip_prefix(root)
            .map(|r| to_posix(&r.to_string_lossy()))
            .unwrap_or_default();

        if exclude.is_match(&rel) {
            excluded += 1;
            continue;
        }

        let (size_bytes, modified_ms) = path.metadata()
            .map(|m| {
                let sz = m.len() as i64;
                let ms = m.modified().ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                (sz, ms)
            })
            .unwrap_or((0, 0));

        let ext = path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();

        entries_out.push(FileEntry {
            full_path:   path.to_string_lossy().into_owned(),
            file_name:   path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
            dir_path:    path.parent().unwrap_or(Path::new("")).to_string_lossy().into_owned(),
            ext,
            size_bytes,
            modified_ms,
        });

        if last_tick.elapsed().as_millis() >= 150 {
            last_tick = std::time::Instant::now();
            on_progress(IndexProgress {
                scanned,
                indexed: entries_out.len() as u64,
                excluded,
                current_dir: path.parent().unwrap_or(Path::new("")).to_string_lossy().into_owned(),
            });
        }
    }

    (scanned, excluded)
}
