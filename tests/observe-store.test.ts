import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ObserveStore, historyPath } from '../src/observe-store.js'

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
    await s.push({ ts: 1, kind: 'turn', sessionId: 'a', tokens: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } })
    await s.push({ ts: 2, kind: 'turn', sessionId: 'b', tokens: { inputTokens: 20, outputTokens: 7, cacheReadTokens: 2, cacheWriteTokens: 0 } })
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
    await Promise.all(Array.from({ length: 50 }, (_, i) => s.push({ ts: i, kind: 'turn', sessionId: 'c', tokens: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } })))
    expect(s.cost('session', 'c').inputTokens).toBe(50)
  })

  it('historyPath is namespaced dsh-maestro-observe', () => {
    expect(historyPath(dir)).toContain(join('dsh-maestro-observe', 'history.jsonl'))
  })
})
