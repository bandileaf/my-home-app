import { createServer } from 'http'
import type { IncomingMessage, ServerResponse } from 'http'
import { readFileSync, writeFileSync } from 'fs'
import { app } from 'electron'

export interface ControlContext {
  deviceId: string
  hostname: string
  settingsPath: string
  has_settings: () => boolean
  is_disabled: () => boolean
  is_admin: () => boolean
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
        send_json(res, 200, {
          deviceId: ctx.deviceId,
          hostname: ctx.hostname,
          version: app.getVersion(),
          has_settings: ctx.has_settings(),
          disabled: ctx.is_disabled(),
        })
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
        let existed = false
        try { readFileSync(ctx.settingsPath, 'utf-8'); existed = true } catch { /* no settings yet */ }
        writeFileSync(ctx.settingsPath, JSON.stringify(parsed, null, 2), 'utf-8')
        send_json(res, 200, { ok: true })
        if (!existed) {
          ctx.log('control: first settings received, restarting...')
          setTimeout(() => ctx.on_settings_received(), 500)
        } else {
          ctx.log('control: settings updated (no restart)')
        }
        return
      }
      if (method === 'POST' && url === '/disable') {
        if (ctx.is_admin()) { send_json(res, 200, { ok: false, error: 'admin' }); return }
        try {
          let raw: Record<string, unknown> = {}
          try { raw = JSON.parse(readFileSync(ctx.settingsPath, 'utf-8')) as Record<string, unknown> } catch { /* no settings yet */ }
          raw['hub.disabled'] = true
          writeFileSync(ctx.settingsPath, JSON.stringify(raw, null, 2), 'utf-8')
        } catch (e) { send_json(res, 500, { error: String(e) }); return }
        send_json(res, 200, { ok: true })
        ctx.log('control: disable — hub.disabled=true saved')
        return
      }
      if (method === 'POST' && url === '/enable') {
        try {
          let raw: Record<string, unknown> = {}
          try { raw = JSON.parse(readFileSync(ctx.settingsPath, 'utf-8')) as Record<string, unknown> } catch { /* no settings yet */ }
          delete raw['hub.disabled']
          writeFileSync(ctx.settingsPath, JSON.stringify(raw, null, 2), 'utf-8')
        } catch (e) { send_json(res, 500, { error: String(e) }); return }
        send_json(res, 200, { ok: true })
        ctx.log('control: enable — hub.disabled removed')
        return
      }
      if (method === 'POST' && url === '/restart') {
        send_json(res, 200, { ok: true })
        ctx.log('control: restart requested remotely')
        setTimeout(() => { app.relaunch({ args: process.argv.slice(1).concat(['--post-restart']) }); app.quit() }, 500)
        return
      }
      if (method === 'POST' && url === '/update') {
        try {
          const raw = JSON.parse(readFileSync(ctx.settingsPath, 'utf-8')) as Record<string, unknown>
          delete raw['hub.tag']
          writeFileSync(ctx.settingsPath, JSON.stringify(raw, null, 2), 'utf-8')
        } catch { /* settings 없으면 그냥 재시작 */ }
        send_json(res, 200, { ok: true })
        ctx.log('control: update triggered — hub.tag cleared, restarting...')
        setTimeout(() => { app.relaunch({ args: process.argv.slice(1).concat(['--post-restart']) }); app.quit() }, 500)
        return
      }
      send_json(res, 404, { error: 'not found' })
    } catch (e) {
      send_json(res, 500, { error: String(e) })
    }
  })

  server.listen(61799, '0.0.0.0', () => ctx.log('control: HTTP server listening on :61799'))
  server.on('error', (e) => ctx.log(`control: server error ${e.message}`))
}
