// 렌더러에서 Electron preload API(window.api)에 타입 안전하게 접근하기 위한 헬퍼.
// 브라우저 미리보기(dev:web)에서는 window.api 가 없으므로 항상 존재 여부를 확인한다.

export interface Identity {
  deviceId: string
  hostname: string
  macAddresses: string[]
  ip: string | null
}

export interface Ack {
  deviceId: string
  hostname: string
  confirmedAt: number
}

export interface Notice {
  id: string
  authorDeviceId: string
  authorHostname: string
  kind: 'sticker'
  text: string
  createdAt: number
  acks: Ack[]
}

export interface AppBridge {
  get_identity?: () => Promise<Identity>
  list_notices?: () => Promise<Notice[]>
  create_notice?: (text: string) => Promise<Notice>
  confirm_notice?: (noticeId: string) => Promise<Notice | null>
}

export function get_bridge(): AppBridge | undefined {
  return (window as unknown as { api?: AppBridge }).api
}
