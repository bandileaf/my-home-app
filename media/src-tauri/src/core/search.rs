use serde::{Deserialize, Serialize};
use crate::core::indexer::{FileEntry, build_excluder, to_posix};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    #[serde(rename = "fullPath")]  pub full_path:  String,
    #[serde(rename = "fileName")]  pub file_name:  String,
    #[serde(rename = "dirPath")]   pub dir_path:   String,
    pub ext:        String,
    #[serde(rename = "sizeBytes")] pub size_bytes: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub hits:      Vec<SearchHit>,
    pub total:     usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SearchOptions {
    pub extensions:      Option<Vec<String>>,
    pub limit:           Option<usize>,
    #[serde(rename = "excludePatterns")]
    pub exclude_patterns: Option<Vec<String>>,
    #[serde(rename = "rootDirs")]
    pub root_dirs:       Option<Vec<String>>,
}

pub fn search_files(entries: &[FileEntry], query: &str, options: &SearchOptions) -> SearchResult {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return SearchResult { hits: vec![], total: 0, truncated: false };
    }

    let needle_compact = needle.replace(|c: char| c.is_whitespace(), "");
    let has_spaces = needle_compact != needle;

    let limit = options.limit.unwrap_or(500);
    let ext_set: Option<std::collections::HashSet<String>> = options.extensions
        .as_ref()
        .filter(|e| !e.is_empty())
        .map(|e| e.iter().map(|s| s.to_lowercase()).collect());

    let exclude_glob = build_excluder(options.exclude_patterns.as_deref().unwrap_or(&[]));

    let mut hits: Vec<SearchHit> = Vec::new();
    let mut total = 0usize;

    for entry in entries {
        if let Some(ref exts) = ext_set {
            if !exts.contains(&entry.ext) { continue; }
        }
        if exclude_glob.is_match(&to_posix(&entry.full_path)) { continue; }

        let name_lower = entry.file_name.to_lowercase();
        let matches = name_lower.contains(&needle)
            || (has_spaces && name_lower.replace(|c: char| c.is_whitespace(), "").contains(&needle_compact));

        if !matches { continue; }

        total += 1;
        if hits.len() < limit {
            hits.push(SearchHit {
                full_path:  entry.full_path.clone(),
                file_name:  entry.file_name.clone(),
                dir_path:   entry.dir_path.clone(),
                ext:        entry.ext.clone(),
                size_bytes: entry.size_bytes,
            });
        }
    }

    // Sort by root_dirs order
    if let Some(ref dirs) = options.root_dirs {
        if dirs.len() > 1 {
            let dirs_lower: Vec<String> = dirs.iter().map(|d| d.to_lowercase()).collect();
            hits.sort_by_key(|h| {
                let p = h.full_path.to_lowercase();
                dirs_lower.iter().position(|d| p.starts_with(d.as_str())).unwrap_or(dirs.len())
            });
        }
    }

    SearchResult { truncated: total > hits.len(), hits, total }
}
