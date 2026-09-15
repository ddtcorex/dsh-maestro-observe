# Changelog

All notable changes to this project are documented in this file. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- **Settings UI + composer readout** — rendering moved to
  `dsh-maestro-dashboard` (Activity tab) calling the loopback RPC; this package
  is host-only now (no client bundle, no `dsh.client` manifest).

### Fixed

- RPC migrated to endpoint dispatch with the `{ ok, value }` carrier shape
  (single-`{ method }` calls failed silently against `serverResponseSchema`).

## [0.3.0] - 2026-09-15

### Added

- **SQLite store** — `ObserveStore` persists to local `observe.sqlite` (WAL);
  aggregates are SQL `GROUP BY` (no more 200-row tail limits); one-shot legacy
  JSONL import; idempotent `load()`; 30-day retention purge + weekly VACUUM.
- **Budgets + config ops** — `budget set|check`, `config get|set` on tool and RPC.
- **Grouped cost** — `cost … groupBy: tool|session`.
- **Error tracking** — `errors` grouped by tool + normalized signature;
  configurable Telegram spike alerts (`spike_n`/`spike_m`).
- **Latency** — `latency` op with p50/p95/p99 per tool.
- **Health v2** — dynamic channel discovery, deduped degraded list, uptime
  persisted across restarts, clearable ping timeouts.
- **Telegram digest** — daily cost digest via the optional `maestroNotifier`
  service (absent notifier degrades to a warning, never throws).
- **Privacy** — secret shapes redacted and detail truncated before persist.
- **Client** — tabbed Cost/Errors/Latency/Health dashboard with DSW tokens;
  real `build:client` (esbuild → `lib/client.js`); patch row carries
  `channel` + `inject`.

### Fixed

- Tool schema fields optional with defaults (`trace`/`health`/`cost-day`
  callable bare); `VERSION` read from `package.json` (drift-proof).
- Session cost keyed by record day (was `Date.now()`); telemetry listener
  guards a missing `next` callback.

## [0.2.1] - 2026-09-02

### Changed

- Bump dsh-maestro-ci pin to e2448b1 (#8), sync community files and CHANGELOG (#7), unify release via reusable node-release (#6).


## [0.2.0] - 2026-08-27

Degraded-health release — health report now surfaces degraded status and the
dashboard renders it; package version bumped to `0.2.0` (`v0.2.0` tag).

### Added

- **Health `degraded` flag** exposed via `buildHealthReport` and the observe
  tool/RPC `health` op, and rendered in the client dashboard/readout
  (`feat(observe): expose degraded in health and dashboard` #4).

### Changed

- `package.json` version `0.1.0` → `0.2.0`.

### Notes

- `src/host/index.ts` health version now matches `package.json` (`0.2.0`) —
  fixes stale `VERSION = '0.1.0'` diverge noted in audit §7.
- CI unified via reusable `ddtcorex/dsh-maestro-ci` `node-plugin.yml` /
  `node-release.yml` (`ci: unify release via reusable node-release`).

## [0.1.0] - 2026-08-25

Initial development of `@ddtcorex/dsh-maestro-observe` — observability /
debug-tooling plugin for the DeepSeek Harness (trace/health/cost).

### Added

- **ObserveStore** — ring buffer + daily aggregate + history (cost keyed by
  record `ts`, not `Date.now()`).
- **Trace-record reducers** (`fromSessionEvent`, `fromTelemetryRecord`).
- **Health report builder** (`buildHealthReport`).
- **Host listeners + tool + RPC** — `maestro-observe` tool (`trace`/`health`/`cost`),
  `session/event` and `session-telemetry/record` listeners, and
  `/dsh-maestro-observe` RPC (`status`/`trace`/`cost`/`health`).
- **Client dashboard + readout** (browser slot UI).
- **Cost session guard** — `scope: 'session'` requires `sessionId` (# fix).
- **Community files** — `AGENTS.md` + `CLAUDE.md` symlink, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `.github/CODEOWNERS`, PR template, issue templates;
  `package.json` `private: false`, `pnpm-workspace.yaml` `allowBuilds.esbuild: true`,
  `tsconfig.json` `rootDir: src/host` → `lib/index.js` flat.
- **CI** — `.github/workflows/ci.yml` calling `ddtcorex/dsh-maestro-ci`
  `node-plugin.yml` (pinned SHA), `pnpm@11.7.0`.

[0.3.0]: https://github.com/ddtcorex/dsh-maestro-observe/releases/tag/v0.3.0
[0.2.0]: https://github.com/ddtcorex/dsh-maestro-observe/releases/tag/v0.2.0
[0.1.0]: https://github.com/ddtcorex/dsh-maestro-observe/releases/tag/v0.1.0
