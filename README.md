# dsh-maestro-observe

Maestro observe — trace/health/cost debug tooling (Phase 3)

> DSH Maestro plugin — part of the `dsh-maestro-*` ecosystem (`@ddtcorex/dsh-maestro-observe`).

Local-first observability for the Maestro plugin stack. The host records
turn/tool/error signals into a queryable SQLite store
(`~/.dsh/dsh-maestro-observe/observe.sqlite`, `0600`), exposes them through the
`maestro-observe` tool and the `/dsh-maestro-observe` loopback RPC, and renders
a tabbed Settings dashboard (Cost / Errors / Latency / Health) plus a composer
readout. Telegram digests and spike alerts are delivered through the optional
`maestroNotifier` service — the plugin works fully without it.

## Install

```sh
dsh plugin add @ddtcorex/dsh-maestro-observe
```

## Tool / RPC ops

Ops are mirrored on the tool (`op`) and the RPC (`method`); unknown ops fail
closed (`{ ok: false }`).

- `trace { limit?, sessionId?, tool?, kind?, since? }` — newest-first records.
- `cost { scope: 'day'|'session', sessionId?, groupBy?: 'tool'|'session' }`.
- `budget { action: 'set'|'check', scope, key, limit_tokens? }` — token budgets.
- `config { action: 'get'|'set', key, value? }` — operational knobs.
- `errors { tool?, since? }` — grouped by tool + normalized signature.
- `latency { tool?, since? }` — `{ count, p50, p95, p99 }` latencyMs.
- `health {}` — plugins, tool count, per-channel status, deduped degraded list.
- `status` (RPC only) — uptime, version, ring size, row count.

## Config keys (`config` op)

| key | default | meaning |
|---|---|---|
| `retention_days` | `30` | trace retention for the daily purge |
| `detail_max_chars` | `500` | (reserved) detail truncation length |
| `digest_schedule` | `08:00` | local `HH:MM` for the daily Telegram digest |
| `spike_n` / `spike_m` | `10` / `5` | alert after N errors within M minutes |
| `telegram.botToken` / `telegram.chatId` | — | Telegram target for digest + spike alerts |

Secrets in trace details are redacted before persist (secret shapes →
`[redacted]`, detail truncated). Session cost is session-lifetime; day cost is
per UTC day.

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
pnpm build:client  # esbuild client/index.jsx -> lib/client.js
```
