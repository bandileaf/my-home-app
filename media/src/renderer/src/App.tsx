import { createContext, useContext, useEffect, useReducer, useRef, useState } from 'react'
import { ActivityBar } from './shell/ActivityBar'
import { MenuBar } from './shell/MenuBar'
import { TabBar } from './shell/TabBar'
import { StatusBar, type IndexStatus } from './shell/StatusBar'
import { PlayerBar, PlayerContext } from './shell/PlayerBar'
import { icon_registry, default_icon_visibility } from './shell/iconRegistry'
import { File } from 'lucide-react'
import { EditorPanel } from './panels/EditorPanel'
import { get_bridge, type SearchHit } from './bridge'
import { useNotify } from './notifications'
import { doc_types, resolve_doc_type } from './docs'

interface TabCtx { tabId: string; setTitle: (t: string) => void }
const TabContext = createContext<TabCtx | null>(null)
export function useTabCtx(): TabCtx {
  return useContext(TabContext) ?? { tabId: '', setTitle: () => {} }
}

type OpenTab =
  | { id: string; kind: 'feature'; iconId: string; title: string }
  | { id: string; kind: 'editor'; filePath: string; title: string }

interface UiState {
  tabs: OpenTab[]
  activeId: string | null
}

const STATE_KEY = 'uiState'
const STATE_KEY_LS = 'musicFinder.uiState.v2' // localStorage 폴백 (브라우저 dev 모드)

