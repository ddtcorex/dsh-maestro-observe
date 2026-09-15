import type { CostAggregate } from './trace-record.js'

export interface DigestSnapshot {
  day: CostAggregate
  topTools: Array<{ key: string; agg: CostAggregate }>
  topSessions: Array<{ key: string; agg: CostAggregate }>
  overBudget: string[]
  errorCount: number
}

/** Structural view of the optional maestroNotifier service (mirrors the
 *  dsh-maestro-notifier contract without a compile-time dependency). */
export interface NotifierLike {
  ids?(): string[]
  send(providerId: string, target: Record<string, unknown>, message: { text: string }): Promise<{ sent: boolean; reason?: string }>
}

function fmt(n: number): string {
  return (n ?? 0).toLocaleString('en-US')
}

function total(a: CostAggregate): number {
  return a.inputTokens + a.outputTokens + a.cacheReadTokens + a.cacheWriteTokens
}

export function buildDigestText(s: DigestSnapshot): string {
  const lines = [
    `Observe daily: ${s.day.turns} turns · ${fmt(total(s.day))} tokens`,
  ]
  if (s.topTools.length > 0) {
    lines.push(`top tools: ${s.topTools.slice(0, 5).map((t) => `${t.key} ${fmt(total(t.agg))}`).join(', ')}`)
  }
  if (s.topSessions.length > 0) {
    lines.push(`top sessions: ${s.topSessions.slice(0, 5).map((t) => `${t.key} ${fmt(total(t.agg))}`).join(', ')}`)
  }
  for (const b of s.overBudget) lines.push(`over-budget: ${b}`)
  if (s.errorCount > 0) lines.push(`${s.errorCount} errors today`)
  return lines.join('\n')
}
