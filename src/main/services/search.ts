import type { FileEntry } from './indexer'
import { create_excluder, to_posix } from './indexer'

export interface SearchHit {
  fullPath: string
  fileName: string
  dirPath: string
  ext: string
  sizeBytes: number
}

export interface SearchResult {
  hits: SearchHit[]
  total: number // 매칭된 전체 수 (limit 이전)
  truncated: boolean // limit 으로 잘렸는지
}

export interface SearchOptions {
  extensions?: string[] // 소문자, 점 없음 (예: ["mp3","flac"]). 비면 전체
  limit?: number
  excludePatterns?: string[] // 현재 settings 의 exclude glob — DB 에 잔류한 파일도 즉시 숨김
}

function to_hit(entry: FileEntry): SearchHit {
  return {
    fullPath: entry.fullPath,
    fileName: entry.fileName,
    dirPath: entry.dirPath,
    ext: entry.ext,
    sizeBytes: entry.sizeBytes
  }
}

/**
 * 색인된 항목을 파일명 부분일치(대소문자 무시)로 검색한다.
 * 확장자 필터가 있으면 함께 적용. limit 으로 결과 수를 제한한다.
 */
export function search_files(
  entries: FileEntry[],
  query: string,
  options: SearchOptions = {}
): SearchResult {
  const needle = query.trim().toLowerCase()
  if (needle === '') {
    return { hits: [], total: 0, truncated: false }
  }

  const limit = options.limit ?? 500
  const extSet =
    options.extensions && options.extensions.length > 0
      ? new Set(options.extensions.map((ext) => ext.toLowerCase()))
      : null
  // settings 의 exclude 패턴을 검색 시에도 적용 — DB 에 잔류한 파일을 즉시 숨김
  const is_excluded = create_excluder(options.excludePatterns ?? [])

  const hits: SearchHit[] = []
  let total = 0

  for (const entry of entries) {
    if (extSet && !extSet.has(entry.ext)) {
      continue
    }
    if (is_excluded(to_posix(entry.fullPath))) {
      continue
    }
    if (!entry.fileName.toLowerCase().includes(needle)) {
      continue
    }
    total += 1
    if (hits.length < limit) {
      hits.push(to_hit(entry))
    }
  }

  return { hits, total, truncated: total > hits.length }
}
