export interface TokenUsage { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }
export interface TraceRecord {
  ts: number
  kind: 'turn' | 'step' | 'tool' | 'error'
  sessionId?: string
  tool?: string
  // Links a tool/result back to its tool/call (real harness shape: the result
  // carries no tool name, only message.source.callId). The store backfills
  // the name from the matching call; never persisted, never trusted blindly.
  callId?: string
  latencyMs?: number
  isError?: boolean
  tokens?: TokenUsage
  detail?: string
  traceId?: string
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

export function normalizeSignature(detail: string): string {
  return detail
    .replace(/\b0x[0-9a-f]+\b/gi, '#')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{4,}\b/gi, '#')
    .replace(/\b\d+\b/g, '#')
    .replace(/\/[^\s:]+\.(ts|js|mjs|go|py|php)/g, '#')
}

export function fromSessionEvent(session: unknown, event: unknown): TraceRecord | null {
  if (!session || typeof session !== 'object' || !event || typeof event !== 'object') return null
  const s = session as any
  const e = event as any
  // Real harness shape: ctx.on('session/event', (session, event) => ...)
  // with SessionEvent = { type, seq, time, data } and session.id.
  const sessionId = pick<string>(s, ['id'])
  const type = pick<string>(e, ['type'])
  if (!sessionId || !type) return null
  const data = e.data !== null && typeof e.data === 'object' ? e.data : {}
  const message = data.message !== null && typeof data.message === 'object' ? data.message : {}
  const source = message.source !== null && typeof message.source === 'object' ? message.source : {}
  const usage = data.usage !== null && typeof data.usage === 'object' ? data.usage : undefined
  const tokens: TokenUsage | undefined = usage ? {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  } : undefined
  const kind: TraceRecord['kind'] =
    type === 'turn/end' ? 'turn'
    : type === 'tool/call' || type === 'tool/result' ? 'tool'
    : 'step'
  const isError = type === 'tool/result' && ((data.message !== null && typeof data.message === 'object' && (data.message as any).isError === true) || data.error !== undefined)
  return {
    ts: typeof e.time === 'number' && Number.isFinite(e.time) ? e.time : Date.now(),
    kind,
    sessionId,
    tool: type === 'tool/call' || type === 'tool/result' ? pick<string>(data, ['name']) : undefined,
    callId: type === 'tool/call' || type === 'tool/result'
      ? pick<string>(data, ['callId']) ?? pick<string>(source, ['callId'])
      : undefined,
    latencyMs: undefined,
    isError: isError || undefined,
    tokens,
    detail: type === 'tool/result' && data.error !== undefined
      ? `tool error ${(data.error as any)?.name ?? ''} ${(data.error as any)?.code ?? ''}`.trim() || undefined
      : undefined,
    traceId: pick<string>(data, ['traceId', 'trace_id']),
  }
}

export function fromTelemetryRecord(record: unknown): TraceRecord | null {
  if (!record || typeof record !== 'object') return null
  const r = record as any
  // Real waterfall shape: ctx.waterfall('session-telemetry/record',
  // { channel, time, severity, attributes, body }, next).
  if (r.severity !== 'error') return null
  const attrs = r.attributes !== null && typeof r.attributes === 'object' ? r.attributes : {}
  const body = r.body !== null && typeof r.body === 'object' ? r.body : {}
  const detail = pick<string>(body, ['message', 'reason', 'detail'])
    ?? pick<string>(attrs, ['error.name', 'telemetry.op'])
    ?? 'error'
  return {
    ts: typeof r.time === 'number' && Number.isFinite(r.time) ? r.time : Date.now(),
    kind: 'error',
    sessionId: pick<string>(attrs, ['session.id']) ?? pick<string>(r, ['sessionId']),
    isError: true,
    detail: [detail, r.channel ? `channel:${r.channel}` : ''].filter(Boolean).join(' ') || 'error',
    traceId: pick<string>(body, ['traceId', 'trace_id']) ?? pick<string>(attrs, ['trace.id']) ?? pick<string>(r, ['traceId', 'trace_id']),
  }
}
