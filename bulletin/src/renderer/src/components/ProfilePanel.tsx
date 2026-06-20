import { useRef, useState } from 'react'
import { X, Camera } from 'lucide-react'

interface ProfilePanelProps {
  alias: string | null
  avatar: string | null
  hostname: string
  on_close: () => void
  on_save: (alias: string | null, avatar: string | null) => void
}

export function ProfilePanel({ alias, avatar, hostname, on_close, on_save }: ProfilePanelProps): JSX.Element {
  const [name, set_name] = useState(alias ?? '')
  const [img, set_img] = useState<string | null>(avatar)
  const [img_warn, set_img_warn] = useState<string | null>(null)
  const file_ref = useRef<HTMLInputElement>(null)

  const MAX_AVATAR_BYTES = 500 * 1024

  function handle_file(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_AVATAR_BYTES) {
      set_img_warn(`이미지가 너무 큽니다 (${Math.round(file.size / 1024)}KB). 500KB 이하만 가능합니다.`)
      e.target.value = ''
      return
    }
    set_img_warn(null)
    const reader = new FileReader()
    reader.onload = () => set_img(reader.result as string)
    reader.readAsDataURL(file)
  }

  function handle_save(): void {
    const trimmed = name.trim()
    on_save(trimmed || null, img)
    on_close()
  }

  const initials = (alias?.trim() || hostname).slice(0, 2).toUpperCase()

  return (
    <div className="profile-overlay" onClick={on_close}>
      <div className="profile-panel" onClick={(e) => e.stopPropagation()}>
        <button className="profile-close" onClick={on_close}><X size={20} /></button>

        <div className="profile-avatar-wrap" onClick={() => file_ref.current?.click()}>
          {img
            ? <img src={img} className="profile-avatar-img" alt="avatar" />
            : <span className="profile-avatar-initials">{initials}</span>
          }
          <div className="profile-avatar-cam"><Camera size={22} /></div>
        </div>
        <input ref={file_ref} type="file" accept="image/*" style={{ display: 'none' }} onChange={handle_file} />
        {img_warn && <p className="profile-warn">{img_warn}</p>}

        <input
          className="profile-name-input"
          value={name}
          onChange={(e) => set_name(e.target.value)}
          placeholder={hostname}
        />

        <button className="profile-save-btn" onClick={handle_save}>저장</button>
      </div>
    </div>
  )
}
