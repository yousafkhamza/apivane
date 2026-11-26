# Progress

Current phase: **v0.1 built — waiting for first CI run** (nothing has been executed locally; no Node on the dev laptop)

## Done in v0.1 (2026-11-26)
- [x] Zero-dependency monorepo: packages/core, web, extension, cli; scripts/build, check, serve, zip
- [x] core: YAML subset, interpolation, auth (bearer/basic/api key/inherit), bodies (json/form/text), tests, captures, SEC001–SEC003, SEC005–SEC008, cURL import/export, Postman v2.1 import, .apivane files ⇄ workspace
- [x] web: library/vars/history, tabs, request editor (params, headers, body, auth, tests, captures, YAML preview), response (pretty/raw, headers, tests, security, timing), error cards with fixes
- [x] web: browser-only persistence (IndexedDB) — autosave or manual save + recovery draft + restore banner; export/import backup (secrets excluded by default)
- [x] web: first-run walkthrough (splash, 6 steps, Skip, once), theme follows device, PWA install button + service worker, sample public APIs
- [x] web: engines — browser, extension (postMessage bridge), local agent (token, #token handoff, Save to repo / Load)
- [x] extension: MV3 Chrome/Edge + Firefox builds, URL-prefix sender check, request validation, credentials omitted
- [x] cli: agent (loopback, token, Host + Origin allowlist, PNA, safe paths, serves UI), `run` (env ${env:X}, captures, bail, fail-on, cli/junit/json/markdown + job summary), `init`
- [x] CI: build, check, node:test, CLI smoke, Playwright (chromium, mobile, firefox), web-ext lint, Pages deploy after tests; release: npm provenance, GHCR multi-arch, GitHub release with extension zips; action.yml; Dockerfile
- [x] README, PRIVACY, LICENSE, SEO (meta, OG image, JSON-LD, sitemap, robots)

## Next
- [ ] First push → fix anything CI finds (riskiest: e2e selectors/timing, Firefox route+CORS, web-ext lint warnings)
- [ ] OpenAPI 3.x import; OAuth2 client credentials; SEC004 (auth-bypass replay, CI only)
- [ ] Store listings: Chrome Web Store, Edge Add-ons, AMO (screenshots + PRIVACY.md)
- [ ] AI helper (SPEC §8), GraphQL/WebSocket later

## Session notes
<!-- Newest first. 1–3 lines per session: what changed, anything the next session must know. -->
- 2026-11-26: Built v0.1 in one pass with zero deps (stack changed from React/Vite/TS — see CLAUDE.md). Design reference: design/demo.html. First CI run is the first real test; fix from logs.
