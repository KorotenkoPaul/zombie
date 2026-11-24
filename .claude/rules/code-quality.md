---
paths:
  - "game/**/*.js"
  - "tests/**/*.js"
  - "pipeline/**/*.js"
---

<!-- Adapted from Everything Claude Code by Affaan Mustafa (MIT, see ../ECC-LICENSE), rules/common/coding-style.md and rules/common/security.md, upstream commit 4adeee6. Only the parts that fit this three.js game are kept. -->

# Code quality (JS in this repo)

## Keep it simple
- KISS: the simplest solution that actually works; clarity over cleverness.
- DRY: reuse an existing helper before writing a new one; extract only when the repetition is real.
- YAGNI: no abstraction, config option or factory before there is a second caller.
- Prefer early returns over deep nesting; name meaningful thresholds and timings as constants.

## Errors
- Never silently swallow an error. An empty `catch {}` needs a comment saying why it is safe.
- A fallback that hides a real failure (a missing model, clip or texture) must at least `console.warn` once with context.

## Secrets
- Never hardcode API keys or tokens (Fal, Railway, OpenAI). They come from the environment or the proxy.

## Debug output
- No new `console.log` in `game/` (shipped code). Use `console.warn`/`console.error` for real problems; tests and pipeline scripts may log freely.

## What does NOT apply here (deliberately left out of the upstream rules)
- "Never mutate": three.js hot loops reuse scratch vectors and quaternions on purpose to avoid garbage.
- File-size limits: big modules like `game/hero.js` are expected.
- TDD and 80% coverage: this project's check is the animation gate and the visual watchers, see `HERO-RULES.md` and `tests/anim/README.md`.
