use rusqlite::{Connection, params};
use std::path::Path;
use crate::core::indexer::FileEntry;
use crate::core::indexer::IndexSummary;

const DB_VERSION: i64 = 1;

pub fn open_db(db_path: &Path) -> Result<Connection, String> {
    // If version mismatch, delete and recreate
    if db_path.exists() {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        let ver: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap_or(0);
        if ver != 0 && ver != DB_VERSION {
            drop(conn);
            let _ = std::fs::remove_file(db_path);
            for suffix in &["-wal", "-shm"] {
                let mut p = db_path.to_path_buf();
                let name = format!("{}{}", p.file_name().unwrap_or_default().to_string_lossy(), suffix);
                p.set_file_name(name);
                let _ = std::fs::remove_file(p);
            }
        }
    }

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "user_version", DB_VERSION).map_err(|e| e.to_string())?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS file_entries (
            full_path   TEXT PRIMARY KEY,
            file_name   TEXT NOT NULL,
            dir_path    TEXT NOT NULL,
            ext         TEXT NOT NULL,
            size_bytes  INTEGER NOT NULL DEFAULT 0,
            modified_ms INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS scan_checkpoint (
            root_dir    TEXT PRIMARY KEY,
            exclude_sig TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_state (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    ").map_err(|e| e.to_string())
}

pub fn load_entries_for_dir(conn: &Connection, root_dir: &str) -> Vec<FileEntry> {
    let mut stmt = match conn.prepare(
        "SELECT full_path, file_name, dir_path, ext, size_bytes, modified_ms FROM file_entries \
         WHERE full_path = ?1 OR full_path LIKE ?2 OR full_path LIKE ?3"
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map(
        rusqlite::params![root_dir, format!("{}/%" , root_dir), format!("{}\\%", root_dir)],
        |r| Ok(FileEntry { full_path: r.get(0)?, file_name: r.get(1)?, dir_path: r.get(2)?, ext: r.get(3)?, size_bytes: r.get(4)?, modified_ms: r.get(5)? }),
    ).map(|rows| rows.flatten().collect::<Vec<_>>())
     .unwrap_or_default()
}

pub fn load_modified_for_dir(conn: &Connection, root_dir: &str) -> std::collections::HashMap<String, i64> {
    let mut stmt = match conn.prepare(
        "SELECT full_path, modified_ms FROM file_entries \
         WHERE full_path = ?1 OR full_path LIKE ?2 OR full_path LIKE ?3"
    ) {
        Ok(s) => s,
        Err(_) => return std::collections::HashMap::new(),
    };
    stmt.query_map(
        rusqlite::params![root_dir, format!("{}/%" , root_dir), format!("{}\\%", root_dir)],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
    ).map(|rows| rows.flatten().collect())
     .unwrap_or_default()
}

pub fn delete_entries_batch(conn: &Connection, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() { return Ok(()); }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx.prepare("DELETE FROM file_entries WHERE full_path = ?1")
            .map_err(|e| e.to_string())?;
        for p in paths {
            stmt.execute([p]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

pub fn load_entries(conn: &Connection) -> Vec<FileEntry> {
    let mut stmt = match conn.prepare(
        "SELECT full_path, file_name, dir_path, ext, size_bytes, modified_ms FROM file_entries"
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([], |r| Ok(FileEntry {
        full_path:   r.get(0)?,
        file_name:   r.get(1)?,
        dir_path:    r.get(2)?,
        ext:         r.get(3)?,
        size_bytes:  r.get(4)?,
        modified_ms: r.get(5)?,
    })).map(|rows| rows.flatten().collect::<Vec<_>>())
       .unwrap_or_default()
}

pub fn upsert_entries(conn: &Connection, entries: &[FileEntry]) -> Result<(), String> {
    if entries.is_empty() { return Ok(()); }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx.prepare("
            INSERT OR REPLACE INTO file_entries (full_path, file_name, dir_path, ext, size_bytes, modified_ms)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ").map_err(|e| e.to_string())?;
        for e in entries {
            stmt.execute(params![e.full_path, e.file_name, e.dir_path, e.ext, e.size_bytes, e.modified_ms])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

pub fn upsert_entry(conn: &Connection, e: &FileEntry) -> Result<(), String> {
    conn.execute("
        INSERT OR REPLACE INTO file_entries (full_path, file_name, dir_path, ext, size_bytes, modified_ms)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ", params![e.full_path, e.file_name, e.dir_path, e.ext, e.size_bytes, e.modified_ms])
    .map_err(|e| e.to_string()).map(|_| ())
}

pub fn delete_entry(conn: &Connection, full_path: &str) -> Result<(), String> {
    conn.execute("DELETE FROM file_entries WHERE full_path = ?1", [full_path])
        .map_err(|e| e.to_string()).map(|_| ())
}

pub fn delete_entries_for_dir(conn: &Connection, root_dir: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM file_entries WHERE full_path = ?1 OR full_path LIKE ?2 OR full_path LIKE ?3",
        params![root_dir, format!("{}/%" , root_dir), format!("{}\\%", root_dir)]
    ).map_err(|e| e.to_string()).map(|_| ())
}

pub fn is_dir_done(conn: &Connection, root_dir: &str, exclude_sig: &str) -> bool {
    conn.query_row(
        "SELECT exclude_sig FROM scan_checkpoint WHERE root_dir = ?1",
        [root_dir],
        |r| r.get::<_, String>(0)
    ).map(|sig| sig == exclude_sig).unwrap_or(false)
}

pub fn checkpoint_dir(conn: &Connection, root_dir: &str, exclude_sig: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO scan_checkpoint (root_dir, exclude_sig) VALUES (?1, ?2)",
        [root_dir, exclude_sig]
    ).map_err(|e| e.to_string()).map(|_| ())
}

pub fn remove_checkpoint(conn: &Connection, root_dir: &str) -> Result<(), String> {
    conn.execute("DELETE FROM scan_checkpoint WHERE root_dir = ?1", [root_dir])
        .map_err(|e| e.to_string()).map(|_| ())
}

pub fn load_summary(conn: &Connection) -> Option<IndexSummary> {
    get_state(conn, "lastSummary")
        .and_then(|s| serde_json::from_str(&s).ok())
}

pub fn save_summary(conn: &Connection, summary: &IndexSummary) -> Result<(), String> {
    set_state(conn, "lastSummary", &serde_json::to_string(summary).unwrap_or_default())
}

pub fn get_state(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM app_state WHERE key = ?1",
        [key],
        |r| r.get(0)
    ).ok()
}

pub fn set_state(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO app_state (key, value) VALUES (?1, ?2)",
        [key, value]
    ).map_err(|e| e.to_string()).map(|_| ())
}