function base_name(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export function App(): JSX.Element {
  const [tabs, set_tabs] = useState<OpenTab[]>([])
  const [activeId, set_activeId] = useState<string | null>(null)
  const [playerFile, set_playerFile] = useState<SearchHit | null>(null)
  const [settingsPath, set_settingsPath] = useState('')
  const notify = useNotify()
  const visibility = default_icon_visibility
  const musicEnabled = visibility.musicSearch !== false

  const [indexStatus, set_indexStatus] = useState<IndexStatus>(
    musicEnabled ? { phase: 'pending' } : { phase: 'disabled' }
  )

  // DB or localStorage 에서 UI 상태 로드 (async 초기화)
  const initialized = useRef(false)

  // 에디터 내용은 App 이 소유한다. drafts = 현재 편집중 텍스트, originals = 마지막 저장/로드 텍스트.
  const [drafts, set_drafts] = useState<Record<string, string>>({})
  const [loaded, set_loaded] = useState<Record<string, boolean>>({})
  const [loadError, set_loadError] = useState<Record<string, string>>({})
  const originals = useRef<Record<string, string>>({})
  const [, force_render] = useReducer((n: number) => n + 1, 0)

  // 외부 수정 감지(watch)용 — 콜백이 항상 최신 상태를 보도록 ref 로 유지
  const tabsRef = useRef(tabs)
  const draftsRef = useRef(drafts)
  const settingsPathRef = useRef(settingsPath)
  const watchedRef = useRef<Set<string>>(new Set())
  tabsRef.current = tabs
  draftsRef.current = drafts
  settingsPathRef.current = settingsPath

  const editorAvailable = Boolean(get_bridge()?.read_file)

  function is_dirty(filePath: string): boolean {
    return Boolean(loaded[filePath]) && drafts[filePath] !== originals.current[filePath]
  }

  function run_indexing(): void {
    if (!musicEnabled) {
      set_indexStatus({ phase: 'disabled' })
      return
    }
    const start = get_bridge()?.start_indexing
    if (!start) {
      set_indexStatus({ phase: 'unavailable' })
      return
    }
    set_indexStatus({ phase: 'pending' })
    start()
      .then((summary) => set_indexStatus({ phase: 'done', ...summary }))
      .catch((error: unknown) =>
        set_indexStatus({
          phase: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
      )
  }

  // 시작 시 DB(또는 localStorage fallback)에서 상태 복원
  useEffect(() => {
    const bridge = get_bridge()
    const apply = (raw: string | null): void => {
      if (raw) {
        try {
          const saved = JSON.parse(raw) as UiState
          set_tabs(saved.tabs ?? [])
          set_activeId(saved.activeId)
        } catch { /* 손상된 상태는 무시 */ }
      }
      initialized.current = true
    }
    if (bridge?.app_state_get) {
      bridge.app_state_get(STATE_KEY).then(apply).catch(() => { initialized.current = true })
    } else {
      // 브라우저 dev 모드 fallback
      apply(window.localStorage.getItem(STATE_KEY_LS))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 상태 저장 (초기화 완료 후에만)
  useEffect(() => {
    if (!initialized.current) return
    const bridge = get_bridge()
    const payload = JSON.stringify({ tabs, activeId })
    if (bridge?.app_state_set) {
      bridge.app_state_set(STATE_KEY, payload)
    } else {
      window.localStorage.setItem(STATE_KEY_LS, payload)
    }
  }, [tabs, activeId])

  // 시작 흐름: settings.json 을 찾는다.
  //  - 있으면 → 인덱싱 시작 (상태 바에 진행 표시)
  //  - 없으면 → "기본 설정을 만들까요?" 알림(Create 버튼). 누르면 생성 후 에디터로 연다.
  useEffect(() => {
    const bridge = get_bridge()
    const unsubscribeProgress = bridge?.on_index_progress?.((progress) =>
      set_indexStatus({ phase: 'scanning', ...progress })
    )
    // 백그라운드 스캔 완료 → 최종 파일 수로 status 갱신
    const unsubscribeDone = bridge?.on_index_done?.((summary) =>
      set_indexStatus({ phase: 'done', ...summary })
    )

    const status = bridge?.settings_status
    if (!status) {
      run_indexing() // 브라우저 등 → unavailable/disabled
    } else {
      status()
        .then(({ path, exists }) => {
          set_settingsPath(path)
          if (exists) {
            run_indexing()
          } else {
            set_indexStatus({ phase: 'nosettings' })
            notify('settings.json not found. Create a default one?', 'info', {
              label: 'Create',
              run: () => {
                get_bridge()
                  ?.create_default_settings?.()
                  .then(() => {
                    open_editor(path)
                    run_indexing()
                  })
                  .catch(() => {})
              }
            })
          }
        })
        .catch(() => run_indexing())
    }

    return () => {
      unsubscribeProgress?.()
      unsubscribeDone?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 활성 에디터 탭의 파일을 (아직 안 읽었으면) 읽어 draft 로 채운다.
  useEffect(() => {
    const tab = tabs.find((t) => t.id === activeId)
    if (!tab || tab.kind !== 'editor' || loaded[tab.filePath]) {
      return
    }
    const read = get_bridge()?.read_file
    if (!read) {
      return
    }
    const path = tab.filePath
    let cancelled = false
    read(path)
      .then((result) => {
        if (cancelled) {
          return
        }
        originals.current[path] = result.text
        set_drafts((prev) => (path in prev ? prev : { ...prev, [path]: result.text }))
        set_loaded((prev) => ({ ...prev, [path]: true }))
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          set_loadError((prev) => ({ ...prev, [path]: String(error) }))
          set_loaded((prev) => ({ ...prev, [path]: true }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeId, tabs, loaded])

  // 외부 파일 drag & drop → 에디터로 열기 (기본 동작=창 이동 방지)
  useEffect(() => {
    function on_dragover(event: DragEvent): void {
      event.preventDefault()
    }
    function on_drop(event: DragEvent): void {
      event.preventDefault()
      const path_for_file = get_bridge()?.path_for_file
      if (!path_for_file || !event.dataTransfer) {
        return
      }
      for (const file of Array.from(event.dataTransfer.files)) {
        const path = path_for_file(file)
        if (path) {
          open_editor(path)
        }
      }
    }
    window.addEventListener('dragover', on_dragover)
    window.addEventListener('drop', on_drop)
    return () => {
      window.removeEventListener('dragover', on_dragover)
      window.removeEventListener('drop', on_drop)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 외부 파일 변경 알림 구독 → 해당 파일 doc 을 다시 해석/reload
  useEffect(() => {
    const unsubscribe = get_bridge()?.on_file_changed?.((path) => handle_file_changed(path))
    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // watch 정책이 있는 doc(파일 기반)만 main 에 watch 등록/해제 (탭 열고 닫음에 따라)
  useEffect(() => {
    const bridge = get_bridge()
    if (!bridge?.watch_file || !bridge.unwatch_file) {
      return
    }
    const current = new Set<string>()
    for (const tab of tabs) {
      if (tab.kind === 'editor' && resolve_doc_type('editor').watch) {
        current.add(tab.filePath)
      }
    }
    current.forEach((path) => {
      if (!watchedRef.current.has(path)) {
        bridge.watch_file?.(path)
        watchedRef.current.add(path)
      }
    })
    watchedRef.current.forEach((path) => {
      if (!current.has(path)) {
        bridge.unwatch_file?.(path)
        watchedRef.current.delete(path)
      }
    })
  }, [tabs])

  // 기능 아이콘: doc 속성이 multi 면 누를 때마다 새 탭, 아니면 기존 탭으로 이동.
  function open_feature(iconId: string): void {
    const entry = icon_registry.find((icon) => icon.id === iconId)
    if (!entry) {
      return
    }
    const docType = doc_types[iconId] ?? { multi: true, editable: false, closeDirty: 'discard' }
    if (!docType.multi) {
      const existing = tabs.find((tab) => tab.kind === 'feature' && tab.iconId === iconId)
      if (existing) {
        set_activeId(existing.id)
        return
      }
    }
    const tab: OpenTab = {
      id: `feature-${iconId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'feature',
      iconId,
      title: entry.label
    }
    set_tabs((prev) => [...prev, tab])
    set_activeId(tab.id)
  }

  // 에디터로 파일 열기. 이미 열린 파일이면 그 탭을 활성화(중복 생성 방지, race-safe).
  function open_editor(filePath: string): void {
    const newTab: OpenTab = {
      id: `editor-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'editor',
      filePath,
      title: base_name(filePath)
    }
    let targetId = newTab.id
    set_tabs((prev) => {
      const existing = prev.find((tab) => tab.kind === 'editor' && tab.filePath === filePath)
      if (existing) {
        targetId = existing.id
        return prev
      }
      return [...prev, newTab]
    })
    set_activeId(targetId)
  }

  function rename_tab(id: string, title: string): void {
    set_tabs((prev) => prev.map((t) => t.id === id ? { ...t, title } : t))
  }

  function reorder_tabs(fromId: string, toId: string): void {
    if (fromId === toId) {
      return
    }
    set_tabs((prev) => {
      const from = prev.findIndex((tab) => tab.id === fromId)
      const to = prev.findIndex((tab) => tab.id === toId)
      if (from < 0 || to < 0) {
        return prev
      }
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  async function open_settings(): Promise<void> {
    let path = settingsPath
    if (!path) {
      const get_path = get_bridge()?.get_settings_path
      if (get_path) {
        path = await get_path()
        set_settingsPath(path)
      }
    }
    if (path) {
      open_editor(path)
    }
  }

  function handle_activity(iconId: string): void {
    if (iconId === 'settings') {
      void open_settings()
      return
    }
    open_feature(iconId)
  }

  // 현재 활성 탭 저장(닫지 않음). editable doc(에디터)만 가능 — music/youtube 는 save 불가.
  function save_active(): void {
    const tab = tabs.find((t) => t.id === activeId)
    if (!tab) {
      return
    }
    const docType = resolve_doc_type(tab.kind, tab.kind === 'feature' ? tab.iconId : undefined)
    if (!docType.editable || tab.kind !== 'editor' || !is_dirty(tab.filePath)) {
      return
    }
    const path = tab.filePath
    const write = get_bridge()?.write_file
    const text = drafts[path]
    if (write && text !== undefined) {
      write(path, text)
        .then(() => {
          originals.current[path] = text
          force_render() // dirty 표식(●) 갱신
          if (settingsPath && path === settingsPath) {
            run_indexing()
          }
        })
        .catch(() => {})
    }
  }

  function close_app(): void {
    const bridge = get_bridge()
    if (bridge?.close_window) {
      bridge.close_window()
    } else {
      window.close()
    }
  }

  // 외부에서 파일이 바뀌었을 때: 안 열려있으면 무시, dirty 면 충돌 알림, 아니면 reload(+settings 면 재인덱싱).
  function handle_file_changed(path: string): void {
    if (!tabsRef.current.some((t) => t.kind === 'editor' && t.filePath === path)) {
      return
    }
    const draft = draftsRef.current[path]
    const dirty = draft !== undefined && draft !== originals.current[path]
    if (dirty) {
      notify(`${base_name(path)} changed on disk — you have unsaved edits`, 'error')
      return
    }
    const read = get_bridge()?.read_file
    read
      ?.(path)
      .then((result) => {
        originals.current[path] = result.text
        set_drafts((prev) => ({ ...prev, [path]: result.text }))
        force_render()
        if (settingsPathRef.current && path === settingsPathRef.current) {
          run_indexing()
        }
      })
      .catch(() => {})
  }

  // settings.json 이면 저장 후 재인덱싱하는 헬퍼.
  function write_doc(path: string, text: string): void {
    const write = get_bridge()?.write_file
    if (!write) {
      return
    }
    write(path, text)
      .then(() => {
        originals.current[path] = text
        force_render()
        if (settingsPath && path === settingsPath) {
          run_indexing()
        }
      })
      .catch(() => {})
  }

  // 탭 닫기. doc 속성(closeDirty)에 따라 동작이 다르다.
  function close_tab(id: string): void {
    const tab = tabs.find((t) => t.id === id)
    if (tab && tab.kind === 'editor') {
      const docType = resolve_doc_type('editor')
      const path = tab.filePath
      const text = drafts[path]
      if (docType.editable && is_dirty(path) && text !== undefined) {
        if (docType.closeDirty === 'save') {
          write_doc(path, text)
        } else if (docType.closeDirty === 'notify') {
          // 저장하지 않고 닫되, 알림으로 알린다 (Save 액션으로 복구 가능)
          notify(`Closed without saving: ${base_name(path)}`, 'error', {
            label: 'Save',
            run: () => write_doc(path, text)
          })
        }
        // 'discard' → 아무것도 안 함
      }
      delete originals.current[path]
      set_drafts((prev) => {
        const next = { ...prev }
        delete next[path]
        return next
      })
      set_loaded((prev) => {
        const next = { ...prev }
        delete next[path]
        return next
      })
    }

    // feature 탭 검색어 정리
    if (tab?.kind === 'feature') {
      get_bridge()?.app_state_set?.(`tab:query:${id}`, '')
    }

    const remaining = tabs.filter((t) => t.id !== id)
    set_tabs(remaining)
    if (activeId === id) {
      set_activeId(remaining.length > 0 ? remaining[remaining.length - 1].id : null)
    }
  }

  const tabInfos = tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    dirty: tab.kind === 'editor' ? is_dirty(tab.filePath) : false,
    Icon:
      tab.kind === 'feature'
        ? icon_registry.find((icon) => icon.id === tab.iconId)?.Icon
        : File
  }))

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null
  const activeIconId =
    activeTab?.kind === 'feature'
      ? activeTab.iconId
      : activeTab?.kind === 'editor' && activeTab.filePath === settingsPath
        ? 'settings'
        : null

  // 탭 1개의 내용. 각 탭은 고유 key 의 슬롯에 담겨 독립적으로 마운트된다.
  function render_tab(tab: OpenTab): JSX.Element {
    if (tab.kind === 'editor') {
      const path = tab.filePath
      return (
        <EditorPanel
          value={drafts[path] ?? ''}
          available={editorAvailable}
          error={loadError[path] ?? ''}
          on_change={(text) => set_drafts((prev) => ({ ...prev, [path]: text }))}
        />
      )
    }
    const entry = icon_registry.find((icon) => icon.id === tab.iconId)
    const Panel = entry?.panel
    return Panel
      ? <TabContext.Provider value={{ tabId: tab.id, setTitle: (t) => rename_tab(tab.id, t) }}><Panel /></TabContext.Provider>
      : <div className="empty-hint" />
  }

  return (
    <PlayerContext.Provider value={{ file: playerFile, play: set_playerFile }}>
    <div className="app">
      <MenuBar
        on_close={close_app}
        on_save={save_active}
        on_open_settings={() => void open_settings()}
      />
      <div className="shell">
        <ActivityBar
          icons={icon_registry}
          visibility={visibility}
          activeIconId={activeIconId}
          on_select={handle_activity}
        />
        <div className="workbench">
          <TabBar
            tabs={tabInfos}
            activeId={activeId}
            on_select={set_activeId}
            on_close={close_tab}
            on_reorder={reorder_tabs}
          />
          <div className="panel-host">
            {tabs.length === 0 ? (
              <div className="empty-hint">Select an icon on the left to start.</div>
            ) : (
              tabs.map((tab) => (
                <div
                  key={tab.id}
                  className="panel-slot"
                  style={{ display: tab.id === activeId ? 'block' : 'none' }}
                >
                  {render_tab(tab)}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <PlayerBar file={playerFile} />
      <StatusBar status={indexStatus} />
    </div>
    </PlayerContext.Provider>
  )
}
