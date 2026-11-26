# ApiVane — Specification

Read only the section you need.

## 1. Positioning
"API security tests in your pipeline — free and self-hosted."
Not a Postman clone: an API client whose collections live in git, run in CI via a GitHub Action,
with security checks built in and an optional AI helper. Target: small teams and startups who
don't want to pay for cloud sync or seats.

## 2. Modes
| Mode | How | Notes |
|---|---|---|
| Public demo | GitHub Pages UI | Requests go through the local agent if running; otherwise only CORS-enabled APIs work (show a clear banner explaining this). Collections in IndexedDB. |
| Extension | Chrome / Edge / Firefox add-on | Pages UI sends requests through the extension: no CORS limit, all response headers visible, per-host permission. |
| Local | `npx apivane` | Agent serves the UI + proxy, reads/writes `.apivane/` in the current folder. Opens browser. |
| Docker | `docker run -p 127.0.0.1:7878:7878 -v ${PWD}:/work ghcr.io/yousafkhamza/apivane` | Same as local. |
| CI | `npx apivane run` or the GitHub Action | Headless, exit code + reports. |

## 3. Collection file format (`.apivane/`)
```
.apivane/
  apivane.yaml            # collection name, defaults, baseUrl var
  environments/
    dev.yaml
    staging.yaml           # secrets as ${env:STAGING_TOKEN} references, never literal
  requests/
    users/
      list-users.yaml
      create-user.yaml
```
Request file:
```yaml
name: Create user
method: POST
url: "{{baseUrl}}/users"
headers:
  Authorization: "Bearer {{token}}"
body:
  type: json            # json | form | multipart | text | none
  content: { "name": "Yousaf" }
auth: inherit           # inherit | none | bearer | basic | apikey | oauth2-client-credentials
tests:
  - status: 201
  - jsonpath: "$.id"
    exists: true
  - header: content-type
    contains: application/json
  - maxDurationMs: 800
capture:
  userId: "$.id"        # saved into run variables for later requests
security: default       # default | off | [list of rule ids]
```
Order inside a folder = filename order (allow `01-` prefixes).

## 4. Core features (MVP)
- Methods: GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS. Query params editor, headers, body types above.
- Variables: `{{var}}` from environment → collection → run captures; `${env:NAME}` reads process env (CLI) or agent env.
- Auth helpers: bearer, basic, API key (header/query), OAuth2 client credentials (token cached per run).
- Response viewer: status, time, size, headers, JSON tree with search, raw view, copy as cURL.
- History (last 100, local only).
- Import: Postman collection v2.1, OpenAPI 3.x (JSON/YAML), cURL command. Export: cURL, collection YAML zip.
- Later (post-MVP): GraphQL, WebSocket, pre-request scripts (sandboxed).

## 5. Agent API (packages/cli)
All endpoints require header `X-ApiVane-Token`.
- `GET  /api/health` → version, project path
- `POST /api/send` → body: resolved request; agent performs it with undici/fetch, returns status, headers, body (base64 if binary), timings. Timeout default 30s, max body 10 MB.
- `GET/PUT/DELETE /api/files/*` → read/write YAML under `.apivane/` only.
- `POST /api/run` → runs a folder, streams results (SSE).
- Serves built web UI at `/`. The UI detects agent at `http://127.0.0.1:7878` (configurable).
- Token handoff: the agent opens `http://127.0.0.1:7878/#token=...`; Pages UI asks the user to paste the token once (stored in sessionStorage).

## 6. CLI runner
```
npx apivane run [path=.apivane] --env staging [--folder users] [--bail]
  [--reporter cli,junit,json,html] [--out reports/] [--security strict|default|off]
```
- Exit code 1 on any failed test or security finding at/above `--fail-on` (default: high).
- JUnit XML for GitHub/GitLab test tabs; HTML report single file.
- GitHub Action (`action.yml`, composite) wraps `npx apivane run`, uploads the report, writes a job summary.

