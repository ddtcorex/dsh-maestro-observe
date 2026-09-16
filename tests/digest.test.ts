import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDigestText, escapeHtml, type DigestSnapshot } from '../src/host/digest.js'
import { ObserveStore } from '../src/host/observe-store.js'
import { createObservePlugin, runDigestOnce } from '../src/host/index.js'

function agg(over: Partial<{ inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; turns: number }> = {}) {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, turns: 0, ...over }
}

function baseSnapshot(over: Partial<DigestSnapshot> = {}): DigestSnapshot {
  return {
    dayLabel: '2026-09-16',
    day: agg({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, turns: 4 }),
    prevDay: { label: '2026-09-15', agg: agg({ inputTokens: 200, outputTokens: 100, turns: 8 }) },
    topTools: [{ key: 'bash', calls: 12, agg: agg() }],
    topSessions: [{ key: 'session-3db9c441-449d-4843-990b-3bfdd06581fa', agg: agg({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, turns: 4 }) }],
    topErrors: [{ tool: 'edit', signature: 'tool error FsError FS_STALE_VERSION', count: 2 }],
    latency: { count: 0, p50: 0, p95: 0 },
    budgets: [],
    errorCount: 2,
    ...over,
  }
}

describe('digest text', () => {
  it('renders the Maestro HTML header with the day label', () => {
    const text = buildDigestText(baseSnapshot())
    expect(text).toContain('<b>🤖 Maestro Observe</b> — daily digest <code>2026-09-16</code>')
  })

  it('splits billable tokens from cache reads', () => {
    const text = buildDigestText(baseSnapshot())
    // 100 in + 50 out billed, 10 cache — never a single misleading total.
    expect(text).toContain('150 billed (in 100 + out 50)')
    expect(text).toContain('10 cache')
    expect(text).not.toContain('160 tokens')
  })

  it('carries the previous full day for context', () => {
    const text = buildDigestText(baseSnapshot())
    expect(text).toContain('<b>Yesterday:</b> 8 turns')
    expect(buildDigestText(baseSnapshot({ prevDay: undefined }))).not.toContain('Yesterday')
  })

  it('ranks tools by call count', () => {
    const text = buildDigestText(baseSnapshot())
    expect(text).toContain('<code>bash</code> ×12')
  })

  it('shortens session ids', () => {
    const text = buildDigestText(baseSnapshot())
    expect(text).toContain('<code>3db9c441</code> 150 billed (4 turns)')
    expect(text).not.toContain('3bfdd06581fa')
  })

  it('lists top error signatures with counts', () => {
    const text = buildDigestText(baseSnapshot())
    expect(text).toContain('<b>Errors:</b> 2')
    expect(text).toContain('<code>edit</code> tool error FsError FS_STALE_VERSION ×2')
  })

  it('shows an explicit all-clear when there are no errors', () => {
    const text = buildDigestText(baseSnapshot({ errorCount: 0, topErrors: [] }))
    expect(text).toContain('✅ no errors')
  })

  it('flags only over-budget entries with spent/limit numbers', () => {
    const text = buildDigestText(baseSnapshot({
      budgets: [
        { scope: 'day', key: '2026-09-16', spent: 150, limit: 100, over: true },
        { scope: 'day', key: 'other', spent: 10, limit: 100, over: false },
      ],
    }))
    expect(text).toContain('⚠️ over-budget: <code>day:2026-09-16</code> 150/100')
    expect(text).not.toContain('other')
  })

  it('omits empty sections but never the usage lines', () => {
    const text = buildDigestText(baseSnapshot({ topTools: [], topSessions: [], topErrors: [], errorCount: 0, latency: undefined }))
    expect(text).toContain('Usage today')
    expect(text).not.toContain('Top tools')
    expect(text).not.toContain('Sessions:')
    expect(text).not.toContain('Latency')
  })

  it('escapes HTML in dynamic text', () => {
    expect(escapeHtml('<b>&"')).toBe('&lt;b&gt;&amp;&quot;')
    const text = buildDigestText(baseSnapshot({
      topTools: [{ key: '<script>', calls: 1, agg: agg() }],
      topErrors: [{ tool: '', signature: 'a<b>c', count: 1 }],
    }))
    expect(text).toContain('&lt;script&gt;')
    expect(text).not.toContain('<script>')
    expect(text).toContain('a&lt;b&gt;c')
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

  it('sends the HTML digest through telegram when configured', async () => {
    const sent: any[] = []
    const store = new ObserveStore(dir)
    store.configSet('telegram.botToken', 'tok')
    store.configSet('telegram.chatId', 'chat')
    await store.push({ ts: Date.now(), kind: 'turn', sessionId: 'd', tokens: { inputTokens: 3, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 } })
    await store.push({ ts: Date.now(), kind: 'tool', tool: 'bash', sessionId: 'd' })
    await store.push({ ts: Date.now(), kind: 'tool', tool: 'bash', sessionId: 'd' })
    const res = await runDigestOnce(fakeCtx({ send: async (...a: any[]) => { sent.push(a); return { sent: true } } }) as any, store, Date.now())
    expect(res.sent).toBe(true)
    expect(sent.length).toBe(1)
    expect(sent[0][0]).toBe('telegram')
    expect(sent[0][1]).toEqual({ botToken: 'tok', chatId: 'chat' })
    expect(sent[0][2].text).toContain('<b>🤖 Maestro Observe</b>')
    expect(sent[0][2].text).toContain('5 billed (in 3 + out 2)')
    expect(sent[0][2].text).toContain('<code>bash</code> ×2')
  })
})
