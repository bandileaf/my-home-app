import { randomUUID } from 'crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import ws from 'ws'

export interface Reply {
  id: string
  authorDeviceId: string
  authorHostname: string
  text: string
  createdAt: number
}

export interface Vote {
  deviceId: string
  hostname: string
  vote: 'yes' | 'no'
  votedAt: number
}

export interface Notice {
  id: string
  authorDeviceId: string
  authorHostname: string
  kind: 'sticker' | 'reply_request' | 'vote'
  text: string
  createdAt: number
  replies: Reply[]
  votes: Vote[]
}

export interface AppInfo {
  width?: number
  height?: number
  theme?: string
  alias?: string
}

let _client: SupabaseClient | null = null

export function init_supabase(url: string, key: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _client = createClient(url, key, { realtime: { transport: ws as any } })
}

function db(): SupabaseClient {
  if (!_client) throw new Error('Supabase not initialized')
  return _client
}

function row_to_notice(row: Record<string, unknown>): Notice {
  const replies = (row.replies as Record<string, unknown>[] ?? []).map((r) => ({
    id: r.id as string,
    authorDeviceId: r.author_device_id as string,
    authorHostname: r.author_hostname as string,
    text: r.text as string,
    createdAt: r.created_at as number
  }))
  const votes = (row.votes as Record<string, unknown>[] ?? []).map((v) => ({
    deviceId: v.device_id as string,
    hostname: v.hostname as string,
    vote: v.vote as 'yes' | 'no',
    votedAt: v.voted_at as number
  }))
  return {
    id: row.id as string,
    authorDeviceId: row.author_device_id as string,
    authorHostname: row.author_hostname as string,
    kind: (row.kind as Notice['kind']) ?? 'sticker',
    text: row.text as string,
    createdAt: row.created_at as number,
    replies,
    votes
  }
}

export async function list_notices(): Promise<Notice[]> {
  const { data, error } = await db()
    .from('notices')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(row_to_notice)
}

export async function create_reply(
  noticeId: string,
  authorDeviceId: string,
  authorHostname: string,
  text: string
): Promise<void> {
  const { data, error: fetchErr } = await db()
    .from('notices')
    .select('replies')
    .eq('id', noticeId)
    .single()
  if (fetchErr) throw fetchErr
  const replies = (data.replies as Reply[] ?? [])
  replies.push({ id: randomUUID(), authorDeviceId, authorHostname, text, createdAt: Date.now() })
  const { error } = await db().from('notices').update({ replies }).eq('id', noticeId)
  if (error) throw error
}

export async function create_notice(
  authorDeviceId: string,
  authorHostname: string,
  text: string,
  kind: Notice['kind'] = 'sticker'
): Promise<Notice> {
  const notice: Notice = {
    id: randomUUID(),
    authorDeviceId,
    authorHostname,
    kind,
    text,
    createdAt: Date.now(),
    replies: [],
    votes: []
  }
  const { error } = await db().from('notices').insert({
    id: notice.id,
    author_device_id: notice.authorDeviceId,
    author_hostname: notice.authorHostname,
    kind: notice.kind,
    text: notice.text,
    created_at: notice.createdAt
  })
  if (error) throw error
  return notice
}


type UserRow = { id: string; app_info: unknown; mac_addresses: string[] | null; device_id: string | null }

export async function upsert_user(
  hostname: string,
  macAddresses: string[],
  ip: string | null,
  deviceId: string
): Promise<AppInfo> {
  let existing: UserRow | null = null

  const { data: byDevice, error: deviceErr } = await db()
    .from('users')
    .select('id, app_info, mac_addresses, device_id')
    .eq('device_id', deviceId)
    .maybeSingle()
  if (deviceErr) throw deviceErr
  if (byDevice) {
    existing = byDevice as unknown as UserRow
  } else if (macAddresses.length > 0) {
    const { data: byMac, error: macErr } = await db()
      .from('users')
      .select('id, app_info, mac_addresses, device_id')
      .overlaps('mac_addresses', macAddresses)
      .maybeSingle()
    if (macErr) throw macErr
    if (byMac) existing = byMac as unknown as UserRow
  }

  const now = Date.now()

  if (existing) {
    const merged_macs = Array.from(new Set([...(existing.mac_addresses ?? []), ...macAddresses]))
    const update: Record<string, unknown> = {
      hostname,
      ip,
      is_online: true,
      last_seen: now,
      mac_addresses: merged_macs,
    }
    if (!existing.device_id || existing.device_id !== deviceId) update.device_id = deviceId
    const { error } = await db().from('users').update(update).eq('id', existing.id as string)
    if (error) throw error
    return (existing.app_info as AppInfo) ?? {}
  } else {
    const { error } = await db().from('users').insert({
      hostname,
      mac_addresses: macAddresses,
      ip,
      device_id: deviceId,
      is_online: true,
      app_info: {},
      last_seen: now,
      created_at: now
    })
    if (error) throw error
    return {}
  }
}

export async function update_app_info(deviceId: string, appInfo: AppInfo): Promise<void> {
  await db().from('users').update({ app_info: appInfo }).eq('device_id', deviceId)
}

export async function get_user_avatar(deviceId: string): Promise<string | null> {
  const { data } = await db().from('users').select('avatar').eq('device_id', deviceId).maybeSingle()
  return (data?.avatar as string | null) ?? null
}

export async function save_user_avatar(deviceId: string, avatar: string | null): Promise<void> {
  await db().from('users').update({ avatar }).eq('device_id', deviceId)
}

export interface UserProfile {
  deviceId: string
  hostname: string
  alias: string | null
  avatar: string | null
}

export async function list_users(): Promise<UserProfile[]> {
  const { data, error } = await db().from('users').select('device_id, hostname, app_info, avatar')
  if (error) throw error
  return (data ?? []).map((row) => ({
    deviceId: row.device_id as string,
    hostname: row.hostname as string,
    alias: (row.app_info as { alias?: string } | null)?.alias ?? null,
    avatar: row.avatar as string | null,
  }))
}

export async function update_notice(noticeId: string, text: string): Promise<void> {
  const { error } = await db().from('notices').update({ text }).eq('id', noticeId)
  if (error) throw error
}

export async function cast_vote(
  noticeId: string,
  deviceId: string,
  hostname: string,
  vote: 'yes' | 'no'
): Promise<void> {
  const { data, error: fetchErr } = await db().from('notices').select('votes').eq('id', noticeId).single()
  if (fetchErr) throw fetchErr
  const votes = ((data.votes as Record<string, unknown>[] ?? [])
    .filter((v) => v.device_id !== deviceId)) as Record<string, unknown>[]
  votes.push({ device_id: deviceId, hostname, vote, voted_at: Date.now() })
  const { error } = await db().from('notices').update({ votes }).eq('id', noticeId)
  if (error) throw error
}

export async function set_user_offline(macAddresses: string[], deviceId: string): Promise<void> {
  let id: string | null = null

  const { data: byDevice } = await db()
    .from('users')
    .select('id')
    .eq('device_id', deviceId)
    .maybeSingle()
  if (byDevice) {
    id = byDevice.id as string
  } else if (macAddresses.length > 0) {
    const { data: byMac } = await db()
      .from('users')
      .select('id')
      .overlaps('mac_addresses', macAddresses)
      .maybeSingle()
    if (byMac) id = byMac.id as string
  }

  if (!id) return
  await db().from('users').update({ is_online: false, last_seen: Date.now() }).eq('id', id)
}
