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

const VIRTUAL_MAC_PREFIXES = [
  '00:0c:29', '00:50:56', '00:05:69',  // VMware
  '08:00:27',                            // VirtualBox
  '52:54:00',                            // QEMU/KVM
  '00:15:5d',                            // Hyper-V
  '02:42:',                              // Docker
]

function is_virtual_mac(mac: string): boolean {
  const lower = mac.toLowerCase()
  const firstByte = parseInt(lower.split(':')[0], 16)
  if ((firstByte & 0x02) !== 0) return true  // locally administered = 가상
  return VIRTUAL_MAC_PREFIXES.some(p => lower.startsWith(p))
}

function collect_network_info(): { macAddresses: string[]; ip: string | null } {
  const interfaces = networkInterfaces()
  const macAddresses = new Set<string>()
  let ip: string | null = null
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue
      if (!entry.mac || entry.mac === '00:00:00:00:00:00') continue
      if (is_virtual_mac(entry.mac)) continue
      macAddresses.add(entry.mac)
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
