import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ObserveStore } from '../src/host/observe-store.js'
import { createObservePlugin, MAESTRO_OBSERVE_CHANNEL, toolSchema } from '../src/host/index.js'

describe('observe host plugin', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'obs-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function fakeCtx(over: any = {}) {
    const tools: any[] = []
    const rpcHandlers = new Map<string, (req: any) => any>()
    const ctx: any = {
      startedAt: Date.now(),
      effect: (fn: any) => {
        const d = fn()
        return d
      },
      on: () => () => true,
      tools: { register: (t: any) => { tools.push(t); return () => {} } },
      connection: { rpc: { handle: (ch: string, h: any) => { rpcHandlers.set(ch, h); return () => true } } },
      logger: { warn: () => {} },
      get: () => undefined,
      ...over,
    }
    return { ctx, tools, rpcHandlers }
  }

  it('registers tool and rpc channel', async () => {
    const store = new ObserveStore(dir)
    const { ctx, tools, rpcHandlers } = fakeCtx()
    const plugin = createObservePlugin(store)
    await plugin.apply(ctx)
    expect(tools.some((t: any) => t.name === 'maestro-observe')).toBe(true)
    expect(rpcHandlers.has(MAESTRO_OBSERVE_CHANNEL)).toBe(true)
  })

  it('tool trace returns pushed records', async () => {
    const store = new ObserveStore(dir)
    await store.push({ ts: 1, kind: 'tool', tool: 'bash', sessionId: 's1' })
    const { ctx } = fakeCtx()
    const plugin = createObservePlugin(store)
    await plugin.apply(ctx)
    const res: any = await plugin.tool.execute({ op: 'trace' })
    expect(res.ok).toBe(true)
    expect(Array.isArray(res.records)).toBe(true)
    expect(res.records.length).toBe(1)
    expect(res.records[0].tool).toBe('bash')
  })

  it('rpc health returns ok report', async () => {
    const store = new ObserveStore(dir)
    const { ctx, rpcHandlers } = fakeCtx()
    const plugin = createObservePlugin(store)
    await plugin.apply(ctx)
    const res: any = await rpcHandlers.get(MAESTRO_OBSERVE_CHANNEL)!({ method: 'health' })
    expect(res.ok).toBe(true)
    expect(res.health.version).toBeTruthy()
  })

  it('rpc unknown method fails closed', async () => {
    const store = new ObserveStore(dir)
    const { ctx, rpcHandlers } = fakeCtx()
    const plugin = createObservePlugin(store)
    await plugin.apply(ctx)
    const res: any = await rpcHandlers.get(MAESTRO_OBSERVE_CHANNEL)!({ method: 'nope' })
    expect(res.ok).toBe(false)
  })

  it('tool schema validates op/limit/scope', async () => {
    // toolSchema is schemastery schema; basic sanity via execute unknown op
    const store = new ObserveStore(dir)
    const { ctx } = fakeCtx()
    const plugin = createObservePlugin(store)
    await plugin.apply(ctx)
    const bad: any = await plugin.tool.execute({ op: 'unknown' as any })
    expect(bad.ok).toBe(false)
    expect(toolSchema).toBeTruthy()
  })

  it('rpc cost session without sessionId fails closed', async () => {
    const store = new ObserveStore(dir)
    const { ctx, rpcHandlers } = fakeCtx()
    const plugin = createObservePlugin(store)
    await plugin.apply(ctx)
    const res: any = await rpcHandlers.get(MAESTRO_OBSERVE_CHANNEL)!({ method: 'cost', scope: 'session' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/sessionId/)
    const res2: any = await rpcHandlers.get(MAESTRO_OBSERVE_CHANNEL)!({ method: 'cost', scope: 'session', sessionId: '' })
    expect(res2.ok).toBe(false)
  })

  it('tool cost session without sessionId fails closed', async () => {
    const store = new ObserveStore(dir)
    const { ctx } = fakeCtx()
    const plugin = createObservePlugin(store)
    await plugin.apply(ctx)
    const res: any = await plugin.tool.execute({ op: 'cost', scope: 'session' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/sessionId/)
    const res2: any = await plugin.tool.execute({ op: 'cost', scope: 'session', sessionId: '' })
    expect(res2.ok).toBe(false)
  })

  it('tool schema accepts bare trace/health/cost-day ops', async () => {
    expect(toolSchema({ op: 'trace' }).op).toBe('trace')
    expect(toolSchema({ op: 'health' }).op).toBe('health')
    expect(toolSchema({ op: 'cost' }).scope).toBe('day')
    expect(toolSchema({ op: 'trace' }).limit).toBe(50)
  })

  it('VERSION matches package.json', async () => {
    const { createRequire } = await import('node:module')
    const pkg = createRequire(import.meta.url)('../package.json')
    const idx = await import('../src/host/index.js')
    expect((idx as any).VERSION).toBe(pkg.version)
  })

  it('cost groupBy tool splits tokens', async () => {
    const store = new ObserveStore(dir)
    await store.push({ ts: Date.now(), kind: 'tool', tool: 'bash', sessionId: 'g', tokens: { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } })
    await store.push({ ts: Date.now(), kind: 'tool', tool: 'web', sessionId: 'g', tokens: { inputTokens: 7, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } })
    const { ctx } = fakeCtx()
    const plugin = createObservePlugin(store)
    await plugin.apply(ctx)
    const res: any = await plugin.tool.execute({ op: 'cost', scope: 'day', groupBy: 'tool' })
    expect(res.ok).toBe(true)
    expect(res.groups.find((g: any) => g.key === 'bash').agg.inputTokens).toBe(5)
    expect(res.groups.find((g: any) => g.key === 'web').agg.inputTokens).toBe(7)
  })

  it('budget set/check round-trips via tool and rpc', async () => {
    const store = new ObserveStore(dir)
    const { ctx, rpcHandlers } = fakeCtx()
    const plugin = createObservePlugin(store)
    await plugin.apply(ctx)
    const day = new Date().toISOString().slice(0, 10)
    const setRes: any = await plugin.tool.execute({ op: 'budget', action: 'set', scope: 'day', key: day, limit_tokens: 100 })
    expect(setRes.ok).toBe(true)
    const checkRes: any = await plugin.tool.execute({ op: 'budget', action: 'check', scope: 'day', key: day })
    expect(checkRes.ok).toBe(true)
    expect(checkRes.budget.limit).toBe(100)
    const rpcRes: any = await rpcHandlers.get(MAESTRO_OBSERVE_CHANNEL)!({ method: 'budget', action: 'check', scope: 'day', key: day })
    expect(rpcRes.ok).toBe(true)
    expect(rpcRes.budget.limit).toBe(100)
    const bad: any = await plugin.tool.execute({ op: 'budget', action: 'check', scope: 'day' })
    expect(bad.ok).toBe(false)
  })

  it('config get/set round-trips via tool and rpc', async () => {
    const store = new ObserveStore(dir)
    const { ctx, rpcHandlers } = fakeCtx()
    const plugin = createObservePlugin(store)
    await plugin.apply(ctx)
    const setRes: any = await plugin.tool.execute({ op: 'config', action: 'set', key: 'retention_days', value: '30' })
    expect(setRes.ok).toBe(true)
    const getRes: any = await plugin.tool.execute({ op: 'config', action: 'get', key: 'retention_days' })
    expect(getRes).toEqual({ ok: true, value: '30' })
    const rpcRes: any = await rpcHandlers.get(MAESTRO_OBSERVE_CHANNEL)!({ method: 'config', action: 'get', key: 'retention_days' })
    expect(rpcRes).toEqual({ ok: true, value: '30' })
    const bad: any = await plugin.tool.execute({ op: 'config', action: 'wipe' })
    expect(bad.ok).toBe(false)
  })

  it('trace honors sessionId/tool/kind/since filters on tool and rpc', async () => {
    const store = new ObserveStore(dir)
    const now = Date.now()
    await store.push({ ts: now - 1000, kind: 'tool', tool: 'bash', sessionId: 's1' })
    await store.push({ ts: now, kind: 'tool', tool: 'web', sessionId: 's2' })
    const { ctx, rpcHandlers } = fakeCtx()
    const plugin = createObservePlugin(store)
    await plugin.apply(ctx)
    const bySession: any = await plugin.tool.execute({ op: 'trace', sessionId: 's1' })
    expect(bySession.ok).toBe(true)
    expect(bySession.records.length).toBe(1)
    expect(bySession.records[0].tool).toBe('bash')
    const byTool: any = await rpcHandlers.get(MAESTRO_OBSERVE_CHANNEL)!({ method: 'trace', tool: 'web' })
    expect(byTool.records.length).toBe(1)
    expect(byTool.records[0].sessionId).toBe('s2')
    const byKind: any = await plugin.tool.execute({ op: 'trace', kind: 'error' })
    expect(byKind.records.length).toBe(0)
    const bySince: any = await plugin.tool.execute({ op: 'trace', since: now })
    expect(bySince.records.length).toBe(1)
  })

  it('boot_ts refreshes on every boot', async () => {
    const old = process.env.DSH_HOME
    process.env.DSH_HOME = dir
    try {
      const seed = new ObserveStore(dir)
      seed.configSet('boot_ts', '1')
      const def = (await import('../src/host/index.js')).default
      const { ctx } = fakeCtx()
      await def.apply(ctx as any)
      const probe = new ObserveStore(dir)
      const ts = Number(probe.configGet('boot_ts'))
      expect(ts).toBeGreaterThan(1000)
      expect(Date.now() - ts).toBeLessThan(60000)
    } finally {
      if (old === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = old
    }
  })
})
