import { useState } from 'react'

export function YoutubeSearchPanel(): JSX.Element {
  const [query, set_query] = useState('')
  const trimmed = query.trim()

  return (
    <div className="search-panel">
      <input
        className="search-box"
        placeholder="Search YouTube…"
        value={query}
        onChange={(event) => set_query(event.target.value)}
      />
      <div className="result-list">
        {trimmed === '' ? (
          <div className="empty-hint">Type to search. (yt-dlp search coming soon)</div>
        ) : (
          <div className="empty-hint">
            "{trimmed}" — yt-dlp search &amp; download coming soon.
          </div>
        )}
      </div>
    </div>
  )
}
