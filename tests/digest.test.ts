import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDigestText } from '../src/host/digest.js'
import { ObserveStore } from '../src/host/observe-store.js'
import { createObservePlugin, runDigestOnce } from '../src/host/index.js'

describe('digest text', () => {
  it('renders totals, tops and over-budget flags', () => {
    const text = buildDigestText({
      day: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 0, turns: 4 },
      topTools: [{ key: 'bash', agg: { inputTokens: 90, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0, turns: 0 } }],
      topSessions: [],
      overBudget: ['day:2026-09-15'],
      errorCount: 2,
    })
    expect(text).toContain('160')
    expect(text).toContain('bash')
    expect(text).toContain('over-budget')
    expect(text).toContain('2 errors')
  })
})

describe('digest wiring', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'obs-digest-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  function fakeCtx(notifier: any) {
    return {
      effect: (fn: any) => fn(),
      on: () => () => true,
      tools: { register: () => () => true },
      connection: { rpc: { handle: () => () => true } },
      logger: { warn: () => {} },
      get: (k: string) => (k === 'maestroNotifier' ? notifier : undefined),
    }
  }

  it('notifier-absent path never throws', async () => {
    const store = new ObserveStore(dir)
    const plugin = createObservePlugin(store)
    await plugin.apply(fakeCtx(undefined) as any)
    const res = await runDigestOnce(fakeCtx(undefined) as any, store, Date.now())
    expect(res.sent).toBe(false)
    expect(res.reason).toBe('no-notifier')
  })

  it('skip warning fires at most once per day', async () => {
    const warns: any[][] = []
    const store = new ObserveStore(dir)
    const ctx: any = { logger: { warn: (...a: any[]) => warns.push(a) }, get: () => undefined }
    const now = Date.now()
    const first = await runDigestOnce(ctx, store, now)
    const second = await runDigestOnce(ctx, store, now + 61_000)
    expect(first.reason).toBe('no-notifier')
    expect(second.reason).toBe('no-notifier')
    expect(warns.length).toBe(1)
  })

  it('missing telegram target is skipped cleanly', async () => {
    const sent: any[] = []
    const store = new ObserveStore(dir)
    const res = await runDigestOnce(fakeCtx({ send: async (...a: any[]) => { sent.push(a); return { sent: true } } }) as any, store, Date.now())
    expect(res.sent).toBe(false)
    expect(res.reason).toBe('no-target')
    expect(sent.length).toBe(0)
  })

  it('sends digest through telegram when configured', async () => {
    const sent: any[] = []
    const store = new ObserveStore(dir)
    store.configSet('telegram.botToken', 'tok')
    store.configSet('telegram.chatId', 'chat')
    await store.push({ ts: Date.now(), kind: 'turn', sessionId: 'd', tokens: { inputTokens: 3, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 } })
    const res = await runDigestOnce(fakeCtx({ send: async (...a: any[]) => { sent.push(a); return { sent: true } } }) as any, store, Date.now())
    expect(res.sent).toBe(true)
    expect(sent.length).toBe(1)
    expect(sent[0][0]).toBe('telegram')
    expect(sent[0][1]).toEqual({ botToken: 'tok', chatId: 'chat' })
    expect(sent[0][2].text).toContain('5')
  })
})
