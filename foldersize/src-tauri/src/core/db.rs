use rusqlite::{params, Connection};
use std::path::Path;

use crate::core::scan::FolderChild;

const DB_VERSION: i64 = 1;

pub fn open_db(db_path: &Path) -> Result<Connection, String> {
    // If version mismatch, delete and recreate
    if db_path.exists() {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        let ver: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap_or(0);
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
        CREATE TABLE IF NOT EXISTS scan_meta (
            path       TEXT PRIMARY KEY,
            scanned_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS scan_children (
            parent_path TEXT NOT NULL,
            path        TEXT NOT NULL,
            name        TEXT NOT NULL,
            size_bytes  INTEGER NOT NULL,
            is_dir      INTEGER NOT NULL,
            item_count  INTEGER NOT NULL,
            error       TEXT,
            PRIMARY KEY (parent_path, path)
        );
        CREATE INDEX IF NOT EXISTS idx_scan_children_parent ON scan_children(parent_path);
    ").map_err(|e| e.to_string())
}

pub fn load_cached_children(conn: &Connection, path: &str) -> Option<Vec<FolderChild>> {
    let scanned: Option<i64> = conn
        .query_row("SELECT scanned_at FROM scan_meta WHERE path = ?1", [path], |r| r.get(0))
        .ok();
    scanned?;

    let mut stmt = conn.prepare(
        "SELECT name, path, size_bytes, is_dir, item_count, error FROM scan_children WHERE parent_path = ?1"
    ).ok()?;

    let rows = stmt.query_map([path], |r| {
        Ok(FolderChild {
            name:        r.get(0)?,
            path:        r.get(1)?,
            size_bytes:  r.get::<_, i64>(2)? as u64,
            is_dir:      r.get::<_, i64>(3)? != 0,
            item_count:  r.get::<_, i64>(4)? as u64,
            error:       r.get(5)?,
        })
    }).ok()?;

    let mut children: Vec<FolderChild> = rows.flatten().collect();
    children.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    Some(children)
}

pub fn save_children(conn: &Connection, path: &str, children: &[FolderChild]) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp();
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        tx.execute("DELETE FROM scan_children WHERE parent_path = ?1", [path])
            .map_err(|e| e.to_string())?;

        let mut stmt = tx.prepare("
            INSERT OR REPLACE INTO scan_children
                (parent_path, path, name, size_bytes, is_dir, item_count, error)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ").map_err(|e| e.to_string())?;
        for c in children {
            stmt.execute(params![
                path, c.path, c.name, c.size_bytes as i64, c.is_dir as i64, c.item_count as i64, c.error
            ]).map_err(|e| e.to_string())?;
        }

        tx.execute(
            "INSERT OR REPLACE INTO scan_meta (path, scanned_at) VALUES (?1, ?2)",
            params![path, now],
        ).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

pub fn purge_path(conn: &Connection, path: &str) -> Result<(), String> {
    let prefix = format!("{}\\%", path);
    conn.execute(
        "DELETE FROM scan_children WHERE path = ?1 OR parent_path = ?1 OR parent_path LIKE ?2",
        params![path, prefix],
    ).map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM scan_meta WHERE path = ?1 OR path LIKE ?2",
        params![path, prefix],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
