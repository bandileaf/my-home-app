import { existsSync, readFileSync } from 'fs'
import { dirname, isAbsolute, resolve } from 'path'
import { parse as parse_jsonc, printParseErrorCode, type ParseError } from 'jsonc-parser'

export interface MusicSettings {
  searchDirectories: string[]
  exclude: string[] // 값이 true 인 glob 패턴만 추려낸 목록
  downloadDirectory: string // 비어 있으면 exe 옆 Downloads/ 사용
}

interface RawSettings {
  'musicSearch.searchDirectories'?: string[]
  'musicSearch.exclude'?: Record<string, boolean>
  'musicSearch.downloadDirectory'?: string
}

/**
 * settings.json(JSONC) 을 읽어 정규화한다.
 * - 상대 디렉터리는 settings 파일 위치 기준으로 절대 경로화
 * - exclude 는 { glob: bool } 에서 true 인 것만 패턴 배열로
 */
export function load_settings(settingsPath: string): MusicSettings {
  if (!existsSync(settingsPath)) {
    return { searchDirectories: [], exclude: [], downloadDirectory: '' }
  }
  const text = readFileSync(settingsPath, 'utf-8')
  const errors: ParseError[] = []
  const raw = (parse_jsonc(text, errors, { allowTrailingComma: true }) ?? {}) as RawSettings

  // JSONC 오류(예: Windows 경로 \ 미이스케이프)는 조용히 묻지 말고 알린다.
  if (errors.length > 0) {
    const detail = errors.map((e) => `${printParseErrorCode(e.error)}@${e.offset}`).join(', ')
    throw new Error(`settings.json parse error: ${detail} — use \\\\ or / in Windows paths`)
  }

  const baseDir = dirname(settingsPath)

  const directories = (raw['musicSearch.searchDirectories'] ?? []).map((dir) =>
    isAbsolute(dir) ? dir : resolve(baseDir, dir)
  )

  const excludeMap = raw['musicSearch.exclude'] ?? {}
  const exclude = Object.keys(excludeMap).filter((pattern) => excludeMap[pattern])

  const downloadDirectory = raw['musicSearch.downloadDirectory'] ?? ''

  return { searchDirectories: directories, exclude, downloadDirectory }
}
