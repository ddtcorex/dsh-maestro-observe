# AGENTS.md — dsh-maestro-observe

> `CLAUDE.md` at the repo root is a symlink to `AGENTS.md`. Claude Code follows the same rule set as Codex CLI. Only edit `AGENTS.md` — never edit `CLAUDE.md` directly or replace the symlink with a copy.

## Purpose

Observability / debug-tooling plugin for the DeepSeek Harness (DSH): captures trace, cost, and health signals on the host, exposes them via a tool + RPC, and renders a client dashboard + readout.

Names by boundary: npm package = `@ddtcorex/dsh-maestro-observe`; Cordis patch row id = `maestro-observe`.

Part of the Maestro Harness suite. Host half + client half (dashboard rendered via slots).

## Layout

- `src/host/index.ts` — host `apply()`: installs listeners, registers the observe tool + RPC endpoints.
- `src/host/observe-store.ts` — ring buffer + daily aggregate + history (cost keyed by record `ts`, not `Date.now()`).
- `src/host/trace-record.ts` — trace-record reducers.
- `src/host/health.ts` — health report builder.
- `src/host/augment.d.ts` — local structural types (do NOT import from `deepseek-harness`).
- Client half (dashboard + readout) — browser side; registered in a queried slot.
- `tests/*.test.ts` — vitest suites: observe, observe-store, trace-record, health.

## Development

```sh
pnpm verify        # tsc --noEmit
pnpm test          # vitest run
pnpm build         # tsc -p tsconfig.json  -> lib/
pnpm build:client  # client bundle (dashboard)
```

`pnpm build` + `pnpm build:client` are required after source changes; commit refreshed artifacts.

## Git workflow

- Default branch `master`. No direct commits to `master` — use `feat/<topic>` / `fix/<topic>` and a PR.
- Conventional commits, imperative mood (`feat(observe): ...`, `fix(observe): ...`).
- One TDD task = one commit; never commit while `pnpm verify` is red.
- **Always request approval before merge or release:** never merge a PR/MR or publish a release (`git tag`/`pnpm publish`/`gh release`) without an explicit human approval — request review (`gh pr ready` / `gh pr request-review` / ask in chat) and wait for `APPROVED`. This applies to every `master` merge and every `vX.Y.Z` tag (see `docs/PUBLIC_REPO_CHECKLIST.md` §2/§8).

## Release

- Version bump follows semver (`package.json` `version` + `CHANGELOG.md` entry + `git tag vX.Y.Z` + `gh release create`).
- Publishing uses `pnpm publish --access public` via the reusable `ddtcorex/dsh-maestro-ci` release workflow — never `npm publish` directly.
- `CHANGELOG.md` is required for every release (Keep a Changelog + SemVer).

## Conventions

- **Host captures, client renders** — the host records signals and exposes them; the client only displays via slots. No business data crossing the wire beyond lossless JSON.
- **Cost keyed by record `ts`** — the day aggregate must key by the record's timestamp, not `Date.now()`, or per-day cost is wrong across multi-day history.
- **Queue recovery** — a poison record must not wedge the ring; recover/skip and keep the store consistent.
- **Serialized load** — load the store once and serialize access; avoid a read/write race on history.
- Every listener/tool/RPC is a reversible effect (`ctx.effect(..., label)`).

## Validation

`pnpm verify` + `pnpm test` + `pnpm build` + `pnpm build:client` green before any success claim. Runtime slot rendering is verified live on DSH Web (`:3080`), not just via contract tests.
