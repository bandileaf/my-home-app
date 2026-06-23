import { createConnection } from 'net'
import { networkInterfaces } from 'os'
import http from 'http'

export interface ClientInfo {
  ip: string
  deviceId: string
  hostname: string
  version: string
  has_settings: boolean
  disabled: boolean
}

export interface CommandResult {
  ok: boolean
  error?: string
}

function get_local_ip(): string | null {
  const nets = networkInterfaces()
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address
    }
  }
  return null
}

function probe_tcp(ip: string, port: number, timeout_ms: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({ host: ip, port })
    const timer = setTimeout(() => { socket.destroy(); resolve(false) }, timeout_ms)
    socket.on('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true) })
    socket.on('error', () => { clearTimeout(timer); resolve(false) })
  })
}

function fetch_status(ip: string): Promise<ClientInfo | null> {
  return new Promise(resolve => {
    const req = http.get(`http://${ip}:61799/status`, { timeout: 2000 }, res => {
      let body = ''
      res.on('data', (chunk: Buffer) => { body += chunk.toString() })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body) as Omit<ClientInfo, 'ip'>
          resolve({ ip, has_settings: true, disabled: false, ...parsed })
        }
        catch { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

export async function scan_subnet(): Promise<ClientInfo[]> {
  const local = get_local_ip()
  if (!local) return []
  const prefix = local.split('.').slice(0, 3).join('.')
  const ips = Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`)

  const BATCH = 50
  const reachable: string[] = []
  for (let i = 0; i < ips.length; i += BATCH) {
    const results = await Promise.all(
      ips.slice(i, i + BATCH).map(ip => probe_tcp(ip, 61799, 800).then(ok => ok ? ip : null))
    )
    reachable.push(...results.filter((ip): ip is string => ip !== null))
  }

  const clients = await Promise.all(reachable.map(fetch_status))
  return clients.filter((c): c is ClientInfo => c !== null)
}

export function fetch_client_log(ip: string): Promise<string | null> {
  return new Promise(resolve => {
    const req = http.get(`http://${ip}:61799/log`, { timeout: 5000 }, res => {
      let body = ''
      res.on('data', (chunk: Buffer) => { body += chunk.toString() })
      res.on('end', () => resolve(body))
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

export function fetch_client_settings(ip: string): Promise<string | null> {
  return new Promise(resolve => {
    const req = http.get(`http://${ip}:61799/settings`, { timeout: 3000 }, res => {
      let body = ''
      res.on('data', (chunk: Buffer) => { body += chunk.toString() })
      res.on('end', () => resolve(body))
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

export function send_command(ip: string, path: string, body?: unknown): Promise<CommandResult> {
  return new Promise(resolve => {
    const payload = body !== undefined ? JSON.stringify(body) : null
    const opts: http.RequestOptions = {
      hostname: ip, port: 61799, path,
      method: payload ? 'POST' : 'GET',
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        : {},
      timeout: 5000,
    }
    const req = http.request(opts, res => {
      let data = ''
      res.on('data', (c: Buffer) => { data += c.toString() })
      res.on('end', () => {
        try { resolve(JSON.parse(data) as CommandResult) }
        catch { resolve({ ok: res.statusCode === 200 }) }
      })
    })
    req.on('error', e => resolve({ ok: false, error: (e as Error).message }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }) })
    if (payload) req.write(payload)
    req.end()
  })
}
