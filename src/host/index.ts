import type { Context } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import z from 'schemastery'
import { ObserveStore } from './observe-store.js'
import { fromSessionEvent, fromTelemetryRecord } from './trace-record.js'
import { buildDigestText, type DigestSnapshot, type NotifierLike } from './digest.js'
import { purgeOld } from './retention.js'
import { buildHealthReport } from './health.js'

export const MAESTRO_OBSERVE_CHANNEL = '/dsh-maestro-observe'
const CHANNELS = ['/dsh-maestro-remote', '/dsh-maestro-review', '/dsh-maestro-govard', '/dsh-maestro-memory', '/dsh-maestro-mobile', '/dsh-maestro-guard', MAESTRO_OBSERVE_CHANNEL]
// src/host/index.ts runs two levels below the root, lib/index.js one level:
// try both so VERSION resolves under vitest (src) and in production (lib).
function readVersion(): string {
  const req = createRequire(import.meta.url)
  for (const p of ['../package.json', '../../package.json']) {
    try {
      const v = req(p)?.version
      if (typeof v === 'string' && v.length > 0) return v
    } catch { /* try next */ }
  }
  return '0.0.0'
}
export const VERSION: string = readVersion()

export const toolSchema = z.object({
  op: z.union(['trace', 'health', 'cost', 'budget', 'config', 'errors', 'latency']).required(),
  sessionId: z.string().required(false),
  limit: z.number().min(1).max(200).required(false).default(50),
  scope: z.union(['day', 'session']).required(false).default('day'),
  groupBy: z.union(['tool', 'session']).required(false),
  day: z.string().required(false),
  action: z.string().required(false),
  key: z.string().required(false),
  limit_tokens: z.number().min(1).required(false),
  value: z.string().required(false),
  tool: z.string().required(false),
  kind: z.union(['turn', 'step', 'tool', 'error']).required(false),
  since: z.number().required(false),
})

