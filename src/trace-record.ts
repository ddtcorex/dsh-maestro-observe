// Task 2 types — single source of truth for TraceRecord, CostAggregate, CostKey, TokenUsage
// Task 1 observe-store imports these; reducers completed in Task 2

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
