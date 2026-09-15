import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ObserveStore } from '../src/host/observe-store.js'
import { purgeOld } from '../src/host/retention.js'

describe('retention purge', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'obs-ret-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('purges rows older than retention', async () => {
    const s = new ObserveStore(dir)
    await s.push({ ts: Date.now() - 40 * 86400000, kind: 'step', sessionId: 'old' })
    await s.push({ ts: Date.now(), kind: 'step', sessionId: 'new' })
    const n = await purgeOld(s, Date.now(), 30)
    expect(n).toBe(1)
    expect(s.trace(10).some((r) => r.sessionId === 'old')).toBe(false)
    expect(await s.historyLines()).toBe(1)
  })

  it('keeps everything within retention', async () => {
    const s = new ObserveStore(dir)
    await s.push({ ts: Date.now(), kind: 'step', sessionId: 'fresh' })
    const n = await purgeOld(s, Date.now(), 30)
    expect(n).toBe(0)
    expect(await s.historyLines()).toBe(1)
  })
})
