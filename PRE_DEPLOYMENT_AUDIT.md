# Pre-Deployment Audit — Desk Health Dashboard (backend)

**Verdict: GO WITH FOLLOW-UPS**
**Date:** 2026-10-22 · **Audited by:** pre-deployment skill

No critical or high issues are open. The backend is a single-user, token-protected personal API. Before going live you need to set two strong tokens (see below). The remaining items are low-risk hardening for later.

| Severity | Open | Fixed in this pass |
|---|---|---|
| Critical | 0 | 0 |
| High | 0 | 0 |
| Medium | 0 | 2 |
| Low | 3 | 3 |
| Unverified | 1 | — |

---

## Do these before you ship

1. **Generate two long random tokens** and set them as Cloudflare secrets `INGEST_TOKEN` and `DEVICE_TOKEN`.
   Use a different token for each, at least 24 characters (e.g. a password manager's 40-char random password). The Worker refuses tokens shorter than 24 characters with `503`.
2. **Never paste a token into GitHub** (issues, commits or code). The device token goes in GitHub *Actions secrets* in Phase 5, which is fine.

---

## Scope

- **Stack:** Cloudflare Worker, TypeScript, no framework, no runtime dependencies
- **Data layer:** Cloudflare Workers KV (namespace `DASH`)
- **Hosting:** Cloudflare Workers (`*.workers.dev`) with Static Assets for `/app` and `/flash`
- **Auth:** two static bearer tokens (`INGEST_TOKEN` for writes and app reads, `DEVICE_TOKEN` read-only for `/api/dashboard`)
- **AI/LLM usage:** none. The scanner's "LLM detected" lead came from words in `PLAN.md`; no code calls an LLM.
- **Users:** one person (the owner), in Germany
- **Reviewed:** all of `backend/`, `.gitignore`, the git index, dependency tree
- **Not reviewed:** Cloudflare dashboard settings (not reachable from here)

---

## Findings

### 1. Secrets & credentials

**[LOW] Weak tokens would be guessable** — Fixed
- **What:** auth is only as strong as the token. A short or reused token could be brute-forced.
- **Why it matters:** anyone with the ingest token can read and write your health data.
- **Where:** `backend/src/index.ts` (`requireToken`)
- **Status:** Fixed. Tokens under 24 characters are refused, the comparison is constant-time, and wrong attempts are throttled (see §5).

**[LOW] `.gitignore` did not cover key files** — Fixed
- **Where:** `.gitignore`
- **Status:** Fixed. Added `*.pem`, `*.key`, `*.p12`, `credentials.json`. Nothing secret is tracked in git: `.dev.vars` is ignored and only `.dev.vars.example` (dev-only placeholder tokens) is committed.

### 2. Database privacy & data access

No issues found. KV is reachable only through the Worker. Every data route checks a token, the device token can only read the dashboard, and nothing is publicly listable. Cloudflare encrypts KV at rest.

### 3. Authentication & authorization

No issues found. There are no user accounts. Token separation was verified by tests and by the live smoke test (`401` for a wrong token, for the device token on writes, and for the ingest token on `/api/dashboard`).

### 4. Input validation & injection

No issues found. Every write is validated in `backend/src/validate.ts`:
- types, ranges and allowed values are checked;
- the muscle-ID allowlist is enforced;
- config uses known fields only, with no blind spreading of the request body.

Bad input returns `400` with a clear message. Bodies are capped at 1 MB. There is no SQL and no HTML rendering of user input on the server.

### 5. Production & infrastructure

**[MEDIUM] No throttling of failed auth** — Fixed
- **What:** an attacker could try tokens as fast as the network allows.
- **Status:** Fixed. A Workers Rate Limiting binding allows 20 failed attempts per minute per IP, then returns `429`. Only failures count, so normal use is never throttled. Verified live: request 18+ got `429`.

**[MEDIUM] Missing security headers** — Fixed
- **Status:** Fixed. JSON responses send:
  - `Strict-Transport-Security`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`;
  - `Content-Security-Policy: default-src 'none'`;
  - `Cache-Control: no-store`.

  Static pages get the same through `backend/public/_headers`. A page-specific CSP for `/app` follows in Phase 2.

**[LOW] Dev-only dependency advisories** — Fixed
- **Status:** Fixed. Upgraded vitest 3 → 5. `npm audit` now reports 0 vulnerabilities, and production dependencies were always clean (there are none).

**[LOW] No backups of KV data** — Open
- **Why it matters:** a bug or a bad write could lose history (XP, streaks). KV has no point-in-time restore.
- **Fix later:** add `GET /api/export` (ingest token) so the app can download a JSON backup.

**[LOW] Verbose errors** — no issue. Unknown errors return a generic `{"error":"internal error"}`. Details go only to Cloudflare logs, which contain no request bodies.

**[LOW] KV write races** — Open (accepted)
- Two writes in the same instant (Shortcut and app) can overwrite each other's `meta:days` update. The next write recomputes it. Acceptable for a single user.

### 6. Legal, privacy & AI compliance

N/A for now. This is a personal tool used only by its owner, so it is processing your own data for purely personal purposes (GDPR's household exemption). There are no other users, no cookies or trackers, and no third parties beyond Cloudflare as host.

**If you ever let someone else use it,** you'll need a privacy notice and a delete-my-data path, because health data is special-category data under GDPR Art. 9.

---

## Changes applied

| File | Change |
|---|---|
| `backend/src/index.ts` | Minimum token length (24), throttling of failed auth via `AUTH_LIMITER`, stricter security headers |
| `backend/wrangler.toml` | Added `[[ratelimits]]` binding `AUTH_LIMITER` (20/min) |
| `backend/public/_headers` | Security headers for static pages |
| `backend/package.json` | vitest 3 → 5 (dev-only advisories) |
| `.gitignore` | `*.pem`, `*.key`, `*.p12`, `credentials.json` |
| `backend/test/api.test.ts` | Tests for weak-token refusal and throttling |

---

## Couldn't verify

- **Cloudflare dashboard:** after connecting the repo, check Workers & Pages → desk-dashboard → Settings:
  - `INGEST_TOKEN` and `DEVICE_TOKEN` must show as **Secret** (encrypted), not as plain-text variables;
  - there should be no extra routes or custom domains you didn't add.

---

## After launch

- Add `GET /api/export` for JSON backups (Phase 8).
- Rotate both tokens if a phone or the desk screen is lost: change the Cloudflare secret, re-enter it in the app, and reflash the board.

*This audit covers the checks in the pre-deployment skill against the code as reviewed. It isn't a penetration test and isn't legal advice.*
