import type { CostAggregate } from './trace-record.js'

export interface DigestToolStat {
  key: string
  calls: number
  agg: CostAggregate
}
export interface DigestSessionStat {
  key: string
  agg: CostAggregate
}
export interface DigestErrorStat {
  tool: string
  signature: string
  count: number
}
export interface DigestLatencyStat {
  count: number
  p50: number
  p95: number
}
export interface DigestBudgetStatus {
  scope: string
  key: string
  spent: number
  limit: number
  over: boolean
}

export interface DigestSnapshot {
  /** UTC day label (YYYY-MM-DD) this digest covers. */
  dayLabel: string
  /** Cost bucket for the current UTC day (partial until midnight UTC). */
  day: CostAggregate
  /** Previous full UTC day for context; omitted when unknown. */
  prevDay?: { label: string; agg: CostAggregate }
  /** Tools ranked by call count (token sums on tool rows are always zero). */
  topTools: DigestToolStat[]
  /** Sessions ranked by total tokens. */
  topSessions: DigestSessionStat[]
  /** Error groups ranked by count. */
  topErrors: DigestErrorStat[]
  /** Tool latency percentiles; omitted when there are no samples. */
  latency?: DigestLatencyStat
  /** Every configured budget with its spend; only over ones render. */
  budgets: DigestBudgetStatus[]
  errorCount: number
}

/** Structural view of the optional maestroNotifier service (mirrors the
 *  dsh-maestro-notifier contract without a compile-time dependency). */
export interface NotifierLike {
  ids?(): string[]
  send(providerId: string, target: Record<string, unknown>, message: { text: string }): Promise<{ sent: boolean; reason?: string }>
}

/** Escape dynamic text for the Telegram HTML parse mode. The notifier sends
 *  with parse_mode HTML, so a raw < & " in a tool name, session id or error
 *  signature would break rendering of the whole message. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmt(n: number): string {
  return (n ?? 0).toLocaleString('en-US')
}

/** Billable tokens (input + output). Cache reads dominate the raw total and
 *  are reported separately so the headline number stays meaningful. */
function billed(a: CostAggregate): number {
  return a.inputTokens + a.outputTokens
}

export function total(a: CostAggregate): number {
  return a.inputTokens + a.outputTokens + a.cacheReadTokens + a.cacheWriteTokens
}

function shortId(id: string): string {
  // Session ids are shaped session-<uuid>; the literal prefix carries no
  // information, so shorten the uuid part (first 8 hex chars).
  const bare = id.startsWith('session-') ? id.slice('session-'.length) : id
  return bare.length <= 12 ? bare : bare.slice(0, 8)
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return `${t.slice(0, n - 1).trimEnd()}…`
}

function turns(n: number): string {
  return `${fmt(n)} turn${n === 1 ? '' : 's'}`
}

function usageLine(agg: CostAggregate): string {
  const parts = [
    turns(agg.turns),
    `${fmt(billed(agg))} billed (in ${fmt(agg.inputTokens)} + out ${fmt(agg.outputTokens)})`,
  ]
  const cached = agg.cacheReadTokens + agg.cacheWriteTokens
  if (cached > 0) parts.push(`${fmt(cached)} cache`)
  return parts.join(' · ')
}

export function buildDigestText(s: DigestSnapshot): string {
  const lines = [
    `<b>🤖 Maestro Observe</b> — daily digest <code>${escapeHtml(s.dayLabel)}</code>`,
    `<b>Usage today (UTC):</b> ${usageLine(s.day)}`,
  ]
  if (s.prevDay) {
    lines.push(`<b>Yesterday:</b> ${usageLine(s.prevDay.agg)}`)
  }
  if (s.topTools.length > 0) {
    lines.push(`<b>Top tools:</b> ${s.topTools.slice(0, 5).map((t) => `<code>${escapeHtml(t.key)}</code> ×${fmt(t.calls)}`).join(' · ')}`)
  }
  if (s.topSessions.length > 0) {
    lines.push(`<b>Sessions:</b> ${s.topSessions.slice(0, 5).map((t) => `<code>${escapeHtml(shortId(t.key))}</code> ${fmt(billed(t.agg))} billed (${turns(t.agg.turns)})`).join(' · ')}`)
  }
  if (s.errorCount > 0) {
    const groups = s.topErrors.slice(0, 5).map((g) => {
      const tool = g.tool !== '' ? `<code>${escapeHtml(g.tool)}</code> ` : ''
      return `${tool}${escapeHtml(truncate(g.signature, 120))} ×${fmt(g.count)}`
    })
    lines.push(`<b>Errors:</b> ${fmt(s.errorCount)}${groups.length > 0 ? ` — ${groups.join(' · ')}` : ''}`)
  } else {
    lines.push(`✅ no errors`)
  }
  if (s.latency !== undefined && s.latency.count > 0) {
    lines.push(`<b>Latency:</b> n=${fmt(s.latency.count)} p50=${fmt(Math.round(s.latency.p50))}ms p95=${fmt(Math.round(s.latency.p95))}ms`)
  }
  for (const b of s.budgets.filter((b) => b.over)) {
    lines.push(`⚠️ over-budget: <code>${escapeHtml(b.scope)}:${escapeHtml(b.key)}</code> ${fmt(b.spent)}/${fmt(b.limit)}`)
  }
  return lines.join('\n')
}
