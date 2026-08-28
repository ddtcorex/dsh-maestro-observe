import '@deepseek-ai/cordis'

export interface ObserveSessionEventLike {
  session?: { id?: string }
  event?: string
  kind?: string
  tokens?: any
  usage?: any
  tool?: string
  toolName?: string
  name?: string
  latencyMs?: number
  durationMs?: number
  isError?: boolean
  error?: boolean
  ts?: number
  timestamp?: number
  detail?: string
  message?: string
  reason?: string
}

export interface ObserveTelemetryRecordLike {
  severity?: string
  channel?: string
  reason?: string
  message?: string
  ts?: number
  sessionId?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    startedAt?: number
  }
  interface Events {
    'session/event'(payload: ObserveSessionEventLike): void
    'session-telemetry/record'(record: ObserveTelemetryRecordLike, next: (r: any) => any): any
  }
}
