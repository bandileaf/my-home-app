import { useState, type ComponentType } from 'react'

export interface TabInfo {
  id: string
  title: string
  Icon?: ComponentType
  dirty?: boolean
}

interface TabBarProps {
  tabs: TabInfo[]
  activeId: string | null
  on_select: (id: string) => void
  on_close: (id: string) => void
  on_reorder: (fromId: string, toId: string) => void
}

const TAB_MIME = 'application/x-musicfinder-tab'

export function TabBar({
  tabs,
  activeId,
  on_select,
  on_close,
  on_reorder
}: TabBarProps): JSX.Element {
  const [overId, set_overId] = useState<string | null>(null)

  return (
    <div className="tab-bar">
      {tabs.map((tab) => {
        const Icon = tab.Icon
        const classes = [
          'tab',
          activeId === tab.id ? 'active' : '',
          overId === tab.id ? 'drag-over' : ''
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <div
            key={tab.id}
            className={classes}
            draggable
            onClick={() => on_select(tab.id)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData(TAB_MIME, tab.id)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              if (overId !== tab.id) {
                set_overId(tab.id)
              }
            }}
            onDragLeave={() => {
              if (overId === tab.id) {
                set_overId(null)
              }
            }}
            onDrop={(event) => {
              event.preventDefault()
              event.stopPropagation() // 외부 파일 드롭 핸들러로 전파 방지
              const fromId = event.dataTransfer.getData(TAB_MIME)
              set_overId(null)
              if (fromId) {
                on_reorder(fromId, tab.id)
              }
            }}
            onDragEnd={() => set_overId(null)}
          >
            {Icon && (
              <span className="tab-icon" aria-hidden="true">
                <Icon />
              </span>
            )}
            <span className="tab-title">{tab.title}</span>
            <button
              className={`tab-close${tab.dirty ? ' dirty' : ''}`}
              title={tab.dirty ? 'Unsaved — close to save' : 'Close'}
              onClick={(event) => {
                event.stopPropagation()
                on_close(tab.id)
              }}
            >
              <span className="tab-close-x">×</span>
              <span className="tab-close-dot">●</span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