## 7. Security checks (rule-based, no AI needed)
Each rule: id, severity (info/low/medium/high), description, fix hint. Run on every response.
- `SEC001` Missing security headers: HSTS, X-Content-Type-Options, CSP (HTML only), X-Frame-Options/frame-ancestors
- `SEC002` CORS wildcard `*` combined with credentials, or reflected arbitrary Origin
- `SEC003` Secrets in response body/headers (AWS keys, JWTs, private keys, generic high-entropy tokens)
- `SEC004` Auth not enforced: replay the request without auth; 2xx = finding (opt-in, only in CI runner)
- `SEC005` Verbose errors / stack traces / server version banners
- `SEC006` Cookies missing Secure/HttpOnly/SameSite
- `SEC007` Plain HTTP URL used for non-localhost
- `SEC008` Sensitive data in URL query (token, password, key)
Rules live in `packages/core/src/security/rules/*.ts`, one file per rule, each with unit tests.

## 8. AI helper (optional, off by default)
- Bring your own key: Anthropic, OpenAI, or local Ollama (no key). Key stays in the browser
  (localStorage, clearly labelled) or in agent env vars. Never sent anywhere except the chosen provider.
- Features: generate `tests:` block from a response or OpenAPI operation; explain a failed test;
  summarize security findings with fixes; generate requests from an OpenAPI spec.
- Before sending to AI, redact secrets and masked variables. Show the exact payload in a preview.
- Provider adapter interface in core: `complete(prompt, opts): Promise<string>`.

## 9. UI / design
- Layout: sidebar (collections, environments, history) | request editor | response panel. Keyboard: Ctrl/Cmd+Enter send.
- Distinct look — don't reuse fonts or themes from my other projects. Dark default + light toggle.
- Banner showing mode: "Agent connected" / "Browser-only (CORS-limited)".
- Footer: "By Yousaf Hamza" linking to GitHub.
- SEO on the Pages site: title, meta description, Open Graph, JSON-LD SoftwareApplication, sitemap, robots.txt.
  Keywords: free postman alternative, self-hosted API client, API security testing, API testing GitHub Actions.

## 10. Release
- GitHub Actions: CI (lint, typecheck, test, build) on PR; Pages deploy on main; npm publish + GHCR Docker image on tag `v*`.
- Docker: multi-stage, node:20-alpine, non-root user, final image runs `apivane --host 0.0.0.0` inside container only.
- README: 1-command quickstart (npx, Docker), screenshots, CI example, security model, comparison table.

## 11. Browser extension (packages/extension)
- One MV3 codebase, built for Chrome/Edge and Firefox (Firefox: `browser_specific_settings`, background `scripts` fallback).
- Content script only on the Pages origin + localhost dev; bridges `window.postMessage` ⇄ `runtime.sendMessage`
  (works in both browsers; Chrome `externally_connectable` not needed).
- Background performs `fetch` with optional host permissions requested per host at first use (`permissions.request`).
- Message schema validated; only `send` and `ping` actions; sender origin checked; no cookies of other sites unless the user enables "include browser cookies" per host.
- UI detects it via a `ping` reply (version) and shows "Extension connected".
- Store packaging: zip per browser from CI; `web-ext lint` for Firefox.

## 12. First run, theme, install
- Theme: follows the device (`prefers-color-scheme`) by default; user can pin Light/Dark. Stored in localStorage.
- First-run walkthrough (welcome → appearance → request engine → quick tour → ready) with Skip on every step.
  Shown once (`apivane.onboarded`), replayable from Help. Never shown when launched as installed app after onboarding.
- PWA: manifest + service worker (app shell cache only, never API responses). "Install app" button appears only
  when `beforeinstallprompt` fires and not in `display-mode: standalone`; iOS Safari gets a "Share → Add to Home Screen" hint.
- Sample collection of public CORS-enabled APIs (JSONPlaceholder, DummyJSON auth flow, Open-Meteo, PokeAPI,
  REST Countries, httpbin) + one intentionally blocked request that teaches the CORS fix.
