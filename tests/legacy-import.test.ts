import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ObserveStore } from '../src/host/observe-store.js'

describe('legacy import privacy', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'obs-legacy-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('redacts secrets from imported JSONL lines', async () => {
    const sub = join(dir, 'dsh-maestro-observe')
    await mkdir(sub, { recursive: true })
    await writeFile(
      join(sub, 'history.jsonl'),
      JSON.stringify({ ts: 1000, kind: 'error', tool: 'bash', sessionId: 's', isError: true, detail: 'leaked sk-ant-secret123 here' }) + '\n'
      + JSON.stringify({ ts: 2000, kind: 'step', sessionId: 's', detail: 'x'.repeat(600) }) + '\n',
    )
    const s = new ObserveStore(dir)
    await s.load()
    const records = s.trace(10)
    expect(records.length).toBe(2)
    const err = records.find((r) => r.kind === 'error')!
    expect(err.detail).toContain('[redacted]')
    expect(err.detail).not.toContain('sk-ant-secret123')
    const step = records.find((r) => r.kind === 'step')!
    expect(step.detail!.length).toBeLessThanOrEqual(500)
  })
})
