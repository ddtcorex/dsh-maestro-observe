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

  test('queries the new RPC ops and guards missing sessionId', () => {
    const s = src()
    expect(s).toContain(`method: 'errors'`)
    expect(s).toContain(`method: 'latency'`)
    expect(s).toContain(`groupBy`)
    // readout must not call session cost without a session id
    expect(s).toMatch(/sessionId\s*\?\s*call|if\s*\(\s*!?sessionId/)
  })

  test('list keys are unique per record', () => {
    const s = src()
    expect(s).not.toMatch(/key:\s*r\.ts\s*\+\s*'-'\s*\+\s*\(r\.tool/)
  })
})
