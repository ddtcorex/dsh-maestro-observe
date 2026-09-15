// tests/health-v2.test.ts
import { describe, it, expect } from 'vitest'
import { buildHealthReport } from '../src/host/health.js'

describe('buildHealthReport v2', () => {
  function fakeDeps() {
    return {
      startedAt: 1000,
      registry: { plugins: new Set(['maestro-a', 'maestro-b']), degraded: new Map() },
      tools: { list: () => [{ name: 'a' }] },
      connection: {
        rpc: {
          call: async (ch: string) => (ch === '/maestro-a' ? { ok: true } : { error: 'no-handler' }),
        },
      },
    }
  }

  it('discovers channels via listChannels', async () => {
    const h = await buildHealthReport(fakeDeps(), {
      listChannels: () => ['/maestro-a', '/maestro-b'],
      timeoutMs: 50,
      version: '9.9.9',
      now: 3000,
    })
    expect(h.channels.map((c) => c.channel).sort()).toEqual(['/maestro-a', '/maestro-b'])
    expect(h.channels.find((c) => c.channel === '/maestro-a')!.ok).toBe(true)
    expect(h.channels.find((c) => c.channel === '/maestro-b')!.ok).toBe(false)
  })

  it('dedupes degraded by id', async () => {
    const deps = fakeDeps()
    deps.registry.degraded = new Map([['/maestro-b', { error: 'boot-fail' }]])
    const h = await buildHealthReport(deps, {
      listChannels: () => ['/maestro-a', '/maestro-b'],
      timeoutMs: 50,
      version: '9.9.9',
      now: 3000,
    })
    const dupes = h.degraded.filter((d) => d.id === '/maestro-b')
    expect(dupes.length).toBe(1)
  })

  it('prefers bootTs for uptime', async () => {
    const h = await buildHealthReport({ ...fakeDeps(), bootTs: 500 } as any, {
      channels: ['/maestro-a'],
      timeoutMs: 50,
      version: '9.9.9',
      now: 3000,
    })
    expect(h.uptimeMs).toBe(2500)
  })

  it('ping resolves without hanging (clearable timeout)', async () => {
    const h = await buildHealthReport(
      { ...fakeDeps(), connection: { rpc: { call: async () => { await new Promise((r) => setTimeout(r, 5000)); return { ok: true } } } } },
      { channels: ['/slow'], timeoutMs: 50, version: '9.9.9', now: 3000 },
    )
    expect(h.channels[0].ok).toBe(false)
    expect(h.channels[0].error).toMatch(/timeout/)
  })
})
