import type { IconEntry } from './iconRegistry'

interface ActivityBarProps {
  icons: IconEntry[]
  visibility: Record<string, boolean>
  activeIconId: string | null
  on_select: (iconId: string) => void
}

export function ActivityBar({
  icons,
  visibility,
  activeIconId,
  on_select
}: ActivityBarProps): JSX.Element {
  const visible = icons.filter((icon) => visibility[icon.id] !== false)
  const top = visible.filter((icon) => icon.align !== 'bottom')
  const bottom = visible.filter((icon) => icon.align === 'bottom')

  function render_icon(icon: IconEntry): JSX.Element {
    const Icon = icon.Icon
    return (
      <button
        key={icon.id}
        className={`activity-icon${activeIconId === icon.id ? ' active' : ''}`}
        title={icon.label}
        onClick={() => on_select(icon.id)}
      >
        <Icon strokeWidth={1.5} />
      </button>
    )
  }

  return (
    <div className="activity-bar">
      {top.map(render_icon)}
      <div className="activity-spacer" />
      {bottom.map(render_icon)}
    </div>
  )
}
