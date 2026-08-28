import { describe, it, expect } from 'vitest'
import { fromSessionEvent, fromTelemetryRecord } from '../src/host/trace-record.js'

describe('trace-record reducers', () => {
  it('maps a turn event with tokens', () => {
    const r = fromSessionEvent({ session: { id: 's1' }, event: 'turn/end', tokens: { inputTokens: 5, outputTokens: 3, cacheReadTokens: 1, cacheWriteTokens: 0 }, isError: false })
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('turn')
    expect(r!.sessionId).toBe('s1')
    expect(r!.tokens!.inputTokens).toBe(5)
  })
  it('maps a tool event with latency and error flag', () => {
    const r = fromSessionEvent({ session: { id: 's2' }, event: 'tool/result', tool: 'bash', latencyMs: 1234, isError: true })
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('tool')
    expect(r!.tool).toBe('bash')
    expect(r!.latencyMs).toBe(1234)
    expect(r!.isError).toBe(true)
  })
  it('returns null for unrecognized shapes (fail-closed)', () => {
    expect(fromSessionEvent(null)).toBeNull()
    expect(fromSessionEvent({ foo: 1 })).toBeNull()
    expect(fromSessionEvent('string')).toBeNull()
  })
  it('maps telemetry error records', () => {
    const r = fromTelemetryRecord({ severity: 'error', channel: 'ledger', reason: 'boom', ts: 123 })
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('error')
    expect(r!.detail).toContain('boom')
  })
  it('ignores non-error telemetry records', () => {
    expect(fromTelemetryRecord({ severity: 'info', channel: 'ledger' })).toBeNull()
  })
})
