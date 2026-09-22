// Regression: the health path must never read a property off the Cordis
// context proxy. Cordis throws `cannot get property "<x>" without inject` for
// any key that is not a real service, so handing the proxy to
// `buildHealthReport` as `deps` broke the whole health op.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ObserveStore } from '../src/host/observe-store.js'
import { createObservePlugin, MAESTRO_OBSERVE_CHANNEL } from '../src/host/index.js'

/**
 * Minimal stand-in for the real Cordis context proxy: declared services answer,
 * any other property read throws the same error the live host produced.
 */
function cordisLikeCtx(services: Record<string, unknown>) {
  const declared: Record<string, unknown> = {
    effect: (fn: () => unknown) => fn(),
    on: () => () => true,
    get: (name: string) => services[name],
    ...services,
  }
  return new Proxy(declared, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in target) return Reflect.get(target, prop)
      throw new Error(`cannot get property "${String(prop)}" without inject`)
    },
  })
}

describe('observe health on a Cordis-like context', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'obs-ctx-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function ctxWithTools(tools: any[] = []) {
    return cordisLikeCtx({
      tools: { register: (t: any) => { tools.push(t); return () => {} }, list: () => tools.map((t) => t.name) },
      connection: { rpc: { handle: () => () => true, call: async () => ({ ok: true }) } },
      logger: { warn: () => {} },
    })
  }

  it('tool health reports ok without touching an undeclared ctx property', async () => {
    const store = new ObserveStore(dir)
    const tools: any[] = []
    const plugin = createObservePlugin(store)
    await plugin.apply(ctxWithTools(tools) as any)

    const res: any = await plugin.tool.execute({ op: 'health' })
    expect(res.ok).toBe(true)
    expect(res.health).toBeTruthy()
    expect(typeof res.health.uptimeMs).toBe('number')
    expect(res.health.uptimeMs).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(res.health.channels)).toBe(true)
  })

  it('rpc health reports ok without touching an undeclared ctx property', async () => {
    const store = new ObserveStore(dir)
    const rpcHandlers = new Map<string, (endpoint: string, payload: any) => Promise<any>>()
    const ctx = cordisLikeCtx({
      tools: { register: () => () => {}, list: () => [] },
      connection: { rpc: { handle: (ch: string, h: any) => { rpcHandlers.set(ch, h); return () => true } } },
      logger: { warn: () => {} },
    })
    const plugin = createObservePlugin(store)
    await plugin.apply(ctx as any)

    const res: any = await rpcHandlers.get(MAESTRO_OBSERVE_CHANNEL)!('health', {})
    expect(res.ok).toBe(true)
    expect(res.value.health.version).toBeTruthy()
  })

  it('rpc status uptime comes from the plugin boot stamp, not ctx.startedAt', async () => {
    const store = new ObserveStore(dir)
    const rpcHandlers = new Map<string, (endpoint: string, payload: any) => Promise<any>>()
    const ctx = cordisLikeCtx({
      tools: { register: () => () => {}, list: () => [] },
      connection: { rpc: { handle: (ch: string, h: any) => { rpcHandlers.set(ch, h); return () => true } } },
      logger: { warn: () => {} },
    })
    const plugin = createObservePlugin(store)
    await plugin.apply(ctx as any)

    const res: any = await rpcHandlers.get(MAESTRO_OBSERVE_CHANNEL)!('status', {})
    expect(res.ok).toBe(true)
    expect(res.value.uptimeMs).toBeGreaterThanOrEqual(0)
  })
})
