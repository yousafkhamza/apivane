# ApiVane — project guide for Claude Code

Free, self-hosted API client + CI test runner with built-in security checks and optional AI.
Public UI on GitHub Pages; private use via `npx apivane` or Docker (one command).
Author: Yousaf Hamza (github.com/yousafkhamza). Credit "By Yousaf Hamza" in UI footer and README.

## Credit-saving rules (follow every session)
- Start by reading `docs/PROGRESS.md`. Work ONLY on the current phase / task named there.
- Read `docs/SPEC.md` only for the section the task needs (use the headings), not the whole file.
- Never read or search: `node_modules`, `dist`, `build`, `coverage`, `package-lock.json`, `*.min.*`, `.git`.
- Don't explore the whole repo. Use targeted search for the files you need.
- No unrequested refactors, renames, reformatting or "improvements" outside the task.
- Ask before adding any dependency. Prefer platform/stdlib APIs (fetch, URL, crypto, node:http).
- Don't print whole files back to me. Summarize changes in at most 5 bullets.
- If a task is ambiguous, ask one short question instead of guessing big.
- End of every task: run typecheck + tests for touched packages, tick items in `docs/PROGRESS.md`,
  and add 1–3 lines under "Session notes" so the next session needs no re-exploration.

## Stack
- ZERO npm dependencies (decided 2026-11-26: no lockfile/install failures in CI). Plain ESM JavaScript + JSDoc, Node 22+.
- `packages/core/src` — YAML subset, request model + interpolation, tests/captures, security rules, importers, .apivane file mapping.
  Pure functions; no DOM and no Node-only APIs. Shared by web, cli and tests.
- `packages/web` — plain ES modules, no bundler. `index.html`, `styles.css`, `src/` (state, store, engines, ui/*). Imports core as `../core/`.
- `packages/extension/src` — MV3 background + content-script bridge; `scripts/build.mjs` generates chrome + firefox manifests and zips.
- `packages/cli` — npm package `apivane`: `serve` (agent), `run` (CI runner), `init`. Build copies core → `cli/core`, site → `cli/web`.
- Tests: `node:test` in `test/*.test.mjs`; Playwright e2e in `test/e2e` (installed only in CI, pinned in ci.yml).
- `scripts/check.mjs` verifies every import/named export, CSP, precache list, manifests — run it after any change.
- Must work on Windows, macOS and Linux: no bash-only npm scripts, use `node:path`.
- Node is NOT installed on the author's laptop and Defender blocks new binaries: CI is the test runner.

## Commands
```
npm run build      # dist/, dist-ext/, cli bundle (SITE_URL env for custom domain)
npm run check
npm test           # build + node:test
npm run serve      # preview dist/ on :4173
npm run agent      # local agent from source
npm run e2e        # needs: npm i --no-save @playwright/test@1.49.1
```

## Conventions
- Small files (under ~300 lines), named exports, default exports only for React pages.
- I/O lives only in `cli` and in web adapters; `core` stays pure and unit-tested.
- Collections are plain YAML files in `.apivane/` (one request per file) so they diff cleanly in git.
- Never log secrets; mask variables marked `secret: true` everywhere (UI, logs, reports).
- Conventional commits (`feat:`, `fix:`, `chore:`). Don't commit or push unless I ask.

## Agent security (non-negotiable)
- Bind `127.0.0.1` only, never `0.0.0.0` (Docker image documents `-p 127.0.0.1:7878:7878`).
- Random token per start, printed in the terminal; every API call must send it.
- Origin allowlist: the agent's own origin + the GitHub Pages origin. Answer Private Network Access
  preflights (`Access-Control-Allow-Private-Network: true`) only for allowed origins.
- File access limited to the project's `.apivane/` folder (resolve + check paths, block `..`).
