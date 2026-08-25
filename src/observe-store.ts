import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CostAggregate, CostKey, TraceRecord } from './trace-record.js'

const RING_CAP = 200
const HISTORY_MAX_LINES = 10_000
const DAY = 86_400_000

function resolveHome(dshHome?: string): string {
  return dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
}
export function historyPath(dshHome?: string): string {
  return join(resolveHome(dshHome), 'dsh-maestro-observe', 'history.jsonl')
}
function emptyCost(): CostAggregate { return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, turns: 0 } }
function dayOf(ts: number): string { return new Date(ts).toISOString().slice(0, 10) }
function addCost(a: CostAggregate, r: TraceRecord): CostAggregate {
  if (!r.tokens) { if (r.kind === 'turn') return { ...a, turns: a.turns + 1 }; return a }
  return {
    inputTokens: a.inputTokens + (r.tokens.inputTokens ?? 0),
    outputTokens: a.outputTokens + (r.tokens.outputTokens ?? 0),
    cacheReadTokens: a.cacheReadTokens + (r.tokens.cacheReadTokens ?? 0),
    cacheWriteTokens: a.cacheWriteTokens + (r.tokens.cacheWriteTokens ?? 0),
    turns: a.turns + (r.kind === 'turn' ? 1 : 0),
  }
}

export class ObserveStore {
  private ring: TraceRecord[] = []
  private aggregates = new Map<string, CostAggregate>()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private dshHome?: string) {}

  get ringSize(): number { return this.ring.length }

  private key(k: CostKey): string {
    return k.scope === 'day' ? `day:${k.day}` : `session:${k.sessionId}:${dayOf(Date.now())}`
  }

  push(record: TraceRecord): Promise<void> {
    this.ring.unshift(record)
    if (this.ring.length > RING_CAP) this.ring.length = RING_CAP
    // F01: day aggregate keyed by record.ts, not Date.now()
    const dayAggKey = this.key({ scope: 'day', day: dayOf(record.ts) })
    this.aggregates.set(dayAggKey, addCost(this.aggregates.get(dayAggKey) ?? emptyCost(), record))
    if (record.sessionId) {
      const sessKey = this.key({ scope: 'session', sessionId: record.sessionId })
      this.aggregates.set(sessKey, addCost(this.aggregates.get(sessKey) ?? emptyCost(), record))
    }
    const line = JSON.stringify(record)
    // F02: catch poison so chain always recovers
    this.queue = this.queue.then(async () => {
      const p = historyPath(this.dshHome)
      await mkdir(dirname(p), { recursive: true, mode: 0o700 })
      let existing = ''
      try { existing = await readFile(p, 'utf-8') } catch {}
      const lines = existing ? existing.split('\n').filter(Boolean) : []
      lines.push(line)
      if (lines.length > HISTORY_MAX_LINES) {
        await writeFile(p + '.1', lines.slice(0, lines.length - HISTORY_MAX_LINES).join('\n') + '\n', { encoding: 'utf-8', mode: 0o600 })
        await writeFile(p, lines.slice(-HISTORY_MAX_LINES).join('\n') + '\n', { encoding: 'utf-8', mode: 0o600 })
      } else {
        await writeFile(p, lines.join('\n') + '\n', { encoding: 'utf-8', mode: 0o600 })
      }
      await chmod(p, 0o600).catch(() => {})
    }).catch(() => {})
    return this.queue.then(() => undefined)
  }

  trace(limit?: number): TraceRecord[] {
    const n = Math.max(1, Math.min(limit ?? RING_CAP, RING_CAP))
    return this.ring.slice(0, n)
  }

  cost(scope: 'day', day?: string): CostAggregate
  cost(scope: 'session', sessionId: string): CostAggregate
  cost(scope: 'day' | 'session', key?: string): CostAggregate {
    if (scope === 'session') {
      if (!key) return emptyCost()
      return this.aggregates.get(this.key({ scope: 'session', sessionId: key })) ?? emptyCost()
    }
    return this.aggregates.get(this.key({ scope: 'day', day: key ?? dayOf(Date.now()) })) ?? emptyCost()
  }

  async load(): Promise<void> {
    // F03: serialize whole load inside queue chain
    this.queue = this.queue.then(async () => {
      try {
        const text = await readFile(historyPath(this.dshHome), 'utf-8')
        const lines = text.split('\n').filter(Boolean)
        for (const line of lines.slice(-RING_CAP)) {
          try {
            const r = JSON.parse(line) as TraceRecord
            this.ring.unshift(r)
            const dayAggKey = this.key({ scope: 'day', day: dayOf(r.ts) })
            this.aggregates.set(dayAggKey, addCost(this.aggregates.get(dayAggKey) ?? emptyCost(), r))
            if (r.sessionId) {
              const sessKey = this.key({ scope: 'session', sessionId: r.sessionId })
              this.aggregates.set(sessKey, addCost(this.aggregates.get(sessKey) ?? emptyCost(), r))
            }
          } catch { /* skip malformed line */ }
        }
        this.ring.length = Math.min(this.ring.length, RING_CAP)
      } catch { /* no history yet */ }
    }).catch(() => {})
    await this.queue.catch(() => {})
  }

  async historyLines(): Promise<number> {
    try { return (await readFile(historyPath(this.dshHome), 'utf-8')).split('\n').filter(Boolean).length }
    catch { return 0 }
  }
}
