import { readdir, stat } from 'fs/promises'
import { extname, isAbsolute, join, relative, sep } from 'path'
import picomatch from 'picomatch'

// 경로를 항상 forward-slash 로 (glob 매칭 일관성) — watcher 에서도 사용
export function to_posix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

// exclude 패턴 매처 생성 — watcher 에서도 사용
export function create_excluder(patterns: string[]): (path: string) => boolean {
  return picomatch(patterns.length > 0 ? patterns : ['$^'])
}

// fullPath 가 rootDir 하위인지 확인 (크로스플랫폼)
export function is_under_dir(rootDir: string, fullPath: string): boolean {
  const rel = relative(rootDir, fullPath)
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}

export interface FileEntry {
  fullPath: string
  fileName: string
  dirPath: string
  ext: string // 소문자, 점 없음 (예: "mp3")
  sizeBytes: number
  modifiedMs: number
}

export interface IndexProgress {
  scanned: number // 지금까지 본 파일 수
  indexed: number // 제외되지 않고 색인된 수
  excluded: number // 제외 패턴에 걸린 수
  currentDir: string
}

// 렌더러로 보내는 집계(엔트리 제외).
export interface IndexSummary {
  scanned: number
  indexed: number
  excluded: number
  hasTarget: boolean // 인덱싱할 폴더가 하나라도 존재했는지
  missing: string[] // settings 에 적혔지만 존재하지 않는 폴더들
}

export interface IndexResult {
  entries: FileEntry[]
  scanned: number
  indexed: number
  excluded: number
}

const YIELD_EVERY = 500 // N 파일마다 이벤트 루프에 양보 (UI 응답 유지)
const PROGRESS_MS = 150 // 진행 알림 최소 간격

/**
 * 디렉터리들을 비동기 재귀 스캔하여 색인을 만든다 (메인 스레드 블로킹 없이).
 * - readdir(withFileTypes) 로 폴더/파일 구분 → stat 호출 최소화
 * - 제외(glob) 대상은 stat 생략
 * - 주기적으로 setImmediate 로 양보, on_progress 는 throttle
 */
export async function build_index(
  directories: string[],
  excludePatterns: string[],
  sink: FileEntry[],
  on_progress: (progress: IndexProgress) => void
): Promise<IndexResult> {
  const is_excluded = picomatch(excludePatterns.length > 0 ? excludePatterns : ['$^'])
  // 점진적 색인: 호출자가 넘긴 배열에 바로 채운다 → 인덱싱 도중에도 검색 가능.
  const entries = sink
  let scanned = 0
  let excluded = 0
  let lastTick = 0
  let sinceYield = 0

  function maybe_progress(currentDir: string): void {
    const now = Date.now()
    if (now - lastTick >= PROGRESS_MS) {
      lastTick = now
      on_progress({ scanned, indexed: entries.length, excluded, currentDir })
    }
  }

  async function walk_directory(root: string, dir: string): Promise<void> {
    let dirents
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      return // 접근 불가 디렉터리는 건너뜀
    }

    for (const dirent of dirents) {
      const fullPath = join(dir, dirent.name)

      if (dirent.isDirectory()) {
        await walk_directory(root, fullPath)
        continue
      }
      if (!dirent.isFile()) {
        continue // 심볼릭 링크 등은 무시
      }

      scanned += 1
      const relativePosix = to_posix(relative(root, fullPath))
      if (is_excluded(relativePosix)) {
        excluded += 1
        continue
      }

      // 유지할 파일만 stat (크기/수정시각)
      let sizeBytes = 0
      let modifiedMs = 0
      try {
        const info = await stat(fullPath)
        sizeBytes = info.size
        modifiedMs = info.mtimeMs
      } catch {
        // stat 실패해도 이름 기준 색인은 유지
      }

      entries.push({
        fullPath,
        fileName: dirent.name,
        dirPath: dir,
        ext: extname(dirent.name).slice(1).toLowerCase(),
        sizeBytes,
        modifiedMs
      })

      maybe_progress(dir)
      sinceYield += 1
      if (sinceYield >= YIELD_EVERY) {
        sinceYield = 0
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }
  }

  for (const directory of directories) {
    await walk_directory(directory, directory)
  }

  on_progress({ scanned, indexed: entries.length, excluded, currentDir: '' })
  return { entries, scanned, indexed: entries.length, excluded }
}
