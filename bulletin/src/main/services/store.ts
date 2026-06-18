import { existsSync, readFileSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'

export interface Ack {
  deviceId: string
  hostname: string
  confirmedAt: number
}

export interface Notice {
  id: string
  authorDeviceId: string
  authorHostname: string
  kind: 'sticker' // 나중에 'event' | 'poll' 등으로 확장 가능
  text: string
  createdAt: number
  acks: Ack[] // append-only — 나중에 P2P 동기화가 머지하기 좋은 형태
}

export interface NoticeState {
  notices: Notice[]
}

interface NewsData {
  notices: Notice[]
}

function resolve_store_path(baseDir: string): string {
  return join(baseDir, 'news_data.json')
}

// 실제 peer 가 아직 없을 때도 "여러 명 확인" 상태를 화면에서 볼 수 있게 하는 시드 데이터.
// 진짜 기록이 한 번이라도 저장되면(news_data.json 생성) 더 이상 쓰이지 않는다.
function seed_mock_notices(): Notice[] {
  const now = Date.now()
  return [
    {
      id: randomUUID(),
      authorDeviceId: 'mock-mom',
      authorHostname: 'MOM-PC',
      kind: 'sticker',
      text: '오늘 저녁 7시에 다같이 저녁 먹어요. 외식 예정입니다!',
      createdAt: now - 5 * 60 * 60 * 1000,
      acks: [
        { deviceId: 'mock-mom', hostname: 'MOM-PC', confirmedAt: now - 5 * 60 * 60 * 1000 },
        { deviceId: 'mock-kid', hostname: 'KID-PC', confirmedAt: now - 4 * 60 * 60 * 1000 }
      ]
    },
    {
      id: randomUUID(),
      authorDeviceId: 'mock-kid',
      authorHostname: 'KID-PC',
      kind: 'sticker',
      text: '거실 전구 갈았습니다. 확인해주세요.',
      createdAt: now - 30 * 60 * 1000,
      acks: []
    }
  ]
}

function read_news_data(path: string): NewsData {
  if (!existsSync(path)) return { notices: seed_mock_notices() }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as NewsData
  } catch {
    return { notices: [] }
  }
}

function write_news_data(baseDir: string, data: NewsData): void {
  writeFileSync(resolve_store_path(baseDir), JSON.stringify(data, null, 2), 'utf-8')
}

export function load_notice_state(baseDir: string): NoticeState {
  return { notices: read_news_data(resolve_store_path(baseDir)).notices }
}

export function list_notices(state: NoticeState): Notice[] {
  return state.notices
}

export function create_notice(
  baseDir: string,
  state: NoticeState,
  authorDeviceId: string,
  authorHostname: string,
  text: string
): Notice {
  const notice: Notice = {
    id: randomUUID(),
    authorDeviceId,
    authorHostname,
    kind: 'sticker',
    text,
    createdAt: Date.now(),
    acks: []
  }
  state.notices = [notice, ...state.notices]
  write_news_data(baseDir, { notices: state.notices })
  return notice
}

export function confirm_notice(
  baseDir: string,
  state: NoticeState,
  noticeId: string,
  deviceId: string,
  hostname: string
): Notice | null {
  const notice = state.notices.find((n) => n.id === noticeId)
  if (!notice) return null
  if (notice.acks.some((a) => a.deviceId === deviceId)) return notice // 중복 확인 방지
  notice.acks = [...notice.acks, { deviceId, hostname, confirmedAt: Date.now() }]
  write_news_data(baseDir, { notices: state.notices })
  return notice
}
