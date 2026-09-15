import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ObserveStore } from '../src/host/observe-store.js'

describe('config + budgets', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'obs-cfg-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('config round-trips and survives reload', async () => {
    const s = new ObserveStore(dir)
    s.configSet('retention_days', '30')
    expect(s.configGet('retention_days')).toBe('30')
    const s2 = new ObserveStore(dir)
    await s2.load()
    expect(s2.configGet('retention_days')).toBe('30')
  })

  it('budget check flags over-spend', async () => {
    const s = new ObserveStore(dir)
    const now = Date.now()
    const day = new Date(now).toISOString().slice(0, 10)
    await s.push({ ts: now, kind: 'turn', sessionId: 'a', tokens: { inputTokens: 80, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 } })
    s.budgetSet('day', day, 100)
    const c = s.budgetCheck('day', day)
    expect(c.spent).toBe(110)
    expect(c.over).toBe(true)
    expect(c.pct).toBeCloseTo(1.1)
  })

  it('unknown budget is not over', () => {
    const s = new ObserveStore(dir)
    const c = s.budgetCheck('day', '2099-01-01')
    expect(c).toEqual({ spent: 0, limit: 0, pct: 0, over: false })
  })
})
