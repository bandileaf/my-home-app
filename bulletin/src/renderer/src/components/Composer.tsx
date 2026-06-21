import { useState } from 'react'

interface ComposerProps {
  on_submit: (text: string) => void
}

export function Composer({ on_submit }: ComposerProps): JSX.Element {
  const [text, set_text] = useState('')

  function handle_submit(): void {
    if (!text.trim()) return
    on_submit(text)
    set_text('')
  }

  return (
    <div className="composer">
      <input
        type="text"
        placeholder="가족에게 알릴 내용을 입력하세요..."
        value={text}
        onChange={(e) => set_text(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handle_submit() }}
      />
      <button onClick={handle_submit}>게시</button>
    </div>
  )
}
