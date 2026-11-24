# What came from Everything Claude Code

Source: https://github.com/affaan-m/everything-claude-code (now served as affaan-m/ECC), by Affaan Mustafa,
MIT licence (copy in `ECC-LICENSE`). Taken from upstream commit `4adeee6` (2026-11-19).
Only a small, reviewed subset is here; nothing is installed by the upstream installer.

## Added

| File | Upstream | Changes |
|------|----------|---------|
| `agents/code-reviewer.md` | agents/code-reviewer.md | Description no longer says "MUST BE USED / proactively" (so sessions don't spawn it on every edit); model pin removed (inherits the session model); Zombie Land notes appended (three.js, HERO-RULES, gate, shader cache keys, report-only). |
| `agents/silent-failure-hunter.md` | agents/silent-failure-hunter.md | Same treatment. |
| `commands/plan.md` | commands/plan.md | Links to upstream-only commands (`/plan-canvas`, `/prp-*`, TDD skill) replaced with this repo's next steps. Runs inline, no subagents. |
| `commands/aside.md` | commands/aside.md | Unchanged apart from the licence note. |
| `rules/code-quality.md` | rules/common/coding-style.md + security.md | Rewritten down to what fits a three.js game, and scoped with `paths:` to JS files so it loads only when JS is touched. |
| `hooks/console-log-warn.js` + `settings.json` | scripts/hooks/post-edit-console-warn.js | Rewritten self-contained: only text the edit adds, only `game/**/*.js`, no disk reads, no network, always exit 0, ~30 ms, 5 s timeout. Warns only, never blocks. |

## Deliberately skipped

- **All other upstream hooks.** They run through ECC's plugin bootstrap and `scripts/lib`, and several would hurt a repo
  that ~18 sessions push to at once: `pre-bash-commit-quality` blocks `git commit`; `pre-bash-dev-server-block` blocks
  dev servers; `gateguard-fact-force`/`config-protection`/`block-no-verify` block edits or commands; `observe-runner`,
  `governance-capture`, `session-*`, `cost-tracker`, `evaluate-session` write logs and state under `~/.claude`;
  `mcp-health-check` probes servers; `desktop-notify` needs a desktop; `stop-format-typecheck` runs formatters/`tsc`
  for up to 300 s on every stop; `suggest-compact`/`context-gate`/`hookify-runtime` inject extra prompts.
- **Always-on rules** (`rules/common/*`): they would load into every session and demand TDD with 80% coverage,
  immutability, an 800-line file limit, conventional commits and spawning agents proactively, all of which clash with
  how this project works (three.js scratch-vector reuse, big hero.js, the animation gate as the test).
- **Web/TypeScript rules**: written for React/CSS/landing pages ("anti-template design", Core Web Vitals, CSP).
- **Agents that duplicate built-ins or don't fit**: planner/architect/code-explorer (built-in Plan and Explore agents),
  performance-optimizer and typescript-reviewer (React, webpack, tsc, eslint, npm audit, none of which this repo uses),
  tdd-guide, e2e-runner, refactor-cleaner (`npx knip` etc. download tools), doc-updater, security-reviewer, every
  language stack we don't use (Python, Go, Rust, Java, Kotlin, C++, PHP, Ruby, Dart, Vue, Angular, ...).
  `swift-reviewer`/`swift-build-resolver` can be added when the iOS port starts.
- **Commands** like `/code-review` (shadows the built-in one, flags every file over 800 lines, PR mode needs `gh`),
  `/checkpoint` (writes a log into the repo, conflict-prone), `/save-session`, `/learn`, `/evolve`, `/multi-*`, `/orch-*`,
  `/epic-*`, `/jira`, `/pm2`, marketing and all language-specific build/test commands.