export function createObservePlugin(
  store: ObserveStore,
  opts?: { getHealthDeps?: () => any } | (() => any),
) {
  let ctxRef: any = null
  const resolveDeps = (): any => {
    if (typeof opts === 'function') return (opts as () => any)()
    if (opts && typeof opts === 'object' && 'getHealthDeps' in opts && typeof (opts as any).getHealthDeps === 'function') {
      return (opts as any).getHealthDeps()
    }
    return ctxRef ?? {}
  }

  const tool = {
    name: 'maestro-observe',
    description: 'Maestro observe — trace, health and cost snapshots for debugging the Maestro plugin stack.',
    // Plain JSON Schema for the harness registry (mirrors toolSchema above,
    // which remains the documented input contract + unit-test surface).
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['op'],
      properties: {
        op: { type: 'string', enum: ['trace', 'health', 'cost', 'budget', 'config', 'errors', 'latency'] },
        sessionId: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 200 },
        scope: { type: 'string', enum: ['day', 'session'] },
        groupBy: { type: 'string', enum: ['tool', 'session'] },
        day: { type: 'string' },
        action: { type: 'string' },
        key: { type: 'string' },
        limit_tokens: { type: 'number', minimum: 1 },
        value: { type: 'string' },
        tool: { type: 'string' },
        kind: { type: 'string', enum: ['turn', 'step', 'tool', 'error'] },
        since: { type: 'number' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (args: any, value: any) => [{ type: 'text', text: renderResult(args?.op, value) }],
    },
    async execute(input: any) {
      const op = input?.op
      if (op === 'trace') {
        const filter = {
          sessionId: input?.sessionId,
          tool: input?.tool,
          kind: input?.kind,
          since: input?.since,
        }
        return { ok: true, records: store.trace(input?.limit ?? 50, filter) }
      }
      if (op === 'cost') {
        const scope = input?.scope ?? 'day'
        if (input?.groupBy === 'tool' || input?.groupBy === 'session') {
          return { ok: true, groups: store.costGrouped(input.groupBy, input?.since) }
        }
        if (scope === 'session' && !input?.sessionId) return { ok: false, error: 'sessionId required' }
        const cost = scope === 'session'
          ? store.cost('session', input?.sessionId ?? '')
          : store.cost('day', input?.day)
        return { ok: true, cost }
      }
      if (op === 'budget') return handleBudget(store, input)
      if (op === 'config') return handleConfig(store, input)
      if (op === 'errors') return { ok: true, groups: store.errorsGrouped(input?.tool, input?.since) }
      if (op === 'latency') return { ok: true, latency: store.latencyPercentiles(input?.tool, input?.since) }
      if (op === 'health') return { ok: true, health: await buildHealthReport(resolveDeps(), { listChannels: () => discoverChannels(resolveDeps()), version: VERSION }) }
      return { ok: false, error: 'unknown op' }
    },
  }

  return {
    tool,
    apply(ctx: Context) {
      ctxRef = ctx
      // Session events → trace. Real signature is (session, event) with
      // SessionEvent = { type, seq, time, data } — the event arg carries
      // kind/tokens, not the session.
      ctx.effect(() =>
        ctx.on('session/event', (session: any, event: any) => {
          try {
            const r = fromSessionEvent(session, event)
            if (r) void store.push(r)
          } catch (e: any) {
            ;(ctx as any).logger?.warn?.('observe: session event skipped', e?.message)
          }
        }),
      )
      // Telemetry error waterfall
      ctx.effect(() =>
        ctx.on('session-telemetry/record', (record: any, next: any) => {
          try {
            const r = fromTelemetryRecord(record)
            if (r) void store.push(r)
          } catch (e: any) {
            ;(ctx as any).logger?.warn?.('observe: telemetry skipped', e?.message)
          }
          if (typeof next === 'function') return next(record)
          return undefined
        }),
      )
      ctx.effect(() => (ctx as any).tools.register(tool))
      // Daily Telegram digest (quiet when maestroNotifier is absent)
      ctx.effect(() => {
        const id = setInterval(() => {
          try {
            const schedule = store.configGet('digest_schedule') ?? '08:00'
            const d = new Date()
            const pad = (n: number): string => String(n).padStart(2, '0')
            const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
            const todayLocal = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
            if (hhmm === schedule && store.configGet('last_digest_day') !== todayLocal) {
              // Stamp only after a successful send so a failed day retries next tick.
              void runDigestOnce(ctx as any, store, Date.now())
                .then((res) => { if (res.sent) store.configSet('last_digest_day', todayLocal) })
                .catch((e: any) => (ctx as any).logger?.warn?.('observe: digest failed', e?.message))
            }
            void runSpikeCheck(ctx as any, store, Date.now())
            if (store.configGet('last_retention_day') !== todayLocal) {
              store.configSet('last_retention_day', todayLocal)
              const days = Number(store.configGet('retention_days') ?? '30')
              void purgeOld(store, Date.now(), days).catch((e: any) =>
                (ctx as any).logger?.warn?.('observe: retention purge failed', e?.message))
            }
          } catch (e: any) {
            ;(ctx as any).logger?.warn?.('observe: digest tick failed', e?.message)
          }
        }, 60_000)
        const t = id as unknown as { unref?: () => void }
        if (typeof t.unref === 'function') t.unref()
        return () => clearInterval(id)
      })
      ctx.effect(() =>
        (ctx as any).connection.rpc.handle(
          MAESTRO_OBSERVE_CHANNEL,
          async (endpoint: string, payload: any) => handleRpc(store, ctx as any, String(endpoint), payload ?? {}),
          { authority: 'loopback' },
        ),
      )
    },
  }
}

// ---------------------------------------------------------------------------
// RPC endpoint dispatch for /dsh-maestro-observe (loopback authority).
// The Connection transport requires the carrier shape
// ({ ok: true, value } | { ok: false, error: { code, message, details } }) —
// serverResponseSchema rejects anything else, which makes clients silently
// fail. Mirrors dsh-maestro-jobs/src/host/rpc.ts.
// ---------------------------------------------------------------------------
export type RpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details: object } }

