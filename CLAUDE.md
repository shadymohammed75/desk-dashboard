# Desk Health Dashboard — notes for Claude Code

The full build plan is `PLAN.md`. Work **one phase at a time**: do only the phase asked for, stop when its
acceptance criteria pass, show the result, and wait before starting the next one. Steps marked **[ME]** need
the owner (phone, Cloudflare or GitHub clicks); write exact click-by-click instructions for those.

## Principles (apply to every phase)

- **Server is smart, device is dumb.** All logic (today's plan, done or not, score, XP, streak, coach line,
  staleness) lives in the backend. The screen fetches one display-ready JSON and draws it — logic changes
  must never require a reflash.
- **One backend, two clients.** One Cloudflare Worker serves the API (`/api/*`), the phone PWA (`/app`) and
  the flasher page (`/flash`).
- **The phone app is a PWA**, not a native iOS app (no Mac/Xcode). Installed via Safari → Add to Home Screen.
- **Apple Health is only read by an iOS Shortcut** (sleep, steps, active kcal, food). Gym, trained muscles,
  BP and the plan are logged by hand in the app.
- **One UI codebase for the screen.** `firmware/ui/` is pure LVGL 9 C (no Arduino includes). It is rendered to
  PNG in the cloud by `tools/snapshot/` from the mocks, and the same code is flashed to the board.
- **No secrets in git.** Tokens live in Cloudflare secrets, GitHub Actions secrets, `.dev.vars` and a
  gitignored `firmware/include/secrets.h`. Never print real tokens in logs or commit messages.
- **Free tiers only:** Cloudflare Workers + KV + Static Assets, GitHub Actions, iOS Shortcuts, LVGL.
- **Health data is private.** Every data endpoint requires a bearer token; HTTPS only; data stays in the
  owner's Cloudflare account.
- **Original or openly licensed assets only** (MIT / Apache-2.0 / CC BY, OFL for fonts). Every third-party asset is
  recorded in `CREDITS.md` with source, licence and attribution. The body map comes from react-native-body-highlighter
  (MIT) via `tools/body_map/muscle_map.json`; icons are Material Symbols (Apache-2.0) via `tools/icons/`.

## Where things live

| What | Where |
|---|---|
| Data contract (writes, reads, `/api/dashboard` shape) | `PLAN.md` §4.1–4.2 |
| Gym status rules | `PLAN.md` §4.3 |
| Motivation engine (score, XP, streak, coach, mascot, celebrate) | `PLAN.md` §4.3b |
| Config defaults | `PLAN.md` §4.4 |
| Muscle IDs (shared by backend, app, SVG, firmware) | `PLAN.md` §4.5 |
| Desk screen design ("Training HUD") | `PLAN.md` §5.1 |
| Phone app design | `PLAN.md` §5.2 |
| Sample `/api/dashboard` responses | `mock/*.json` (from `mock/make_mocks.py`) — check with `python3 mock/validate.py` |
| Asset generators | `tools/` (`npm run assets`, `make_hud_assets.py`, `svg_to_lvgl.py`, `make_fonts.sh`); credits in `CREDITS.md` |

If the contract changes, update `PLAN.md`, the mocks and `mock/validate.py` together.

## Conventions

- Time zone is **Europe/Berlin** everywhere (day boundaries, week = Monday–Sunday, `mode`).
- Missing data is `null` in JSON and "—" on screen, never `0`.
- After each phase, **update `architecture-notes.txt`** (architecture-notebook skill): short bullets under
  Architecture / Pipelines / Security, plus one Changelog line per meaningful change.

## Environment notes

- Node 22, Python 3.13, gcc 13, cmake 3.28 are available in the cloud environment.
- PlatformIO installs via pip, but its registry (`*.platformio.org`) is blocked by the current network policy,
  so firmware builds run in GitHub Actions (Phase 5) unless the allowlist is extended. See
  `architecture-notes.txt` for details.
