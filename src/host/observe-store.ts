import { chmodSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { CostAggregate, TraceRecord } from './trace-record.js'
import { normalizeSignature } from './trace-record.js'
import { redactDetail } from './redact.js'

// node:sqlite is loaded via createRequire: vite 5's static-import transform
// cannot resolve the node:sqlite specifier (ERR_LOAD_URL), while require()
// passes through to the node runtime untouched. Type-only import keeps tsc.
const { DatabaseSync: DatabaseSyncCtor }: { DatabaseSync: typeof DatabaseSync } =
  createRequire(import.meta.url)('node:sqlite')

const RING_CAP = 200
const SCHEMA_VERSION = 1

function resolveHome(dshHome?: string): string {
  return dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
}
export function historyPath(dshHome?: string): string {
  return join(resolveHome(dshHome), 'dsh-maestro-observe', 'observe.sqlite')
}
function legacyHistoryPath(dshHome?: string): string {
  return join(resolveHome(dshHome), 'dsh-maestro-observe', 'history.jsonl')
}
function emptyCost(): CostAggregate { return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, turns: 0 } }
function dayOf(ts: number): string { return new Date(ts).toISOString().slice(0, 10) }

const SUMS = `COALESCE(SUM(in_tok),0) AS inputTokens, COALESCE(SUM(out_tok),0) AS outputTokens, COALESCE(SUM(cache_r),0) AS cacheReadTokens, COALESCE(SUM(cache_w),0) AS cacheWriteTokens, COALESCE(SUM(CASE WHEN kind='turn' THEN 1 ELSE 0 END),0) AS turns`

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS traces(id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, kind TEXT NOT NULL, session_id TEXT, tool TEXT, latency_ms REAL, is_error INTEGER NOT NULL DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, cache_r INTEGER DEFAULT 0, cache_w INTEGER DEFAULT 0, detail TEXT, trace_id TEXT);
CREATE INDEX IF NOT EXISTS idx_traces_ts ON traces(ts);
CREATE INDEX IF NOT EXISTS idx_traces_session ON traces(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_traces_tool ON traces(tool, ts);
CREATE TABLE IF NOT EXISTS budgets(scope TEXT NOT NULL, key TEXT NOT NULL, limit_tokens INTEGER NOT NULL, window TEXT NOT NULL DEFAULT 'day', PRIMARY KEY(scope, key));
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);`

export type TraceFilter = { sessionId?: string; tool?: string; kind?: TraceRecord['kind']; since?: number }

export class ObserveStore {
  private ring: TraceRecord[] = []
  private db: DatabaseSync | null = null

  constructor(private dshHome?: string) {
    this.ensureDb()
  }

  get ringSize(): number { return this.ring.length }

  private ensureDb(): DatabaseSync | null {
    if (this.db) return this.db
    try {
      const p = historyPath(this.dshHome)
      mkdirSync(dirname(p), { recursive: true, mode: 0o700 })
      const db = new DatabaseSyncCtor(p)
      db.exec('PRAGMA journal_mode = WAL')
      db.exec(SCHEMA_SQL)
      const row = db.prepare(`SELECT v FROM meta WHERE k = 'schema_version'`).get() as { v?: string } | undefined
      if (!row) db.prepare(`INSERT INTO meta(k, v) VALUES ('schema_version', ?)`).run(String(SCHEMA_VERSION))
      this.db = db
      try { chmodSync(p, 0o600) } catch { /* best effort */ }
      return db
    } catch {
      this.db = null
      return null
    }
  }

  async push(record: TraceRecord): Promise<void> {
    const ts = Number.isFinite(record.ts) ? record.ts : Date.now()
    // Redact before anything else: ring and SQLite only ever hold the safe form.
    const stored: TraceRecord = { ...record, ts, detail: redactDetail(record.detail) }
    this.ring.unshift(stored)
    if (this.ring.length > RING_CAP) this.ring.length = RING_CAP
    const db = this.ensureDb()
    if (!db) return // degraded in-memory mode; ring still updated, next push retries open
    db.prepare(
      `INSERT INTO traces(ts, kind, session_id, tool, latency_ms, is_error, in_tok, out_tok, cache_r, cache_w, detail, trace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      stored.ts, stored.kind, stored.sessionId ?? null, stored.tool ?? null,
      stored.latencyMs ?? null, stored.isError ? 1 : 0,
      stored.tokens?.inputTokens ?? 0, stored.tokens?.outputTokens ?? 0,
      stored.tokens?.cacheReadTokens ?? 0, stored.tokens?.cacheWriteTokens ?? 0,
      stored.detail ?? null, stored.traceId ?? null,
    )
  }

  trace(limit?: number, filter?: TraceFilter): TraceRecord[] {
    const n = Math.max(1, Math.min(limit ?? RING_CAP, RING_CAP))
    const out: TraceRecord[] = []
    for (const r of this.ring) {
      if (filter?.sessionId !== undefined && r.sessionId !== filter.sessionId) continue
      if (filter?.tool !== undefined && r.tool !== filter.tool) continue
      if (filter?.kind !== undefined && r.kind !== filter.kind) continue
      if (filter?.since !== undefined && !(r.ts >= filter.since)) continue
      out.push(r)
      if (out.length >= n) break
    }
    return out
  }

  private sumRow(where: string, ...params: Array<string | number | null>): CostAggregate {
    const db = this.ensureDb()
    if (!db) return emptyCost()
    const row = db.prepare(`SELECT ${SUMS} FROM traces WHERE ${where}`).get(...params) as CostAggregate | undefined
    return row ?? emptyCost()
  }

  cost(scope: 'day', day?: string): CostAggregate
  cost(scope: 'session', sessionId: string): CostAggregate
  cost(scope: 'day' | 'session', key?: string): CostAggregate {
    if (scope === 'session') {
      if (!key) return emptyCost()
      // Session scope is lifetime for the session (keyed by each record's own ts).
      return this.sumRow(`session_id = ?`, key)
    }
    const day = key ?? dayOf(Date.now())
    return this.sumRow(`date(ts / 1000, 'unixepoch') = ?`, day)
  }

  costGrouped(groupBy: 'tool' | 'session', since?: number): Array<{ key: string; agg: CostAggregate }> {
    const db = this.ensureDb()
    if (!db) return []
    const col = groupBy === 'tool' ? 'tool' : 'session_id'
    const rows = db.prepare(
      `SELECT ${col} AS key, ${SUMS} FROM traces WHERE ts >= ? AND ${col} IS NOT NULL GROUP BY ${col}`,
    ).all(since ?? 0) as unknown as Array<{ key: string } & CostAggregate>
    return rows.map((r) => ({
      key: r.key,
      agg: { inputTokens: r.inputTokens, outputTokens: r.outputTokens, cacheReadTokens: r.cacheReadTokens, cacheWriteTokens: r.cacheWriteTokens, turns: r.turns },
    }))
  }

  configGet(key: string): string | undefined {
    const db = this.ensureDb()
    if (!db) return undefined
    const row = db.prepare(`SELECT v FROM meta WHERE k = ?`).get(key) as { v?: string } | undefined
    return row?.v
  }

  configSet(key: string, value: string): void {
    const db = this.ensureDb()
    if (!db) return
    db.prepare(`INSERT INTO meta(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`).run(key, value)
  }

  budgetSet(scope: 'day' | 'session', key: string, limitTokens: number): void {
    const db = this.ensureDb()
    if (!db) return
    db.prepare(`INSERT INTO budgets(scope, key, limit_tokens) VALUES (?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET limit_tokens = excluded.limit_tokens`).run(scope, key, limitTokens)
  }

  budgetCheck(scope: 'day' | 'session', key: string): { spent: number; limit: number; pct: number; over: boolean } {
    const agg = scope === 'session' ? this.cost('session', key) : this.cost('day', key)
    const spent = agg.inputTokens + agg.outputTokens + agg.cacheReadTokens + agg.cacheWriteTokens
    const db = this.ensureDb()
    const row = db?.prepare(`SELECT limit_tokens AS limitTokens FROM budgets WHERE scope = ? AND key = ?`).get(scope, key) as { limitTokens?: number } | undefined
    const limit = row?.limitTokens ?? 0
    return { spent, limit, pct: limit > 0 ? spent / limit : 0, over: limit > 0 && spent > limit }
  }

  listBudgets(): Array<{ scope: string; key: string; limitTokens: number }> {
    const db = this.ensureDb()
    if (!db) return []
    return db.prepare(`SELECT scope, key, limit_tokens AS limitTokens FROM budgets`).all() as unknown as Array<{ scope: string; key: string; limitTokens: number }>
  }

  errorsGrouped(tool?: string, since?: number): Array<{ tool: string; signature: string; count: number; firstTs: number; lastTs: number; exampleSession?: string }> {
    const db = this.ensureDb()
    if (!db) return []
    const rows = db.prepare(
      `SELECT tool, detail, ts, session_id AS sessionId FROM traces WHERE is_error = 1 AND ts >= ? ${tool !== undefined ? 'AND tool = ?' : ''} ORDER BY ts DESC LIMIT 2000`,
    ).all(...(tool !== undefined ? [since ?? 0, tool] : [since ?? 0])) as Array<{ tool: string | null; detail: string | null; ts: number; sessionId: string | null }>
    const groups = new Map<string, { tool: string; signature: string; count: number; firstTs: number; lastTs: number; exampleSession?: string }>()
    for (const r of rows) {
      const signature = normalizeSignature(r.detail ?? '')
      const k = `${r.tool ?? ''}\n${signature}`
      const g = groups.get(k)
      if (!g) groups.set(k, { tool: r.tool ?? '', signature, count: 1, firstTs: r.ts, lastTs: r.ts, exampleSession: r.sessionId ?? undefined })
      else {
        g.count += 1
        if (r.ts < g.firstTs) g.firstTs = r.ts
        if (r.ts > g.lastTs) g.lastTs = r.ts
      }
    }
    return [...groups.values()]
  }

  latencyPercentiles(tool?: string, since?: number): { count: number; p50: number; p95: number; p99: number } {
    const db = this.ensureDb()
    if (!db) return { count: 0, p50: 0, p95: 0, p99: 0 }
    const rows = db.prepare(
      `SELECT latency_ms AS lat FROM traces WHERE latency_ms IS NOT NULL AND ts >= ? ${tool !== undefined ? 'AND tool = ?' : ''} ORDER BY latency_ms LIMIT 5000`,
    ).all(...(tool !== undefined ? [since ?? 0, tool] : [since ?? 0])) as Array<{ lat: number }>
    if (rows.length === 0) return { count: 0, p50: 0, p95: 0, p99: 0 }
    const at = (p: number): number => rows[Math.min(rows.length - 1, Math.ceil((p / 100) * rows.length) - 1)].lat
    return { count: rows.length, p50: at(50), p95: at(95), p99: at(99) }
  }

  errorCountSince(since: number): number {
    const db = this.ensureDb()
    if (!db) return 0
    const row = db.prepare(`SELECT COUNT(*) AS n FROM traces WHERE is_error = 1 AND ts >= ?`).get(since) as { n?: number } | undefined
    return row?.n ?? 0
  }

  async load(): Promise<void> {
    const db = this.ensureDb()
    if (!db) return
    const done = db.prepare(`SELECT v FROM meta WHERE k = 'legacy_import_done'`).get() as { v?: string } | undefined
    if (!done) {
      try {
        const text = await readFile(legacyHistoryPath(this.dshHome), 'utf-8')
        const insert = db.prepare(
          `INSERT INTO traces(ts, kind, session_id, tool, latency_ms, is_error, in_tok, out_tok, cache_r, cache_w, detail, trace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        for (const line of text.split('\n').filter(Boolean)) {
          try {
            const r = JSON.parse(line) as TraceRecord
            insert.run(
              r.ts, r.kind, r.sessionId ?? null, r.tool ?? null, r.latencyMs ?? null,
              r.isError ? 1 : 0, r.tokens?.inputTokens ?? 0, r.tokens?.outputTokens ?? 0,
              r.tokens?.cacheReadTokens ?? 0, r.tokens?.cacheWriteTokens ?? 0, r.detail ?? null,
              (r as TraceRecord).traceId ?? null,
            )
          } catch { /* skip malformed line */ }
        }
      } catch { /* no legacy history */ }
      db.prepare(`INSERT INTO meta(k, v) VALUES ('legacy_import_done', '1') ON CONFLICT(k) DO NOTHING`).run()
    }
    const rows = db.prepare(
      `SELECT ts, kind, session_id AS sessionId, tool, latency_ms AS latencyMs, is_error AS isError, in_tok, out_tok, cache_r, cache_w, detail, trace_id AS traceId FROM traces ORDER BY id DESC LIMIT ?`,
    ).all(RING_CAP) as Array<any>
    this.ring = rows.map((r) => ({
      ts: r.ts, kind: r.kind, sessionId: r.sessionId ?? undefined, tool: r.tool ?? undefined,
      latencyMs: r.latencyMs ?? undefined, isError: r.isError === 1,
      tokens: { inputTokens: r.in_tok, outputTokens: r.out_tok, cacheReadTokens: r.cache_r, cacheWriteTokens: r.cache_w },
      detail: r.detail ?? undefined, traceId: r.traceId ?? undefined,
    }))
  }

  async historyLines(): Promise<number> {
    const db = this.ensureDb()
    if (!db) return 0
    const row = db.prepare(`SELECT COUNT(*) AS n FROM traces`).get() as { n?: number } | undefined
    return row?.n ?? 0
  }

  purgeBefore(cutoffTs: number): number {
    this.ring = this.ring.filter((r) => r.ts >= cutoffTs)
    const db = this.ensureDb()
    if (!db) return 0
    const res = db.prepare(`DELETE FROM traces WHERE ts < ?`).run(cutoffTs) as { changes?: number } | undefined
    return res?.changes ?? 0
  }

  vacuum(): void {
    try { this.ensureDb()?.exec('VACUUM') } catch { /* best effort */ }
  }
}
