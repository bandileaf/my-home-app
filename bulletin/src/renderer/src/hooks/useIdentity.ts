import { useEffect, useState } from 'react'
import { get_bridge, type Identity } from '../bridge'

const BROWSER_PREVIEW_IDENTITY: Identity = {
  deviceId: 'preview',
  hostname: 'PREVIEW-PC',
  macAddresses: [],
  ip: null
}

// identity 는 main 프로세스가 hostname/MAC 을 읽어 결정한다 — 이 훅은 그 결과를
// 가져오기만 한다 (직접 IPC 를 부르는 로직은 컴포넌트에 두지 않는다).
export function useIdentity(): Identity | null {
  const [identity, set_identity] = useState<Identity | null>(null)

  useEffect(() => {
    const get_identity = get_bridge()?.get_identity
    if (!get_identity) {
      set_identity(BROWSER_PREVIEW_IDENTITY) // dev:web 브라우저 미리보기용
      return
    }
    get_identity().then(set_identity).catch(() => set_identity(BROWSER_PREVIEW_IDENTITY))
  }, [])

  return identity
}
