import { describe, it, expect } from 'vitest'
import { redactDetail } from '../src/host/redact.js'
import { normalizeSignature, fromTelemetryRecord } from '../src/host/trace-record.js'

describe('redact', () => {
  it('truncates long detail to 500 chars', () => {
    expect(redactDetail('x'.repeat(600))!.length).toBe(500)
  })
  it('redacts secret shapes', () => {
    expect(redactDetail('key sk-ant-abc123 secret')!).toContain('[redacted]')
    expect(redactDetail('token ghp_xyz')!).toContain('[redacted]')
    expect(redactDetail('Bearer tok12345')!).toContain('[redacted]')
    expect(redactDetail('plain hello')!).toBe('plain hello')
  })
  it('passes non-strings through as undefined', () => {
    expect(redactDetail(undefined)).toBeUndefined()
    expect(redactDetail(42)).toBeUndefined()
  })
})
describe('signature', () => {
  it('strips numbers/hex/uuid/paths', () => {
    const a = normalizeSignature('boom id 12345 /tmp/x.ts:10 reason 0xdead')
    const b = normalizeSignature('boom id 99999 /tmp/y.ts:20 reason 0xbeef')
    expect(a).toBe(b)
  })
  it('traceId passes through telemetry reducer', () => {
    const r = fromTelemetryRecord({ severity: 'error', channel: 'c', time: 1, attributes: {}, body: { message: 'x', traceId: 't-1' } })
    expect(r!.traceId).toBe('t-1')
  })
})
