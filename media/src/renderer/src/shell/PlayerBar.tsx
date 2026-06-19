import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { SearchHit } from '../bridge'

interface PlayerCtx {
  file: SearchHit | null
  playing: boolean
  play: (hit: SearchHit) => void
  pause: () => void
}

export const PlayerContext = createContext<PlayerCtx>({
  file: null,
  playing: false,
  play: () => {},
  pause: () => {},
})

export function usePlayer(): PlayerCtx {
  return useContext(PlayerContext)
}

function to_file_url(path: string): string {
  return 'file:///' + path.replace(/\\/g, '/')
}

export function PlayerProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [file, set_file] = useState<SearchHit | null>(null)
  const [playing, set_playing] = useState(false)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !file) return
    audio.src = to_file_url(file.fullPath)
    audio.load()
    void audio.play()
  }, [file?.fullPath])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const on_play  = (): void => set_playing(true)
    const on_pause = (): void => set_playing(false)
    const on_end   = (): void => set_playing(false)
    audio.addEventListener('play',  on_play)
    audio.addEventListener('pause', on_pause)
    audio.addEventListener('ended', on_end)
    return () => {
      audio.removeEventListener('play',  on_play)
      audio.removeEventListener('pause', on_pause)
      audio.removeEventListener('ended', on_end)
    }
  }, [])

  function play(hit: SearchHit): void {
    if (file?.fullPath === hit.fullPath) {
      void audioRef.current?.play()
    } else {
      set_file(hit)
    }
  }

  function pause(): void {
    audioRef.current?.pause()
  }

  return (
    <PlayerContext.Provider value={{ file, playing, play, pause }}>
      <audio ref={audioRef} />
      {children}
    </PlayerContext.Provider>
  )
}
