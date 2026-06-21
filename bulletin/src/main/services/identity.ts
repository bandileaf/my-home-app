import { hostname, networkInterfaces } from 'os'
import { createHash } from 'crypto'

export interface Identity {
  deviceId: string
  hostname: string
  macAddresses: string[]
  ip: string | null
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

function mac_to_device_id(macs: string[]): string {
  const key = [...macs].sort().join(',')
  const h = createHash('sha256').update(key).digest('hex')
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-${((parseInt(h.slice(16,18),16)&0x3f)|0x80).toString(16)}${h.slice(18,20)}-${h.slice(20,32)}`
}

export function load_identity(): Identity {
  const { macAddresses, ip } = collect_network_info()
  const deviceId = mac_to_device_id(macAddresses)
  return { deviceId, hostname: hostname(), macAddresses, ip }
}
