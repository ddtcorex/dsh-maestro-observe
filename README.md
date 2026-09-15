# dsh-maestro-observe

Maestro observe — trace/health/cost debug tooling (Phase 3)

> DSH Maestro plugin — part of the `dsh-maestro-*` ecosystem (`@ddtcorex/dsh-maestro-observe`).

Local-first observability for the Maestro plugin stack. The host records
turn/tool/error signals into a queryable SQLite store
(`~/.dsh/dsh-maestro-observe/observe.sqlite`, `0600`) and exposes them through
the `maestro-observe` tool and the `/dsh-maestro-observe` loopback RPC.
Rendering lives in `dsh-maestro-dashboard` (Activity tab), which calls the RPC
below — this package ships no client UI. Telegram digests and spike alerts are
delivered through the optional `maestroNotifier` service — the plugin works
fully without it.

## Install

```sh
dsh plugin add @ddtcorex/dsh-maestro-observe
```

## Tool / RPC ops

Ops are mirrored on the tool (`op`) and the RPC (endpoint name); unknown
ops/endpoints fail closed.

- `trace { limit?, sessionId?, tool?, kind?, since? }` — newest-first records.
- `cost { scope: 'day'|'session', sessionId?, day?, groupBy?: 'tool'|'session' }`
  (`day` selects an explicit UTC day; `groupBy` without `since` is lifetime).
- `budget { action: 'set'|'check', scope, key, limit_tokens? }` — token budgets.
- `config { action: 'get'|'set', key, value? }` — operational knobs.
- `errors { tool?, since? }` — grouped by tool + normalized signature.
- `latency { tool?, since? }` — `{ count, p50, p95, p99 }` latencyMs.
- `health {}` — plugins, tool count, per-channel status, deduped degraded list.
- `status` (RPC only) — uptime, version, ring size, row count.

## RPC calling convention (for dashboard and other consumers)

The Connection transport requires endpoint dispatch plus the carrier shape —
`rpc.call(channel, endpoint, payload)` returns
`{ ok: true, value } | { ok: false, error: { code, message, details } }`.
The server rejects anything else, so clients that send a single `{ method }`
object or skip the carrier unwrap fail silently. Unwrap with
`res?.ok ? res.value : null`. Absent observe plugin → call rejects: hide
dependent UI instead of rendering zeros.

## Config keys (`config` op)

| key | default | meaning |
|---|---|---|
| `retention_days` | `30` | trace retention for the daily purge |
| `detail_max_chars` | `500` | detail truncation length applied by the redact pipeline |
| `digest_schedule` | `08:00` | local `HH:MM` for the daily Telegram digest |
| `spike_n` / `spike_m` | `10` / `5` | alert after N errors within M minutes |
| `telegram.botToken` / `telegram.chatId` | — | Telegram target for digest + spike alerts |

Secrets in trace details are redacted before persist (secret shapes →
`[redacted]`, detail truncated). Session cost is session-lifetime; day cost,
digest windows, and retention cutoffs are per UTC day (the digest *fire time*
is local `HH:MM`).

## Telegram setup

1. Install `@ddtcorex/dsh-maestro-notifier` (provides `maestroNotifier`).
2. `config set telegram.botToken <token>`, `config set telegram.chatId <id>`
   (or the `budget`/`config` tool ops).
3. The daily digest fires at `digest_schedule`; spike alerts fire on the
   error-rate threshold. Without the notifier both stay silent and log a
   warning — nothing throws.

## Develop

```sh
pnpm verify        # tsc --noEmit
pnpm test          # vitest run
pnpm build         # tsc -p tsconfig.json  -> lib/
```
