import { createServer } from 'http'
import type { IncomingMessage, ServerResponse } from 'http'
import { readFileSync, writeFileSync } from 'fs'
import { app } from 'electron'

export interface ControlContext {
  deviceId: string
  hostname: string
  settingsPath: string
  on_update: () => void
  on_settings_received: () => void
  log: (msg: string) => void
}

function read_body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function send_json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

export function start_control_server(ctx: ControlContext): void {
  const server = createServer(async (req, res) => {
    const { method, url } = req
    try {
      if (method === 'GET' && url === '/status') {
        send_json(res, 200, { deviceId: ctx.deviceId, hostname: ctx.hostname, version: app.getVersion() })
        return
      }
      if (method === 'GET' && url === '/settings') {
        let content = '{}'
        try { content = readFileSync(ctx.settingsPath, 'utf-8') } catch { /* no settings yet */ }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(content)
        return
      }
      if (method === 'POST' && url === '/settings') {
        const body = await read_body(req)
        const parsed = JSON.parse(body)
        writeFileSync(ctx.settingsPath, JSON.stringify(parsed, null, 2), 'utf-8')
        send_json(res, 200, { ok: true })
        ctx.log('control: settings received, restarting...')
        setTimeout(() => ctx.on_settings_received(), 500)
        return
      }
      if (method === 'POST' && url === '/restart') {
        send_json(res, 200, { ok: true })
        ctx.log('control: restart requested remotely')
        setTimeout(() => { app.relaunch(); app.quit() }, 500)
        return
      }
      if (method === 'POST' && url === '/update') {
        send_json(res, 200, { ok: true })
        ctx.log('control: update triggered remotely')
        ctx.on_update()
        return
      }
      send_json(res, 404, { error: 'not found' })
    } catch (e) {
      send_json(res, 500, { error: String(e) })
    }
  })

  server.listen(7799, '0.0.0.0', () => ctx.log('control: HTTP server listening on :7799'))
  server.on('error', (e) => ctx.log(`control: server error ${e.message}`))
}
