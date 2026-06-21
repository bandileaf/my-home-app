import { hostname, networkInterfaces } from 'os'
import { execSync } from 'child_process'

export interface Identity {
  deviceId: string
  hostname: string
  macAddresses: string[]
  ip: string | null
}

const VIRTUAL_MAC_PREFIXES = [
  '00:0c:29', '00:50:56', '00:05:69',
  '08:00:27',
  '52:54:00',
  '00:15:5d',
  '02:42:',
]

function is_virtual_mac(mac: string): boolean {
  const lower = mac.toLowerCase()
  const firstByte = parseInt(lower.split(':')[0], 16)
  if ((firstByte & 0x02) !== 0) return true
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

function get_bios_uuid(): string | null {
  try {
    const out = execSync('wmic csproduct get UUID /value', { timeout: 3000 }).toString()
    const match = out.match(/UUID=([0-9A-Fa-f-]{36})/)
    return match ? match[1].toLowerCase() : null
  } catch {
    return null
  }
}

export function load_identity(): Identity {
  const { macAddresses, ip } = collect_network_info()
  const deviceId = get_bios_uuid() ?? macAddresses[0] ?? 'unknown'
  return { deviceId, hostname: hostname(), macAddresses, ip }
}
