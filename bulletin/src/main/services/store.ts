import { randomUUID } from 'crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import ws from 'ws'

export interface Reply {
  id: string
  userId: string
  text: string
  createdAt: number
}

export interface Vote {
  userId: string
  vote: 'yes' | 'no'
  votedAt: number
}

export interface Notice {
  id: string
  userId: string
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
    userId: r.user_id as string,
    text: r.text as string,
    createdAt: r.created_at as number,
  }))
  const votes = (row.votes as Record<string, unknown>[] ?? []).map((v) => ({
    userId: v.user_id as string,
    vote: v.vote as 'yes' | 'no',
    votedAt: v.voted_at as number,
  }))
  return {
    id: row.id as string,
    userId: row.user_id as string,
    kind: (row.kind as Notice['kind']) ?? 'sticker',
    text: row.text as string,
    createdAt: row.created_at as number,
    replies,
    votes,
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

export async function create_notice(
  userId: string,
  text: string,
  kind: Notice['kind'] = 'sticker'
): Promise<Notice> {
  const notice: Notice = {
    id: randomUUID(),
    userId,
    kind,
    text,
    createdAt: Date.now(),
    replies: [],
    votes: [],
  }
  const { error } = await db().from('notices').insert({
    id: notice.id,
    user_id: notice.userId,
    kind: notice.kind,
    text: notice.text,
    created_at: notice.createdAt,
  })
  if (error) throw error
  return notice
}

export async function create_reply(
  noticeId: string,
  userId: string,
  text: string
): Promise<void> {
  const { data, error: fetchErr } = await db()
    .from('notices')
    .select('replies')
    .eq('id', noticeId)
    .single()
  if (fetchErr) throw fetchErr
  const replies = (data.replies as Record<string, unknown>[] ?? [])
  replies.push({ id: randomUUID(), user_id: userId, text, created_at: Date.now() })
  const { error } = await db().from('notices').update({ replies }).eq('id', noticeId)
  if (error) throw error
}

export async function update_notice(noticeId: string, text: string): Promise<void> {
  const { error } = await db().from('notices').update({ text }).eq('id', noticeId)
  if (error) throw error
}

export async function cast_vote(
  noticeId: string,
  userId: string,
  vote: 'yes' | 'no'
): Promise<void> {
  const { data, error: fetchErr } = await db().from('notices').select('votes').eq('id', noticeId).single()
  if (fetchErr) throw fetchErr
  const votes = ((data.votes as Record<string, unknown>[] ?? [])
    .filter((v) => v.user_id !== userId)) as Record<string, unknown>[]
  votes.push({ user_id: userId, vote, voted_at: Date.now() })
  const { error } = await db().from('notices').update({ votes }).eq('id', noticeId)
  if (error) throw error
}

type UserRow = { id: string; app_info: unknown; alias: string | null; mac_addresses: string[] | null; device_id: string | null }

export async function upsert_user(
  hostname: string,
  macAddresses: string[],
  ip: string | null,
  deviceId: string
): Promise<{ appInfo: AppInfo; alias: string | null; canonicalId: string }> {
  const now = Date.now()

  // device_id 또는 MAC 중 하나라도 일치하면 같은 사용자
  let existing: UserRow | null = null
  const { data: byDevice } = await db()
    .from('users')
    .select('id, app_info, alias, mac_addresses, device_id')
    .eq('device_id', deviceId)
    .maybeSingle()
  if (byDevice) {
    existing = byDevice as unknown as UserRow
  } else if (macAddresses.length > 0) {
    const { data: byMac } = await db()
      .from('users')
      .select('id, app_info, alias, mac_addresses, device_id')
      .overlaps('mac_addresses', macAddresses)
      .maybeSingle()
    if (byMac) existing = byMac as unknown as UserRow
  }

  if (existing) {
    const canonicalId = existing.id as string
    await db().from('users').update({
      hostname, ip, is_online: true, last_seen: now,
    }).eq('id', existing.id as string)
    return { appInfo: (existing.app_info as AppInfo) ?? {}, alias: existing.alias as string | null, canonicalId }
  } else {
    const { data, error } = await db().from('users').insert({
      hostname, mac_addresses: macAddresses, ip, device_id: deviceId,
      is_online: true, app_info: {}, last_seen: now, created_at: now,
    }).select('id').single()
    if (error) throw error
    return { appInfo: {}, alias: null, canonicalId: (data as { id: string }).id }
  }
}

export async function update_app_info(deviceId: string, appInfo: AppInfo): Promise<void> {
  await db().from('users').update({ app_info: appInfo }).eq('device_id', deviceId)
}

export async function save_user_alias(deviceId: string, alias: string | null): Promise<void> {
  await db().from('users').update({ alias }).eq('device_id', deviceId)
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
  isOnline?: boolean
}

export async function list_users(): Promise<UserProfile[]> {
  const { data, error } = await db().from('users').select('device_id, hostname, alias, avatar, is_online')
  if (error) throw error
  return (data ?? []).map((row) => ({
    deviceId: row.device_id as string,
    hostname: row.hostname as string,
    alias: row.alias as string | null,
    avatar: row.avatar as string | null,
    isOnline: (row.is_online as boolean) ?? false,
  }))
}

export interface ChatMessage {
  id: string
  userId: string
  text: string
  createdAt: number
  readBy: string[]
}

export async function list_messages(): Promise<ChatMessage[]> {
  const week_ago = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await db()
    .from('chat_messages')
    .select('*')
    .gte('created_at', week_ago)
    .order('created_at', { ascending: true })
  if (error) throw error
  void db().from('chat_messages').delete().lt('created_at', week_ago)
  return (data ?? []).map((row) => ({
    id: row.id as string,
    userId: row.user_id as string,
    text: row.text as string,
    createdAt: new Date(row.created_at as string).getTime(),
    readBy: (row.read_by as string[]) ?? [],
  }))
}

export async function send_message(userId: string, text: string): Promise<void> {
  const { error } = await db().from('chat_messages').insert({
    user_id: userId,
    text,
    read_by: [userId],
  })
  if (error) throw error
}

export async function delete_message(id: string, userId: string): Promise<void> {
  const { error } = await db()
    .from('chat_messages')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw error
}

export async function has_unread(userId: string): Promise<boolean> {
  const { data } = await db()
    .from('chat_messages')
    .select('id')
    .not('read_by', 'cs', `{"${userId}"}`)
    .limit(1)
  return (data?.length ?? 0) > 0
}

export async function add_reader(userId: string): Promise<void> {
  const { data } = await db()
    .from('chat_messages')
    .select('id, read_by')
    .not('read_by', 'cs', `{"${userId}"}`)
    .neq('user_id', userId)
  if (!data || data.length === 0) return
  await Promise.all(
    data.map(msg =>
      db()
        .from('chat_messages')
        .update({ read_by: [...(msg.read_by as string[]), userId] })
        .eq('id', msg.id)
    )
  )
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
