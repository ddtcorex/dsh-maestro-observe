// tests/health.test.ts
import { describe, it, expect } from 'vitest'
import { buildHealthReport } from '../src/host/health.js'

const CHANNELS = ['/dsh-maestro-remote', '/dsh-maestro-review', '/dsh-maestro-observe']

function fakeCtx(over: any = {}) {
  return {
    startedAt: 1000,
    registry: { plugins: new Set(['p1', 'p2']) },
    tools: { list: () => [{ name: 'a' }, { name: 'b' }] },
    connection: { rpc: { call: async (ch: string) => ch === '/dsh-maestro-observe' ? { ok: true } : { error: 'no-handler' } } },
    ...over,
  }
}

describe('buildHealthReport', () => {
  it('reports uptime, plugins and tool count', async () => {
    const h = await buildHealthReport(fakeCtx(), { channels: CHANNELS, timeoutMs: 50, version: '0.1.0', now: 3000 })
    expect(h.uptimeMs).toBe(2000)
    expect(h.plugins.length).toBe(2)
    expect(h.toolCount).toBe(2)
    expect(h.version).toBe('0.1.0')
  })
  it('pings channels with ok flag', async () => {
    const h = await buildHealthReport(fakeCtx(), { channels: CHANNELS, timeoutMs: 50, version: '0.1.0', now: 3000 })
    const observe = h.channels.find(c => c.channel === '/dsh-maestro-observe')
    expect(observe!.ok).toBe(true)
    const remote = h.channels.find(c => c.channel === '/dsh-maestro-remote')
    expect(remote!.ok).toBe(false)
    expect(remote!.error).toBeTruthy()
    // failed channels are also degraded
    expect(h.degraded.some(d => d.id === '/dsh-maestro-remote')).toBe(true)
  })
  it('exposes registry.degraded Map', async () => {
    const degraded = new Map([['bad-plugin', { error: 'ERR_MODULE_NOT_FOUND' }]])
    const h = await buildHealthReport(fakeCtx({ registry: { plugins: new Set(), degraded } }), { channels: ['/dsh-maestro-observe'], timeoutMs: 50, version: '0.1.0', now: 3000 })
    expect(h.degraded.some(d => d.id === 'bad-plugin')).toBe(true)
  })
  it('survives missing rpc/registry/tools', async () => {
    const h = await buildHealthReport({ startedAt: 1, now: 2 } as any, { channels: CHANNELS, timeoutMs: 50, version: '0.1.0' })
    expect(h.toolCount).toBe(0)
    expect(h.plugins).toEqual([])
    expect(h.channels.length).toBe(CHANNELS.length)
  })
})