export function rpcOk<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}

export function rpcFail(message: string, endpoint: string): RpcResult<never> {
  return { ok: false, error: { code: `maestro-observe/${endpoint}`, message, details: {} } }
}

export async function handleRpc(store: ObserveStore, ctx: any, endpoint: string, payload: any): Promise<RpcResult<any>> {
  const p = payload ?? {}
  switch (endpoint) {
    case 'status':
      return rpcOk({
        uptimeMs: Date.now() - (ctx?.startedAt ?? Date.now()),
        version: VERSION,
        ringSize: store.ringSize,
        historyLines: await store.historyLines(),
      })
    case 'trace':
      return rpcOk({
        records: store.trace(p.limit ?? 50, {
          sessionId: p.sessionId,
          tool: p.tool,
          kind: p.kind,
          since: p.since,
        }),
      })
    case 'cost': {
      const scope = p.scope ?? 'day'
      if (p.groupBy === 'tool' || p.groupBy === 'session') {
        return rpcOk({ groups: store.costGrouped(p.groupBy, p.since) })
      }
      if (scope === 'session' && !p.sessionId) return rpcFail('sessionId required', endpoint)
      return rpcOk({ cost: scope === 'session' ? store.cost('session', p.sessionId ?? '') : store.cost('day', p.day) })
    }
    case 'budget':
    case 'config': {
      const inner = endpoint === 'budget' ? handleBudget(store, p) : handleConfig(store, p)
      if (!inner.ok) return rpcFail(typeof inner.error === 'string' ? inner.error : 'invalid request', endpoint)
      const { ok: _ok, ...value } = inner
      return rpcOk(value)
    }
    case 'errors':
      return rpcOk({ groups: store.errorsGrouped(p.tool, p.since) })
    case 'latency':
      return rpcOk({ latency: store.latencyPercentiles(p.tool, p.since) })
    case 'health':
      return rpcOk({ health: await buildHealthReport(ctx as any, { listChannels: () => discoverChannels(ctx as any), version: VERSION }) })
    default:
      return rpcFail('unknown endpoint', endpoint)
  }
}

function renderResult(op: string, value: any): string {
  if (!value?.ok) return `observe ${op ?? '?'} failed: ${value?.error ?? 'unknown error'}`
  if (op === 'trace') return `observe trace: ${value.records?.length ?? 0} records`
  if (op === 'cost') {
    if (value.groups) return `observe cost groups: ${value.groups.length}`
    const c = value.cost ?? {}
    return `observe cost: ${c.turns ?? 0} turns · ${(c.inputTokens ?? 0) + (c.outputTokens ?? 0)} tokens`
  }
  if (op === 'budget') return value.budget ? `observe budget: ${value.budget.spent}/${value.budget.limit}${value.budget.over ? ' OVER' : ''}` : 'observe budget updated'
  if (op === 'config') return 'value' in value ? `observe config: ${String(value.value)}` : 'observe config updated'
  if (op === 'errors') return `observe errors: ${value.groups?.length ?? 0} groups`
  if (op === 'latency') {
    const l = value.latency ?? {}
    return `observe latency: n=${l.count ?? 0} p50=${l.p50 ?? 0}ms p95=${l.p95 ?? 0}ms`
  }
  if (op === 'health') {
    const h = value.health ?? {}
    return `observe health: ${h.toolCount ?? 0} tools · ${h.plugins?.length ?? 0} plugins · degraded ${h.degraded?.length ?? 0}`
  }
  return `observe ${op}: ok`
}

