import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ObserveStore } from '../src/host/observe-store.js'
import { runSpikeCheck } from '../src/host/index.js'

describe('errors grouped', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'obs-err-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('groups errors by tool+signature', async () => {
    const s = new ObserveStore(dir)
    await s.push({ ts: 1000, kind: 'error', tool: 'bash', isError: true, detail: 'boom id 1' })
    await s.push({ ts: 2000, kind: 'error', tool: 'bash', isError: true, detail: 'boom id 2' })
    await s.push({ ts: 3000, kind: 'error', tool: 'web', isError: true, detail: 'other' })
    const g = s.errorsGrouped()
    expect(g.find((r) => r.tool === 'bash')!.count).toBe(2)
    expect(g.find((r) => r.tool === 'web')!.count).toBe(1)
  })

  it('spike alerts once per window', async () => {
    const sent: any[] = []
    const s = new ObserveStore(dir)
    s.configSet('spike_n', '2')
    s.configSet('spike_m', '60')
    s.configSet('telegram.botToken', 'tok')
    s.configSet('telegram.chatId', 'chat')
    const now = Date.now()
    await s.push({ ts: now - 1000, kind: 'error', tool: 'bash', isError: true, detail: 'boom' })
    await s.push({ ts: now - 500, kind: 'error', tool: 'bash', isError: true, detail: 'boom' })
    const ctx: any = {
      logger: { warn: () => {} },
      get: (k: string) => (k === 'maestroNotifier'
        ? { send: async (...a: any[]) => { sent.push(a); return { sent: true } } }
        : undefined),
    }
    const first = await runSpikeCheck(ctx, s, now)
    expect(first.alerted).toBe(true)
    expect(sent.length).toBe(1)
    expect(sent[0][2].text).toContain('2 errors')
    const second = await runSpikeCheck(ctx, s, now + 1000)
    expect(second.alerted).toBe(false)
    expect(sent.length).toBe(1)
  })

  it('no alert below threshold', async () => {
    const s = new ObserveStore(dir)
    s.configSet('spike_n', '10')
    s.configSet('spike_m', '5')
    const ctx: any = { logger: { warn: () => {} }, get: () => undefined }
    const res = await runSpikeCheck(ctx, s, Date.now())
    expect(res.alerted).toBe(false)
  })

  it('computes p50/p95/p99', async () => {
    const s = new ObserveStore(dir)
    for (let i = 1; i <= 100; i++) await s.push({ ts: i, kind: 'tool', tool: 'bash', latencyMs: i, sessionId: 'l' })
    const l = s.latencyPercentiles('bash')
    expect(l.count).toBe(100)
    expect(l.p50).toBe(50)
    expect(l.p95).toBe(95)
    expect(l.p99).toBe(99)
  })

  it('latency op mirrors store percentiles', async () => {
    const { createObservePlugin } = await import('../src/host/index.js')
    const s = new ObserveStore(dir)
    for (let i = 1; i <= 10; i++) await s.push({ ts: i, kind: 'tool', tool: 'web', latencyMs: i * 10, sessionId: 'm' })
    const plugin = createObservePlugin(s)
    const res: any = await plugin.tool.execute({ op: 'latency', tool: 'web' })
    expect(res.ok).toBe(true)
    expect(res.latency.count).toBe(10)
    expect(res.latency.p50).toBe(50)
  })
})
