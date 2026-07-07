import Database from 'better-sqlite3'
import type { Database as DB } from 'better-sqlite3'
import { rmSync } from 'fs'
import type { FileEntry, IndexSummary } from './indexer'

export type { DB }

// 스키마가 변경될 때마다 이 값을 올린다.
// 앱 시작 시 DB 의 user_version 과 다르면 DB 를 삭제하고 처음부터 재생성한다.
const DB_VERSION = 1

export interface OpenDbResult {
  db: DB
  recreated: boolean // true 면 이전 DB 가 삭제되고 새로 만들어졌음
}

export function open_db(db_path: string): OpenDbResult {
  let db = new Database(db_path)
  let recreated = false

  const current_version = db.pragma('user_version', { simple: true }) as number

  // 버전 불일치: 기존 DB(스키마가 다를 수 있음) 삭제 후 새로 만든다.
  // version=0 은 방금 생성된 빈 파일이므로 삭제하지 않는다.
  if (current_version !== 0 && current_version !== DB_VERSION) {
    db.close()
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        rmSync(db_path + suffix, { force: true })
      } catch {
        // 없으면 무시
      }
    }
    db = new Database(db_path)
    recreated = true
  }

  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma(`user_version = ${DB_VERSION}`)
  init_schema(db)
  return { db, recreated }
}

function init_schema(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_entries (
      full_path   TEXT PRIMARY KEY,
      file_name   TEXT NOT NULL,
      dir_path    TEXT NOT NULL,
      ext         TEXT NOT NULL,
      size_bytes  INTEGER NOT NULL DEFAULT 0,
      modified_ms INTEGER NOT NULL DEFAULT 0
    );
    -- 루트 디렉터리별 체크포인트: exclude 패턴이 같으면 재스캔 생략
    CREATE TABLE IF NOT EXISTS scan_checkpoint (
      root_dir    TEXT PRIMARY KEY,
      exclude_sig TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}

export function db_load_entries(db: DB): FileEntry[] {
  const rows = db
    .prepare(
      'SELECT full_path, file_name, dir_path, ext, size_bytes, modified_ms FROM file_entries'
    )
    .all() as Array<{
    full_path: string
    file_name: string
    dir_path: string
    ext: string
    size_bytes: number
    modified_ms: number
  }>
  return rows.map((r) => ({
    fullPath: r.full_path,
    fileName: r.file_name,
    dirPath: r.dir_path,
    ext: r.ext,
    sizeBytes: r.size_bytes,
    modifiedMs: r.modified_ms
  }))
}

// 특정 루트 디렉터리 하위 엔트리 전체 삭제 (재스캔 전 정리)
export function db_delete_entries_for_dir(db: DB, rootDir: string): void {
  db.prepare(
    `DELETE FROM file_entries WHERE full_path = ? OR full_path LIKE ? OR full_path LIKE ?`
  ).run(rootDir, rootDir + '/%', rootDir + '\\%')
}

// 여러 엔트리 UPSERT (기존 엔트리 지우지 않음 — 점진적 추가)
export function db_upsert_entries(db: DB, entries: FileEntry[]): void {
  if (entries.length === 0) return
  const insert = db.prepare(`
    INSERT OR REPLACE INTO file_entries (full_path, file_name, dir_path, ext, size_bytes, modified_ms)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  db.transaction(() => {
    for (const e of entries) {
      insert.run(e.fullPath, e.fileName, e.dirPath, e.ext, e.sizeBytes, e.modifiedMs)
    }
  })()
}

// 단일 엔트리 UPSERT (watcher 가 파일 변경 감지 시)
export function db_upsert_entry(db: DB, entry: FileEntry): void {
  db.prepare(`
    INSERT OR REPLACE INTO file_entries (full_path, file_name, dir_path, ext, size_bytes, modified_ms)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(entry.fullPath, entry.fileName, entry.dirPath, entry.ext, entry.sizeBytes, entry.modifiedMs)
}

// 단일 엔트리 삭제 (watcher 가 파일 삭제 감지 시)
export function db_delete_entry(db: DB, fullPath: string): void {
  db.prepare('DELETE FROM file_entries WHERE full_path = ?').run(fullPath)
}

// 이 루트 디렉터리가 현재 exclude 패턴으로 완전히 스캔됐는지 확인
export function db_is_dir_done(db: DB, rootDir: string, excludeSig: string): boolean {
  const row = db
    .prepare('SELECT exclude_sig FROM scan_checkpoint WHERE root_dir = ?')
    .get(rootDir) as { exclude_sig: string } | undefined
  return row?.exclude_sig === excludeSig
}

// 루트 디렉터리 스캔 완료 표시
export function db_checkpoint_dir(db: DB, rootDir: string, excludeSig: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO scan_checkpoint (root_dir, exclude_sig) VALUES (?, ?)'
  ).run(rootDir, excludeSig)
}

// 루트 디렉터리 체크포인트 제거 (더 이상 settings 에 없는 dir)
export function db_remove_checkpoint(db: DB, rootDir: string): void {
  db.prepare('DELETE FROM scan_checkpoint WHERE root_dir = ?').run(rootDir)
}

// 마지막 인덱스 요약 로드/저장
export function db_load_summary(db: DB): IndexSummary | null {
  const raw = db_get_state(db, 'lastSummary')
  if (!raw) return null
  try {
    return JSON.parse(raw) as IndexSummary
  } catch {
    return null
  }
}

export function db_save_summary(db: DB, summary: IndexSummary): void {
  db_set_state(db, 'lastSummary', JSON.stringify(summary))
}

// 앱 상태 키-값 저장소
export function db_get_state(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function db_set_state(db: DB, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(key, value)
}
