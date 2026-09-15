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
  bootTs?: number
  registry?: any
  tools?: { list?: () => unknown[] }
  connection?: { rpc?: { call: (channel: string, req: any, opts?: any) => Promise<any> } }
}
interface HealthOpts {
  channels?: string[]
  listChannels?: () => string[]
  timeoutMs?: number
  version?: string
  now?: number
}

export async function buildHealthReport(deps: HealthDeps, opts: HealthOpts = {}): Promise<HealthReport> {
  const channels = opts.channels ?? opts.listChannels?.() ?? ['/dsh-maestro-observe']
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
  // degraded: from registry.degraded Map or failed channels, deduped by id
  const degradedById = new Map<string, string>()
  try {
    const deg = (deps as any).registry?.degraded
    const entries: Array<[string, any]> = deg instanceof Map
      ? [...deg.entries()]
      : deg && typeof deg === 'object' ? Object.entries(deg) : []
    for (const [id, v] of entries) {
      const key = String(id)
      if (!degradedById.has(key)) degradedById.set(key, String((v as any)?.error ?? v))
    }
  } catch {}
  const ping = async (channel: string): Promise<{ ok: boolean; error?: string }> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const res: any = await Promise.race([
        deps.connection?.rpc?.call(channel, { method: 'status' }) ?? Promise.resolve(null),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), timeoutMs) }),
      ])
      if (res === null) return { ok: false, error: 'no-rpc' }
      if (res?.ok) return { ok: true }
      return { ok: false, error: res?.error ?? 'rpc-error' }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'error' }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
  const channelsResult = await Promise.all(channels.map(async (channel) => ({ channel, ...(await ping(channel)) })))
  // also treat failed channels as degraded (first error wins per id)
  for (const c of channelsResult) {
    if (!c.ok && !degradedById.has(c.channel)) degradedById.set(c.channel, c.error ?? 'channel failed')
  }
  const bootTs = typeof deps.bootTs === 'number' ? deps.bootTs : (deps.startedAt ?? now)
  return {
    uptimeMs: now - bootTs,
    plugins,
    toolCount,
    channels: channelsResult,
    degraded: [...degradedById.entries()].map(([id, error]) => ({ id, error })),
    version: opts.version ?? '0.0.0',
  }
}
