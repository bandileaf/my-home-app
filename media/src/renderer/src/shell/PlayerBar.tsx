import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { FolderSymlink, Play, Square } from 'lucide-react'
import type { SearchHit } from '../bridge'

interface PlayerCtx {
  file: SearchHit | null
  play: (hit: SearchHit) => void
}

export const PlayerContext = createContext<PlayerCtx>({ file: null, play: () => {} })

export function usePlayer(): PlayerCtx {
  return useContext(PlayerContext)
}

function to_file_url(path: string): string {
  return 'file:///' + path.replace(/\\/g, '/')
}

const ICON = { size: 14, strokeWidth: 1.5 }

export function PlayerBar({ file }: { file: SearchHit | null }): JSX.Element | null {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [progress, set_progress] = useState(0)
  const [duration, set_duration] = useState(0)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !file) return
    audio.src = to_file_url(file.fullPath)
    audio.load()
    void audio.play()
    set_progress(0)
    set_duration(0)
  }, [file?.fullPath])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const on_time = (): void => set_progress(audio.currentTime)
    const on_meta = (): void => set_duration(audio.duration)
    const on_end  = (): void => { audio.currentTime = 0; set_progress(0) }
    audio.addEventListener('timeupdate', on_time)
    audio.addEventListener('loadedmetadata', on_meta)
    audio.addEventListener('ended', on_end)
    return () => {
      audio.removeEventListener('timeupdate', on_time)
      audio.removeEventListener('loadedmetadata', on_meta)
      audio.removeEventListener('ended', on_end)
    }
  }, [])

  if (!file) return null

  function do_play(): void { void audioRef.current?.play() }
  function do_stop(): void {
    const a = audioRef.current
    if (!a) return
    a.pause()
    a.currentTime = 0
    set_progress(0)
  }
  function on_seek(e: React.ChangeEvent<HTMLInputElement>): void {
    const t = Number(e.target.value)
    if (audioRef.current) audioRef.current.currentTime = t
    set_progress(t)
  }
  function copy_folder(): void {
    if (file) void navigator.clipboard.writeText(file.dirPath)
  }

  return (
    <div className="player-bar">
      <audio ref={audioRef} />
      <div className="player-controls">
        <button className="player-btn" title="Play" onClick={do_play}><Play {...ICON} /></button>
        <button className="player-btn" title="Stop" onClick={do_stop}><Square {...ICON} /></button>
      </div>
      <input
        type="range"
        className="player-seek"
        min={0}
        max={duration || 1}
        step={0.1}
        value={progress}
        onChange={on_seek}
      />
      <div className="player-file-actions">
        <button className="player-btn" title="폴더 경로 복사" onClick={copy_folder}><FolderSymlink {...ICON} /></button>
      </div>
    </div>
  )
}
