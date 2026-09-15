import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ObserveStore, historyPath } from '../src/host/observe-store.js'

describe('ObserveStore', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'observe-')); })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('pushes trace records newest-first with cap 200', async () => {
    const s = new ObserveStore(dir)
    for (let i = 0; i < 205; i++) await s.push({ ts: i, kind: 'step', sessionId: 's1' })
    const t = s.trace()
    expect(t.length).toBe(200)
    expect(t[0].ts).toBe(204)          // newest first
    expect(t[199].ts).toBe(5)
  })

  it('aggregates cost per day and per session', async () => {
    const s = new ObserveStore(dir)
    const now = Date.now()
    await s.push({ ts: now, kind: 'turn', sessionId: 'a', tokens: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } })
    await s.push({ ts: now + 1, kind: 'turn', sessionId: 'b', tokens: { inputTokens: 20, outputTokens: 7, cacheReadTokens: 2, cacheWriteTokens: 0 } })
    const day = s.cost('day')
    expect(day.inputTokens).toBe(30)
    expect(day.outputTokens).toBe(12)
    expect(day.cacheReadTokens).toBe(2)
    expect(day.turns).toBe(2)
    expect(s.cost('session', 'a').inputTokens).toBe(10)
  })

  it('persists history and reloads tail into ring', async () => {
    const s = new ObserveStore(dir)
    for (let i = 0; i < 5; i++) await s.push({ ts: i, kind: 'tool', tool: `t${i}`, sessionId: 'x' })
    const s2 = new ObserveStore(dir)
    await s2.load()
    expect(s2.trace().length).toBe(5)
    expect(s2.trace()[0].tool).toBe('t4')
    expect(s2.cost('day').turns).toBe(0)   // no tokens in records
  })

  it('serializes concurrent pushes without lost updates', async () => {
    const s = new ObserveStore(dir)
    await Promise.all(Array.from({ length: 50 }, (_, i) => s.push({ ts: Date.now() + i, kind: 'turn', sessionId: 'c', tokens: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } })))
    expect(s.cost('session', 'c').inputTokens).toBe(50)
  })

  it('historyPath is namespaced dsh-maestro-observe', () => {
    expect(historyPath(dir)).toContain(join('dsh-maestro-observe', 'observe.sqlite'))
  })

  // --- Fix Round 1 covering tests ---

  it('cost(day) isolation — 1970 record does not leak into today', async () => {
    const s = new ObserveStore(dir)
    // 1970-01-01 record with tokens
    await s.push({ ts: 1, kind: 'turn', sessionId: 'z', tokens: { inputTokens: 99, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } })
    // today bucket should be empty
    expect(s.cost('day').inputTokens).toBe(0)
    // explicit day bucket should contain it
    expect(s.cost('day', '1970-01-01').inputTokens).toBe(99)
    expect(s.cost('day', '1970-01-01').turns).toBe(1)
  })

  it('queue recovers after rejected write (poison guard)', async () => {
    // Create a file where the dsh-maestro-observe dir should be, so mkdir fails (ENOTDIR)
    const blockPath = join(dir, 'dsh-maestro-observe')
    await writeFile(blockPath, 'block')
    const s = new ObserveStore(dir)
    // first push cannot open the DB but must not throw; ring still updates (degraded mode)
    await s.push({ ts: Date.now(), kind: 'turn', sessionId: 'q1', tokens: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } })
    expect(s.trace().length).toBe(1)
    expect(await s.historyLines()).toBe(0)
    // fix FS so the next open can succeed
    await rm(blockPath, { force: true })
    await mkdir(blockPath, { recursive: true, mode: 0o700 })
    await s.push({ ts: Date.now(), kind: 'turn', sessionId: 'q1', tokens: { inputTokens: 2, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 } })
    // the pre-recovery push is flushed, not lost
    expect(s.cost('session', 'q1').inputTokens).toBe(3)
    expect(s.trace().length).toBe(2)
    // both writes persisted
    const lines = await s.historyLines()
    expect(lines).toBe(2)
  })

  it('concurrent load+push do not lose records', async () => {
    const s1 = new ObserveStore(dir)
    await s1.push({ ts: Date.now(), kind: 'tool', tool: 'pre1', sessionId: 'p' })
    await s1.push({ ts: Date.now() + 1, kind: 'tool', tool: 'pre2', sessionId: 'p' })
    const s2 = new ObserveStore(dir)
    const r1 = { ts: Date.now() + 10, kind: 'tool' as const, tool: 'r1', sessionId: 'p' }
    const r2 = { ts: Date.now() + 11, kind: 'tool' as const, tool: 'r2', sessionId: 'p' }
    await Promise.all([s2.load(), s2.push(r1), s2.push(r2)])
    // s2 should have 2 history records + 2 pushed = 4
    expect(s2.trace().length).toBe(4)
    const tools = s2.trace().map(r => r.tool)
    expect(tools).toContain('pre1')
    expect(tools).toContain('pre2')
    expect(tools).toContain('r1')
    expect(tools).toContain('r2')
  })
})
