import type { Context } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import z from 'schemastery'
import { ObserveStore } from './observe-store.js'
import { fromSessionEvent, fromTelemetryRecord } from './trace-record.js'
import { buildHealthReport } from './health.js'

export const MAESTRO_OBSERVE_CHANNEL = '/dsh-maestro-observe'
const CHANNELS = ['/dsh-maestro-remote', '/dsh-maestro-review', '/dsh-maestro-govard', '/dsh-maestro-memory', '/dsh-maestro-mobile', '/dsh-maestro-guard', MAESTRO_OBSERVE_CHANNEL]
export const VERSION: string = createRequire(import.meta.url)('../../package.json').version

export const toolSchema = z.object({
  op: z.union(['trace', 'health', 'cost']).required(),
  sessionId: z.string().required(false),
  limit: z.number().min(1).max(200).required(false).default(50),
  scope: z.union(['day', 'session']).required(false).default('day'),
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
      if (op === 'trace') return { ok: true, records: store.trace(input?.limit) }
      if (op === 'cost') {
        const scope = input?.scope ?? 'day'
        if (scope === 'session' && !input?.sessionId) return { ok: false, error: 'sessionId required' }
        const cost = scope === 'session'
          ? store.cost('session', input?.sessionId ?? '')
          : store.cost('day')
        return { ok: true, cost }
      }
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
            if (method === 'trace') return { ok: true, records: store.trace(req?.limit) }
            if (method === 'cost') {
              const scope = req?.scope ?? 'day'
              if (scope === 'session' && !req?.sessionId) return { ok: false, error: 'sessionId required' }
              return { ok: true, cost: scope === 'session' ? store.cost('session', req?.sessionId ?? '') : store.cost('day') }
            }
            if (method === 'health') return { ok: true, health: await buildHealthReport(ctx as any, { channels: CHANNELS, version: VERSION }) }
            return { ok: false, error: 'unknown method' }
          },
          { authority: 'loopback' },
        ),
      )
    },
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