function handleBudget(store: ObserveStore, input: any) {  const action = input?.action
  const scope = input?.scope ?? 'day'
  if (scope !== 'day' && scope !== 'session') return { ok: false, error: 'scope must be day|session' }
  if (action === 'set') {
    if (!input?.key) return { ok: false, error: 'key required' }
    if (typeof input?.limit_tokens !== 'number') return { ok: false, error: 'limit_tokens required' }
    store.budgetSet(scope, input.key, input.limit_tokens)
    return { ok: true }
  }
  if (action === 'check') {
    if (!input?.key) return { ok: false, error: 'key required' }
    return { ok: true, budget: store.budgetCheck(scope, input.key) }
  }
  return { ok: false, error: 'action must be set|check' }
}

function handleConfig(store: ObserveStore, input: any) {
  const action = input?.action
  if (action === 'set') {
    if (!input?.key) return { ok: false, error: 'key required' }
    if (typeof input?.value !== 'string') return { ok: false, error: 'value required' }
    store.configSet(input.key, input.value)
    return { ok: true }
  }
  if (action === 'get') {
    if (!input?.key) return { ok: false, error: 'key required' }
    return { ok: true, value: store.configGet(input.key) }
  }
  return { ok: false, error: 'action must be get|set' }
}

function startOfDayUTC(nowMs: number): number {
  const d = new Date(nowMs)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function totalOf(a: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }): number {
  return a.inputTokens + a.outputTokens + a.cacheReadTokens + a.cacheWriteTokens
}

function topByTotal(groups: Array<{ key: string; agg: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; turns: number } }>, n: number) {
  return [...groups].sort((a, b) => totalOf(b.agg) - totalOf(a.agg)).slice(0, n)
}

export async function runDigestOnce(
  ctxLike: { get?: (name: string) => unknown; logger?: { warn?: (...a: any[]) => void } },
  store: ObserveStore,
  nowMs: number = Date.now(),
): Promise<{ sent: boolean; reason?: string }> {
  const resolved = resolveNotifierTarget(ctxLike, store)
  if (!('notifier' in resolved)) {
    // Quiet skip: warn at most once per local day so an unconfigured
    // telegram doesn't log ~1440 times/day from the 60s tick.
    const d = new Date(nowMs)
    const pad = (n: number): string => String(n).padStart(2, '0')
    const todayLocal = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    if (store.configGet('last_digest_skip_day') !== todayLocal) {
      store.configSet('last_digest_skip_day', todayLocal)
      ctxLike.logger?.warn?.(`observe: digest skipped (${resolved.reason})`)
    }
    return { sent: false, reason: resolved.reason }
  }
  try {
    // Day windows are UTC midnights, matching cost('day') buckets; the fire
    // time (digest_schedule) is still local HH:MM. The morning tick fires at
    // ~01:00 UTC, so "today" is always partial — carry the previous full UTC
    // day alongside it for context.
    const dayStart = startOfDayUTC(nowMs)
    const dayLabel = new Date(dayStart).toISOString().slice(0, 10)
    const prevLabel = new Date(dayStart - 86_400_000).toISOString().slice(0, 10)
    const toolAgg = new Map(store.costGrouped('tool', dayStart).map((g) => [g.key, g.agg]))
    const zeroAgg = (): { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; turns: number } =>
      ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, turns: 0 })
    const latency = store.latencyPercentiles(undefined, dayStart)
    const snapshot: DigestSnapshot = {
      dayLabel,
      day: store.cost('day'),
      prevDay: { label: prevLabel, agg: store.cost('day', prevLabel) },
      // Token sums on tool-kind rows are always zero (tokens ride on
      // turn/step rows with tool unset), so rank tools by call count.
      topTools: store.toolCallCounts(dayStart).slice(0, 5).map((r) => ({ key: r.tool, calls: r.count, agg: toolAgg.get(r.tool) ?? zeroAgg() })),
      topSessions: topByTotal(store.costGrouped('session', dayStart), 5),
      topErrors: store.errorsGrouped(undefined, dayStart).slice(0, 5).map((g) => ({ tool: g.tool, signature: g.signature, count: g.count })),
      latency: { count: latency.count, p50: latency.p50, p95: latency.p95 },
      budgets: store.listBudgets().map((b) => {
        const c = store.budgetCheck(b.scope as 'day' | 'session', b.key)
        return { scope: b.scope, key: b.key, spent: c.spent, limit: c.limit, over: c.over }
      }),
      errorCount: store.errorCountSince(dayStart),
    }
    const res = await resolved.notifier.send('telegram', resolved.target, { text: buildDigestText(snapshot) })
    return res?.sent ? { sent: true } : { sent: false, reason: 'send-failed' }
  } catch (e: any) {
    ctxLike.logger?.warn?.('observe: digest failed', e?.message)
    return { sent: false, reason: 'send-failed' }
  }
}

