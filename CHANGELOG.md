# Changelog

All notable changes to this project are documented in this file. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/ddtcorex/dsh-maestro-observe/releases/tag/v0.2.0
[0.1.0]: https://github.com/ddtcorex/dsh-maestro-observe/releases/tag/v0.1.0
