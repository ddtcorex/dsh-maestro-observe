export interface TokenUsage { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }
export interface TraceRecord {
  ts: number
  kind: 'turn' | 'step' | 'tool' | 'error'
  sessionId?: string
  tool?: string
  latencyMs?: number
  isError?: boolean
  tokens?: TokenUsage
  detail?: string
}
export interface CostAggregate { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; turns: number }
export type CostKey =
  | { scope: 'session'; sessionId: string; day?: string }
  | { scope: 'day'; day: string }

function pick<T>(obj: any, keys: string[]): T | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k]
  return undefined
}

export function fromSessionEvent(payload: unknown): TraceRecord | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as any
  const sessionId = pick<string>(p.session, ['id']) ?? pick<string>(p, ['sessionId', 'id'])
  const ev = pick<string>(p, ['event', 'kind']) ?? ''
  if (!sessionId && !ev) return null
  const tokens = pick<TokenUsage>(p, ['tokens', 'usage']) ?? undefined
  const kind: TraceRecord['kind'] = /tool/i.test(ev) ? 'tool' : /turn/i.test(ev) ? 'turn' : /step/i.test(ev) ? 'step' : tokens ? 'step' : 'step'
  return {
    ts: pick<number>(p, ['ts', 'timestamp', 'time']) ?? Date.now(),
    kind,
    sessionId,
    tool: pick<string>(p, ['tool', 'toolName', 'name']),
    latencyMs: pick<number>(p, ['latencyMs', 'durationMs', 'latency']),
    isError: pick<boolean>(p, ['isError', 'error']),
    tokens,
    detail: pick<string>(p, ['detail', 'message', 'reason']),
  }
}

export function fromTelemetryRecord(record: unknown): TraceRecord | null {
  if (!record || typeof record !== 'object') return null
  const r = record as any
  if (r.severity !== 'error') return null
  return {
    ts: pick<number>(r, ['ts', 'timestamp', 'time']) ?? Date.now(),
    kind: 'error',
    sessionId: pick<string>(r, ['sessionId', 'session']),
    isError: true,
    detail: [pick<string>(r, ['reason', 'message', 'detail']), r.channel ? `channel:${r.channel}` : ''].filter(Boolean).join(' ') || 'error',
  }
}