function resolveNotifierTarget(
  ctxLike: { get?: (name: string) => unknown },
  store: ObserveStore,
): { notifier: NotifierLike; target: { botToken: string; chatId: string } } | { reason: string } {
  const notifier = ctxLike.get?.('maestroNotifier') as NotifierLike | undefined
  if (!notifier || typeof notifier.send !== 'function') return { reason: 'no-notifier' }
  const ids = typeof notifier.ids === 'function' ? notifier.ids() : ['telegram']
  if (!ids.includes('telegram')) return { reason: 'no-telegram-provider' }
  const botToken = store.configGet('telegram.botToken')
  const chatId = store.configGet('telegram.chatId')
  if (!botToken || !chatId) return { reason: 'no-target' }
  return { notifier, target: { botToken, chatId } }
}

export async function runSpikeCheck(
  ctxLike: { get?: (name: string) => unknown; logger?: { warn?: (...a: any[]) => void } },
  store: ObserveStore,
  nowMs: number = Date.now(),
): Promise<{ alerted: boolean }> {
  try {
    const n = Number(store.configGet('spike_n') ?? '10')
    const m = Number(store.configGet('spike_m') ?? '5')
    if (!Number.isFinite(n) || !Number.isFinite(m) || n <= 0 || m <= 0) return { alerted: false }
    const windowMs = m * 60_000
    if (store.errorCountSince(nowMs - windowMs) < n) return { alerted: false }
    const lastAlert = Number(store.configGet('last_spike_alert_ts') ?? '0')
    if (Number.isFinite(lastAlert) && nowMs - lastAlert < windowMs) return { alerted: false }
    const resolved = resolveNotifierTarget(ctxLike, store)
    if (!('notifier' in resolved)) return { alerted: false }
    const res = await resolved.notifier.send(
      'telegram', resolved.target,
      { text: `Observe alert: ${store.errorCountSince(nowMs - windowMs)} errors in last ${m} minute(s)` },
    )
    if (res?.sent) store.configSet('last_spike_alert_ts', String(nowMs))
    return { alerted: res?.sent === true }
  } catch (e: any) {
    ctxLike.logger?.warn?.('observe: spike check failed', e?.message)
    return { alerted: false }
  }
}

function discoverChannels(deps: any): string[] {
  try {
    const set = deps?.registry?.plugins
    const ids: string[] = set instanceof Set
      ? [...set].map((p: any) => (typeof p === 'object' && p !== null ? String(p.id ?? '') : String(p)))
      : []
    const chans = ids.filter(Boolean).map((id) => (id.startsWith('/') ? id : `/${id}`))
    if (chans.length > 0) return chans
  } catch { /* fall through to legacy list */ }
  return CHANNELS
}

export default {
  inject: ['tools'] as const,
  async apply(ctx: Context) {
    const store = new ObserveStore()
    await store.load()
    // NOTE: never stash values on ctx (Cordis throws "cannot set property
    // without provide" and fails the whole tree boot). Health uptime reads
    // deps.bootTs (explicit callers) or deps.startedAt (the live ctx).
    return createObservePlugin(store, () => ctx).apply(ctx)
  },
}
