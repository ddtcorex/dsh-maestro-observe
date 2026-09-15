import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ObserveStore } from '../src/host/observe-store.js'

describe('ObserveStore sqlite core', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'obs-sqlite-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('persists push and reads it back after reload', async () => {
    const s = new ObserveStore(dir)
    await s.push({ ts: 1700000000000, kind: 'turn', sessionId: 'a', tokens: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } })
    const s2 = new ObserveStore(dir)
    await s2.load()
    expect(s2.trace().length).toBe(1)
    expect(s2.cost('day', '2023-11-14').inputTokens).toBe(10)
  })

  it('session cost keys by record day, not today', async () => {
    const s = new ObserveStore(dir)
    await s.push({ ts: 1, kind: 'turn', sessionId: 'z', tokens: { inputTokens: 99, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } })
    expect(s.cost('day').inputTokens).toBe(0)
    expect(s.cost('day', '1970-01-01').inputTokens).toBe(99)
    expect(s.cost('session', 'z').inputTokens).toBe(99)
  })

  it('load is idempotent', async () => {
    const s = new ObserveStore(dir)
    await s.push({ ts: 100, kind: 'tool', tool: 'bash', sessionId: 'x' })
    const s2 = new ObserveStore(dir)
    await s2.load(); await s2.load()
    expect(s2.trace().length).toBe(1)
    expect(await s2.historyLines()).toBe(1)
  })
})
