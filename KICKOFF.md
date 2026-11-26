# How to run this with Claude Code

1. Put this folder anywhere (e.g. `C:\Users\YousafHamza\Downloads\apivane`), open a terminal there, run `git init`, then `claude`.
2. Paste the Phase 0 prompt below. One phase per session.
3. When a phase is done: `/clear`, then paste the "Next phase" prompt.
4. If a session gets long inside a phase, run `/compact` instead of starting over.

Credit tips:
- Use Sonnet for build phases (`/model sonnet`). Switch to Opus only for tricky design/debugging.
- Keep sessions to one phase; PROGRESS.md "Session notes" carries memory between sessions.
- Say "plan first, then wait for my OK" on big phases (or press Shift+Tab for plan mode) so it doesn't build the wrong thing.

Rename: to use another name, find-and-replace `apivane` / `ApiVane` in these 4 files before starting.

---

## Prompt — Phase 0 (first session)

```
Read CLAUDE.md and docs/PROGRESS.md. We're starting Phase 0.
Read only sections 1, 2 and 10 of docs/SPEC.md.
Give me a short plan (max 10 bullets) for Phase 0, then wait for my OK.
After I approve: build it, run typecheck/lint/tests/build, tick the Phase 0 items in
docs/PROGRESS.md, set "Current phase" to Phase 1, and add session notes.
Keep dependencies minimal and ask before adding anything not in CLAUDE.md's stack.
```

## Prompt — Next phase (every later session, after /clear)

```
Read CLAUDE.md and docs/PROGRESS.md. Continue with the current phase.
Read only the docs/SPEC.md sections relevant to this phase.
Plan in max 10 bullets and wait for my OK, then build, verify
(typecheck, lint, tests, build), update PROGRESS.md and session notes.
```

## Prompt — Fix something small (cheap)

```
Read CLAUDE.md. Don't explore the repo. Task: <describe>. Files likely involved: <paths>.
Make the minimal change, run the tests for that package, summarize in 3 bullets.
```
