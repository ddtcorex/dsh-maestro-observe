import { describe, it, expect } from 'vitest'
import { fromSessionEvent, fromTelemetryRecord } from '../src/host/trace-record.js'

const session = { id: 's1' }

describe('trace-record reducers (real harness shapes)', () => {
  it('maps turn/end to a turn record', () => {
    const r = fromSessionEvent(session, { type: 'turn/end', seq: 1, time: 1000, data: { turn: 2, reason: 'stop' } })
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('turn')
    expect(r!.sessionId).toBe('s1')
    expect(r!.ts).toBe(1000)
  })
  it('maps assistant/message usage to tokens', () => {
    const r = fromSessionEvent(session, {
      type: 'assistant/message', seq: 2, time: 2000,
      data: { turn: 1, step: 1, message: {}, stream: [], usage: { inputTokens: 5, outputTokens: 3, cacheReadTokens: 1 } },
    })
    expect(r!.kind).toBe('step')
    expect(r!.tokens!.inputTokens).toBe(5)
    expect(r!.tokens!.outputTokens).toBe(3)
    expect(r!.tokens!.cacheReadTokens).toBe(1)
  })
  it('maps tool/call name and tool/result error', () => {
    const call = fromSessionEvent({ id: 's2' }, {
      type: 'tool/call', seq: 3, time: 3000,
      data: { turn: 1, step: 2, callId: 'c1', name: 'bash', arguments: '{}' },
    })
    expect(call!.kind).toBe('tool')
    expect(call!.tool).toBe('bash')
    expect(call!.callId).toBe('c1')
    const res = fromSessionEvent({ id: 's2' }, {
      type: 'tool/result', seq: 4, time: 3500,
      data: { turn: 1, step: 2, message: { source: { kind: 'tool', callId: 'c1' }, isError: true }, error: { name: 'ExitError', code: '1' } },
    })
    expect(res!.kind).toBe('tool')
    expect(res!.isError).toBe(true)
    // tool/result carries no name — only message.source.callId linking to the call.
    expect(res!.tool).toBeUndefined()
    expect(res!.callId).toBe('c1')
  })
  it('falls back to step for other named events', () => {
    const r = fromSessionEvent(session, { type: 'step/start', seq: 5, time: 4000, data: { turn: 1, step: 3 } })
    expect(r!.kind).toBe('step')
    expect(r!.sessionId).toBe('s1')
  })
  it('returns null for missing session/event', () => {
    expect(fromSessionEvent(null, null)).toBeNull()
    expect(fromSessionEvent(session, null)).toBeNull()
    expect(fromSessionEvent(null, { type: 'turn/end', time: 1, data: {} })).toBeNull()
    expect(fromSessionEvent('string', 'string')).toBeNull()
  })
  it('maps telemetry waterfall error records', () => {
    const r = fromTelemetryRecord({
      channel: 'ops', time: 123, severity: 'error',
      attributes: { 'telemetry.op': 'agent-error' }, body: { message: 'boom' },
    })
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('error')
    expect(r!.ts).toBe(123)
    expect(r!.detail).toContain('boom')
  })
  it('ignores non-error telemetry records', () => {
    expect(fromTelemetryRecord({ channel: 'ledger', time: 1, severity: 'info', attributes: {}, body: {} })).toBeNull()
  })
})
