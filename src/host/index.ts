import type { Context } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import z from 'schemastery'
import { ObserveStore } from './observe-store.js'
import { fromSessionEvent, fromTelemetryRecord } from './trace-record.js'
import { buildDigestText, type DigestSnapshot, type NotifierLike } from './digest.js'
import { buildHealthReport } from './health.js'

export const MAESTRO_OBSERVE_CHANNEL = '/dsh-maestro-observe'
const CHANNELS = ['/dsh-maestro-remote', '/dsh-maestro-review', '/dsh-maestro-govard', '/dsh-maestro-memory', '/dsh-maestro-mobile', '/dsh-maestro-guard', MAESTRO_OBSERVE_CHANNEL]
export const VERSION: string = createRequire(import.meta.url)('../../package.json').version

export const toolSchema = z.object({
  op: z.union(['trace', 'health', 'cost', 'budget', 'config', 'errors', 'latency']).required(),
  sessionId: z.string().required(false),
  limit: z.number().min(1).max(200).required(false).default(50),
  scope: z.union(['day', 'session']).required(false).default('day'),
  groupBy: z.union(['tool', 'session']).required(false),
  action: z.string().required(false),
  key: z.string().required(false),
  limit_tokens: z.number().min(1).required(false),
  value: z.string().required(false),
  tool: z.string().required(false),
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
    schema: toolSchema,
    async execute(input: any) {
      const op = input?.op
      if (op === 'trace') return { ok: true, records: store.trace(input?.limit ?? 50) }
      if (op === 'cost') {
        const scope = input?.scope ?? 'day'
        if (input?.groupBy === 'tool' || input?.groupBy === 'session') {
          return { ok: true, groups: store.costGrouped(input.groupBy, input?.since) }
        }
        if (scope === 'session' && !input?.sessionId) return { ok: false, error: 'sessionId required' }
        const cost = scope === 'session'
          ? store.cost('session', input?.sessionId ?? '')
          : store.cost('day')
        return { ok: true, cost }
      }
      if (op === 'budget') return handleBudget(store, input)
      if (op === 'config') return handleConfig(store, input)
      if (op === 'errors') return { ok: true, groups: store.errorsGrouped(input?.tool, input?.since) }
      if (op === 'latency') return { ok: true, latency: store.latencyPercentiles(input?.tool, input?.since) }
      if (op === 'health') return { ok: true, health: await buildHealthReport(resolveDeps(), { channels: CHANNELS, version: VERSION }) }
      return { ok: false, error: 'unknown op' }
    },
  }

  return {
    tool,
    apply(ctx: Context) {
      ctxRef = ctx
      // Session events → trace
      ctx.effect(() =>
        ctx.on('session/event', (payload: any) => {
          try {
            const r = fromSessionEvent(payload)
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
          return next(record)
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
              store.configSet('last_digest_day', todayLocal)
              void runDigestOnce(ctx as any, store, Date.now())
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
          async (req: any) => {
            const method = req?.method
            if (method === 'status')
              return {
                ok: true,
                uptimeMs: Date.now() - ((ctx as any).startedAt ?? Date.now()),
                version: VERSION,
                ringSize: store.ringSize,
                historyLines: await store.historyLines(),
              }
            if (method === 'trace') return { ok: true, records: store.trace(req?.limit ?? 50) }
            if (method === 'cost') {
              const scope = req?.scope ?? 'day'
              if (req?.groupBy === 'tool' || req?.groupBy === 'session') {
                return { ok: true, groups: store.costGrouped(req.groupBy, req?.since) }
              }
              if (scope === 'session' && !req?.sessionId) return { ok: false, error: 'sessionId required' }
              return { ok: true, cost: scope === 'session' ? store.cost('session', req?.sessionId ?? '') : store.cost('day') }
            }
            if (method === 'budget') return handleBudget(store, req)
            if (method === 'config') return handleConfig(store, req)
            if (method === 'errors') return { ok: true, groups: store.errorsGrouped(req?.tool, req?.since) }
            if (method === 'latency') return { ok: true, latency: store.latencyPercentiles(req?.tool, req?.since) }
            if (method === 'health') return { ok: true, health: await buildHealthReport(ctx as any, { channels: CHANNELS, version: VERSION }) }
            return { ok: false, error: 'unknown method' }
          },
          { authority: 'loopback' },
        ),
      )
    },
  }
}

function handleBudget(store: ObserveStore, input: any) {
  const action = input?.action
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

function startOfDayLocal(nowMs: number): number {
  const d = new Date(nowMs)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
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
  const notifier = ctxLike.get?.('maestroNotifier') as NotifierLike | undefined
  if (!notifier || typeof notifier.send !== 'function') {
    ctxLike.logger?.warn?.('observe: digest skipped, no maestroNotifier')
    return { sent: false, reason: 'no-notifier' }
  }
  try {
    const ids = typeof notifier.ids === 'function' ? notifier.ids() : ['telegram']
    if (!ids.includes('telegram')) return { sent: false, reason: 'no-telegram-provider' }
    const botToken = store.configGet('telegram.botToken')
    const chatId = store.configGet('telegram.chatId')
    if (!botToken || !chatId) return { sent: false, reason: 'no-target' }
    const dayStart = startOfDayLocal(nowMs)
    const snapshot: DigestSnapshot = {
      day: store.cost('day'),
      topTools: topByTotal(store.costGrouped('tool', dayStart), 5),
      topSessions: topByTotal(store.costGrouped('session', dayStart), 5),
      overBudget: store.listBudgets()
        .filter((b) => (b.scope === 'day' || b.scope === 'session') && store.budgetCheck(b.scope, b.key).over)
        .map((b) => `${b.scope}:${b.key}`),
      errorCount: store.errorCountSince(dayStart),
    }
    const res = await notifier.send('telegram', { botToken, chatId }, { text: buildDigestText(snapshot) })
    return res?.sent ? { sent: true } : { sent: false, reason: 'send-failed' }
  } catch (e: any) {
    ctxLike.logger?.warn?.('observe: digest failed', e?.message)
    return { sent: false, reason: 'send-failed' }
  }
}

export default {
  inject: ['tools'] as const,
  async apply(ctx: Context) {
    const store = new ObserveStore()
    await store.load()
    return createObservePlugin(store, () => ctx).apply(ctx)
  },
}
