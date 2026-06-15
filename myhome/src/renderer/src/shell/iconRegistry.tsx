import type { ComponentType } from 'react'
import { AlignHorizontalDistributeCenter, Search, FileVideo } from 'lucide-react'
import { MusicSearchPanel } from '../panels/MusicSearchPanel'
import { YoutubeSearchPanel } from '../panels/YoutubeSearchPanel'

/** 액티비티 바에 등록되는 항목 1개. panel 이 없으면 클릭 동작은 App 이 처리(예: settings → 에디터). */
export interface IconEntry {
  id: string
  label: string
  Icon: ComponentType
  panel?: ComponentType
  align?: 'top' | 'bottom' // 기본 top. bottom 은 바 맨 아래(VS Code 의 설정 아이콘처럼)
}

/**
 * 액티비티 바 아이콘 레지스트리.
 * 하드코딩이 아니라 이 목록 + 표시여부(visibility)로 구성 → 새 기능은 여기에 추가만 하면 됨.
 */
export const icon_registry: IconEntry[] = [
  { id: 'musicSearch', label: 'Search', Icon: Search, panel: MusicSearchPanel },
  { id: 'youtubeSearch', label: 'YouTube Search', Icon: FileVideo, panel: YoutubeSearchPanel },
  // settings 는 패널이 아니라 settings.json 을 에디터 탭으로 연다 (App 에서 처리)
  { id: 'settings', label: 'Settings', Icon: AlignHorizontalDistributeCenter, align: 'bottom' }
]

/**
 * 아이콘 표시/숨김 기본값.
 * TODO: settings.json 의 "activityBar.icons" 로 대체.
 */
export const default_icon_visibility: Record<string, boolean> = {
  musicSearch: true,
  youtubeSearch: true,
  settings: true
}
