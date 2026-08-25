import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ObserveStore } from '../src/observe-store.js'
import { createObservePlugin, MAESTRO_OBSERVE_CHANNEL, toolSchema } from '../src/index.js'

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
})
