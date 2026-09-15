import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('observe client', () => {
  const src = () => readFileSync('client/index.jsx', 'utf8')

  test('dashboard renders Cost/Errors/Latency/Health tabs', () => {
    const s = src()
    expect(s).toContain('Cost')
    expect(s).toContain('Errors')
    expect(s).toContain('Latency')
    expect(s).toContain('Health')
    expect(s).toContain('data-testid')
  })

  test('uses DSW tokens, no hardcoded palette', () => {
    const s = src()
    expect(s).toContain('var(--dsw-alias-')
    expect(s).not.toMatch(/#[0-9a-fA-F]{3,6}/)
  })

  test('queries RPC by endpoint with carrier unwrap', () => {
    const s = src()
    expect(s).toContain(`call('errors'`)
    expect(s).toContain(`call('latency'`)
    expect(s).toContain(`call('health'`)
    expect(s).toContain(`call('cost'`)
    expect(s).toContain(`groupBy`)
    expect(s).toContain('res.ok ? res.value : null')
    // readout must not call session cost without a session id
    expect(s).toMatch(/sessionId\s*\?\s*call|if\s*\(\s*!?sessionId/)
  })

  test('no emoji-as-icon, aria-live readout', () => {
    const s = src()
    expect(s).not.toMatch(/⚠|⚠️/)
    expect(s).toContain('aria-live')
    expect(s).toContain('aria-selected')
  })

  test('list keys are unique per record', () => {
    const s = src()
    expect(s).not.toMatch(/key:\s*r\.ts\s*\+\s*'-'\s*\+\s*\(r\.tool/)
  })
})
