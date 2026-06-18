import { existsSync, readFileSync, writeFileSync } from 'fs'
import { hostname, networkInterfaces } from 'os'
import { randomUUID } from 'crypto'
import { join } from 'path'

// 이 PC의 정체성. deviceId 는 한 번 만들어지면 hostname/mac/ip 가 바뀌어도 유지된다 —
// 다른 모든 기능이 참조할 안정적인 기준 키.
export interface Identity {
  deviceId: string
  hostname: string
  macAddresses: string[]
  ip: string | null
}

interface StoredIdentity {
  deviceId: string
}

function resolve_identity_path(baseDir: string): string {
  return join(baseDir, 'identity.json')
}

function read_stored_device_id(path: string): string | null {
  try {
    if (!existsSync(path)) return null
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as StoredIdentity
    return raw.deviceId ?? null
  } catch {
    return null
  }
}

function write_stored_device_id(path: string, deviceId: string): void {
  writeFileSync(path, JSON.stringify({ deviceId }, null, 2), 'utf-8')
}

// hostname 의 모든 비-internal MAC 주소와 IPv4 주소를 모은다.
// (여러 NIC가 있거나 나중에 바뀌어도 deviceId 는 아래에서 별도로 고정한다.)
function collect_network_info(): { macAddresses: string[]; ip: string | null } {
  const interfaces = networkInterfaces()
  const macAddresses = new Set<string>()
  let ip: string | null = null
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue
      if (entry.mac && entry.mac !== '00:00:00:00:00:00') macAddresses.add(entry.mac)
      if (!ip && entry.family === 'IPv4') ip = entry.address
    }
  }
  return { macAddresses: Array.from(macAddresses), ip }
}

export function load_identity(baseDir: string): Identity {
  const path = resolve_identity_path(baseDir)
  let deviceId = read_stored_device_id(path)
  if (!deviceId) {
    deviceId = randomUUID()
    write_stored_device_id(path, deviceId)
  }
  const { macAddresses, ip } = collect_network_info()
  return { deviceId, hostname: hostname(), macAddresses, ip }
}
