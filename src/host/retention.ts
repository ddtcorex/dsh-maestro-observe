import type { ObserveStore } from './observe-store.js'

const DAY_MS = 86_400_000

/** Delete traces older than retentionDays and VACUUM weekly. Returns rows deleted. */
export async function purgeOld(store: ObserveStore, nowMs: number, retentionDays: number): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0
  const deleted = store.purgeBefore(nowMs - retentionDays * DAY_MS)
  const lastVacuum = Number(store.configGet('last_vacuum_ts') ?? '0')
  if (!Number.isFinite(lastVacuum) || nowMs - lastVacuum > 7 * DAY_MS) {
    store.vacuum()
    store.configSet('last_vacuum_ts', String(nowMs))
  }
  return deleted
}
