// src/health.ts
export interface HealthReport {
  uptimeMs: number
  plugins: Array<{ id: string; name?: string }>
  toolCount: number
  channels: Array<{ channel: string; ok: boolean; error?: string }>
  degraded: Array<{ id: string; error: string }>
  version: string
}
interface HealthDeps {
  startedAt?: number
  registry?: any
  tools?: { list?: () => unknown[] }
  connection?: { rpc?: { call: (channel: string, req: any, opts?: any) => Promise<any> } }
}
interface HealthOpts { channels?: string[]; timeoutMs?: number; version?: string; now?: number }

export async function buildHealthReport(deps: HealthDeps, opts: HealthOpts = {}): Promise<HealthReport> {
  const channels = opts.channels ?? ['/dsh-maestro-observe']
  const timeoutMs = opts.timeoutMs ?? 2000
  const now = opts.now ?? Date.now()
  const plugins: Array<{ id: string; name?: string }> = []
  try {
    const reg: any = deps.registry
    const set: any = reg?.plugins
    if (set instanceof Set) for (const id of set) plugins.push(typeof id === 'object' ? { id: String(id.id ?? ''), name: id.name } : { id: String(id) })
    else if (Array.isArray(set)) for (const id of set) plugins.push({ id: String(id) })
    else if (reg && typeof reg === 'object') for (const key of Object.keys(reg)) if (typeof reg[key] === 'object') plugins.push({ id: key })
  } catch { /* registry shape unknown */ }
  let toolCount = 0
  try { toolCount = deps.tools?.list?.()?.length ?? 0 } catch { /* no tools */ }
  // degraded: from registry.degraded Map or failed channels
  const degraded: Array<{ id: string; error: string }> = []
  try {
    const deg = (deps as any).registry?.degraded
    if (deg instanceof Map) {
      for (const [id, v] of deg) degraded.push({ id: String(id), error: String((v as any)?.error ?? v) })
    } else if (deg && typeof deg === 'object') {
      for (const [id, v] of Object.entries(deg)) degraded.push({ id, error: String((v as any)?.error ?? v) })
    }
  } catch {}
  const ping = async (channel: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res: any = await Promise.race([
        deps.connection?.rpc?.call(channel, { method: 'status' }) ?? Promise.resolve(null),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
      ])
      if (res === null) return { ok: false, error: 'no-rpc' }
      if (res?.ok) return { ok: true }
      return { ok: false, error: res?.error ?? 'rpc-error' }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'error' }
    }
  }
  const channelsResult = await Promise.all(channels.map(async (channel) => ({ channel, ...(await ping(channel)) })))
  // also treat failed channels as degraded
  for (const c of channelsResult) if (!c.ok) degraded.push({ id: c.channel, error: c.error ?? 'channel failed' })
  return { uptimeMs: now - (deps.startedAt ?? now), plugins, toolCount, channels: channelsResult, degraded, version: opts.version ?? '0.0.0' }
}
