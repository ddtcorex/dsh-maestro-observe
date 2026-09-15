import '@deepseek-ai/cordis'

export interface ObserveSessionLike {
  id?: string
}

export interface ObserveSessionEventLike {
  type?: string
  seq?: number
  time?: number
  data?: any
}

export interface ObserveTelemetryRecordLike {
  channel?: string
  time?: number
  severity?: string
  attributes?: Record<string, any>
  body?: any
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    startedAt?: number
  }
  interface Events {
    'session/event'(session: ObserveSessionLike, event: ObserveSessionEventLike): void
    'session-telemetry/record'(record: ObserveTelemetryRecordLike, next: (r: any) => any): any
  }
}
