# Desk Health Dashboard: Build Plan (v2, cloud dev + phone app)

A small 800×480 desk screen showing my daily health metrics (sleep, steps, food, blood pressure, gym), with a body map on the right that highlights today's muscles and turns green once I've trained. A **small phone app** is where I log the gym, what I trained and blood pressure, and where I edit my weekly plan.

**Rules for this project:**
- **Keep it cheap.** Everything except the screen is free, and the screen is bought last.
- **Develop fully in the cloud** with Claude Code on the web, with nothing installed on my PC.

---

## 0. How to use this plan (Claude Code on the web)

1. **GitHub:** create a new, private, empty repo `desk-dashboard` and add this file as `PLAN.md`.
2. **Claude Code on the web** (claude.ai/code): select the repo and create the environment.
   - **Network access:** the default allowlist usually covers npm, pip and GitHub. PlatformIO downloads its ESP32 toolchain from its own servers. If that's blocked, switch the environment to a custom allowlist that includes `*.platformio.org`, or rely on the GitHub Actions build in Phase 5.
3. **Cloudflare (free account), one-time by me:** in the Cloudflare dashboard, go to Workers & Pages → Create → **Import a repository**, pick `desk-dashboard` with root `backend/`. From then on, every push to `main` deploys automatically, so Claude Code never needs my Cloudflare password. Set the secrets (`INGEST_TOKEN`, `DEVICE_TOKEN`) in the Worker's Settings → Variables & Secrets.
4. **Kickoff prompt:**

   > Read PLAN.md. We're doing **Phase 0** only. Follow the phase's tasks, stop when its acceptance criteria pass, show me the result, open a PR (or push to main if I say so), and wait for me before the next phase. Keep the "Principles" section in mind for every phase.

5. **Next phases:** `Do Phase N from PLAN.md.` Steps marked **[ME]** need me (a phone or Cloudflare click). Claude Code writes exact instructions for those.

---

## 1. Principles (apply to every phase)

- **The server is smart, the device is dumb.** All logic (today's plan, done or not, averages, goals, staleness) lives in the backend. The screen fetches one display-ready JSON and draws it, so changing the logic never needs a reflash.
- **One backend, two clients.** The Cloudflare Worker serves the API, the phone app (at `/app`) and the device JSON.
- **The phone app is a PWA, not a native iOS app.** A native app needs a Mac and Xcode, and a PWA is free. It's added to the iPhone home screen from Safari and opens full-screen like a real app.
- **Apple Health is only read by a Shortcut.** A web app can't access HealthKit, so one Shortcut sends sleep, steps and food. Everything I log by hand goes through the app.
- **One UI codebase for the screen.** The LVGL UI is tested in the cloud by rendering PNG snapshots from mock JSON, and the same code is flashed to the board.
- **No secrets in git.** Tokens live in Cloudflare secrets and in a gitignored `secrets.h`.
- **Free tiers only:** Cloudflare Workers + KV + Static Assets, GitHub Actions, iOS Shortcuts, LVGL.
- **Health data is private.** Every endpoint needs a token, everything is HTTPS, and data lives only in my Cloudflare account.
- **Original or openly licensed assets only.** Use our own artwork, or assets under MIT / Apache-2.0 / CC BY (OFL for fonts). Record each one in `CREDITS.md` with its source, licence and attribution. Never copy unlicensed images from the web.

---

## 2. Architecture

```
iPhone
  ├─ PWA "Gym Log" (/app) ── log gym · what I trained · BP · edit plan ──┐
  └─ Shortcut "Sync Health" (automations) ── sleep · steps · food ───────┤
                                                                           ▼
GitHub repo ──push──► Cloudflare Worker + KV (auto-deploy)
     │                   - /api/*        JSON API
     │                   - /app          phone app (static assets)
     │                   - /flash        browser flasher page
     │                         │
     └─ GitHub Actions ──► firmware .bin (artifact/release)
                               │
                               ▼
        ESP32-S3 4.3" screen ◄── GET /api/dashboard every 10 min
```

---

## 3. Repo structure

```
desk-dashboard/
├─ PLAN.md  CLAUDE.md  architecture-notes.txt
├─ backend/                     # Cloudflare Worker (TypeScript)
│  ├─ src/index.ts              # routing + auth
│  ├─ src/logic/*.ts            # sleep, gym, nutrition, bp, staleness
│  ├─ src/config.default.json
│  ├─ test/*.test.ts            # vitest
│  ├─ public/app/               # phone PWA (built output or plain HTML/JS)
│  ├─ public/flash/             # ESP Web Tools flasher page + manifest
│  └─ wrangler.toml
├─ app/                         # PWA source (if a build step is used)
├─ mock/                        # sample /api/dashboard responses
├─ tools/
│  ├─ body_map/body.svg  preview.html  svg_to_lvgl.py
│  └─ snapshot/                 # native LVGL → PNG renderer (Linux, runs in the cloud env)
├─ firmware/
│  ├─ platformio.ini  src/main.cpp  src/api_client.*
│  ├─ ui/                       # PURE LVGL, shared with the snapshot tool
│  └─ include/secrets.h.example
├─ shortcuts/README.md
└─ .github/workflows/firmware.yml
```

---

## 4. Data contract

### 4.1 Writes

All writes send the header `Authorization: Bearer <INGEST_TOKEN>`.

**`POST /api/ingest`**: from the Shortcut. It overwrites the day's data, so it's safe to send many times.
```json
{
  "date": "2026-10-22",
  "sent_at": "2026-10-22T18:05:00+02:00",
  "steps": 8432,
  "active_kcal": 512,
  "nutrition": { "kcal": 1850, "protein_g": 120 },
  "sleep_samples": [ { "start": "…", "end": "…", "value": "Core" } ],
  "workouts": [ { "type": "Traditional Strength Training", "start": "…", "duration_min": 52 } ],
  "vitals": { "resting_hr": 58, "heart_rate": 72, "spo2": 0.97 }
}
```

**`POST /api/gym`**: from the app.
```json
{ "action": "done", "split": "push", "muscles": ["chest","front_delts","triceps"], "duration_min": 55, "note": "PR bench 80kg" }
```
- `action` is one of `done`, `skip` or `undo`.
- `split`, `muscles`, `duration_min` and `note` are optional. Missing muscles default to the split's muscles.

**`POST /api/bp`**: from the app.
```json
{ "sys": 128, "dia": 82, "pulse": 64, "ts": "2026-10-22T08:10:00+02:00" }
```

**`POST /api/tasks`**: from the app's Today checklist. Ticks or unticks one daily habit.
```json
{ "id": "apple", "done": true }
```

**`PUT /api/config`**: from the app's Plan screen. Replaces the schedule, day overrides, splits, tasks or goals.

### 4.2 Reads

**For the app** (header `Bearer <INGEST_TOKEN>`):
- `GET /api/today`: today's plan, status, what I logged, the latest BP and today's metrics.
- `GET /api/history?days=14`: per-day split, status, trained muscles and BP.
- `GET /api/config`.

**For the device: `GET /api/dashboard`** (header `Bearer <DEVICE_TOKEN>`). The response is small, flat and display-ready:
```json
{
  "now": "2026-10-22T18:10:00+02:00",
  "updated": "2026-10-22T18:05:00+02:00",
  "stale": false,
  "mode": "evening",
  "sleep":  { "asleep_min": 432, "avg7_min": 410, "goal_min": 450,
              "stages": { "deep": 72, "core": 250, "rem": 95, "awake": 15 } },
  "steps":  { "value": 8432, "goal": 10000 },
  "active": { "kcal": 512, "goal": 600 },
  "food":   { "kcal": 1850, "kcal_goal": 2600, "protein_g": 120, "protein_goal": 160 },
  "bp":     { "sys": 128, "dia": 82, "pulse": 64, "ts": "…" },
  "vitals": { "resting_hr": 58, "heart_rate": 72, "spo2": 97 },
  "gym":    { "day_type": "push", "label": "PUSH", "color": "#FF6A1A", "icon": "fitness_center",
              "muscles": ["chest","front_delts","side_delts","triceps"],
              "status": "pending", "done_min": null,
              "week_done": 2, "week_target": 4 },
  "score":  { "value": 67, "done": 6, "total": 9, "perfect": false,
              "tasks": [ { "id": "gym", "label": "Train or rest as planned", "icon": "fitness_center", "done": false, "auto": true },
                         { "id": "apple", "label": "Eat one apple", "icon": "nutrition", "done": true, "auto": false } ] },
  "progress": { "level": 7, "xp": 340, "xp_next": 500, "streak_days": 12, "best_streak": 21 },
  "week":   [ { "d": "M", "state": "done", "color": "#FF6A1A", "icon": "fitness_center" },
              { "d": "W", "state": "rest", "color": "#2DD4BF", "icon": "bedtime" },
              { "d": "S", "state": "rest", "color": "#2DD4BF", "icon": "hot_tub" } ],
  "coach":  { "text": "Push day is waiting. 45 minutes is enough.", "tone": "nudge" },
  "mascot": "pumped",
  "celebrate": null
}
```
Notes on the new fields:
- `mode` is one of `morning` (05:00–10:00), `day`, `evening` (18:00–23:00) or `night`.
- `week[].state` is one of `done`, `rest`, `missed`, `skipped`, `today` or `planned`.
- `coach.tone` is one of `hype`, `nudge`, `calm` or `proud`.
- `mascot` is one of `sleepy`, `chill`, `pumped`, `proud` or `tired`.
- `celebrate` is `null`, or `{ "id": "gym_done_2026-10-22", "title": "PUSH DAY COMPLETE", "sub": "+50 XP · streak 13" }`. The device plays each `id` once and remembers it in RAM/NVS.
- `gym.status` is one of `pending`, `done`, `skipped` or `rest`.
- When `done`, `gym.muscles` lists what I **actually trained** (from the app); otherwise it lists the plan.
- **Training on a rest day** sets the status to `done` with the logged muscles.
- `stale` is `true` when the last Health sync is more than 3 hours old. Missing values are `null`.
- `vitals` come from today's Health sync: resting heart rate, the latest heart rate, and the latest blood oxygen in %. Each value is `null` when Health has none. The ingest accepts SpO₂ as Apple's fraction (0.97) or as a percentage.

### 4.3 Gym status rules (in priority order)

1. **Manual entry from the app** (done, skip or undo) always wins.
2. **Apple Health backup:** a strength workout of 20 minutes or more counts as `done` with the planned muscles, for days I forget to tap.
3. **Rest days:** if the plan says rest, the status is `rest`.
4. **Otherwise:** `pending`.
5. **Weekly count:** `week_done` counts done days Monday to Sunday (Europe/Berlin).

### 4.3b Motivation engine (backend, pure functions, unit-tested)

**Daily Score (0–100)** is the share of today's habits that are done. Doing **all** of them is a **perfect day**.

- The habits are a list in config (`tasks`), editable in the app. The defaults are:
  - **Train or rest as planned** (auto: gym done, or a rest day)
  - Eat one apple
  - No sweets
  - 4h focus session
  - **Steps goal** (auto, from Apple Health)
  - Morning routine
  - Night routine
  - **Asleep by 23:00** (auto: last night's first asleep sample before `goals.sleep_by`)
  - Read something
- `value = round(100 × done / total)`, and `perfect = (done == total)`.
- Manual habits are ticked in the app. Auto habits tick themselves, and can also be ticked by hand when Health data is missing.
- Sleep, steps, food and blood pressure are still shown as metrics. They no longer make up the score directly.

**XP and levels** (lifetime total, stored in KV `meta:xp`, added once per day per event):

| Event | XP |
|---|---|
| Gym done | +50 |
| Training on a planned rest day | +20 (bonus, not double) |
| Each habit done (except the gym habit) | +10 |
| BP logged | +10 |
| Perfect day (all habits done) | +30 bonus |

- **Level curve:** `xp_next(level) = 100 + 50 × level`, so it's quick early and slower later.

**Streak:**
- It counts consecutive **planned** days that were completed. A planned gym day counts if done; a rest day counts automatically.
- Skipping a planned gym day, or missing it by midnight, resets the streak to 0.
- `best_streak` is kept.

**Coach line:**
- Rule-based and server-side, written in my own short phrases (no famous quotes), under 50 characters.
- The best-matching rule wins, and it rotates daily among 3–5 variants per rule.
- **morning:**
  - Sleep below the goal by more than 45 min → calm: "Short night. Train smart, not heavy."
  - Sleep goal hit → hype: "Fully charged. Make it count."
- **gym pending:**
  - Day → nudge: "PUSH day loaded. You know the drill."
  - Evening → nudge: "Still time. 45 minutes is enough."
- **gym done** → proud: "Push day crushed. Recover well."
- **rest day** → calm: "Rest day. Muscles grow now."
- **Streak milestone** (7, 14, 30, 50, 100) → hype: "12 days straight. Don't break it."
- **Protein behind after 18:00** → nudge: "40 g protein to go. Easy win."

**Mascot mood:**
- `sleepy` when sleep was low in the morning.
- `pumped` when gym is pending.
- `proud` when done.
- `chill` on rest days.
- `tired` when the score is below 40 in the evening.

**Celebrate events** are emitted when:
- gym is marked done;
- a perfect day is reached;
- the level goes up;
- a streak milestone is reached.

Each event has a unique id, and the server keeps it active for 30 min.

### 4.4 Config defaults (editable in the app)

```json
{
  "timezone": "Europe/Berlin",
  "schedule": { "mon": "push", "tue": "pull", "wed": "rest", "thu": "push",
                "fri": "pull", "sat": "rest", "sun": "rest" },
  "days": { "wed": { "icon": "bedtime" }, "sat": { "icon": "bedtime" },
            "sun": { "icon": "hot_tub", "label": "SPA DAY" } },
  "splits": {
    "push": { "label": "PUSH", "color": "#FF6A1A", "icon": "fitness_center", "muscles": ["chest","front_delts","side_delts","triceps"] },
    "pull": { "label": "PULL", "color": "#22D3EE", "icon": "rowing", "muscles": ["lats","upper_back","traps","rear_delts","biceps","forearms"] },
    "legs": { "label": "LEGS", "color": "#8B7CFF", "icon": "directions_run", "muscles": ["quads","hamstrings","glutes","calves"] },
    "rest": { "label": "REST DAY", "color": "#2DD4BF", "icon": "hot_tub", "muscles": [] }
  },
  "tasks": [
    { "id": "gym", "label": "Train or rest as planned", "icon": "fitness_center", "auto": "gym" },
    { "id": "apple", "label": "Eat one apple", "icon": "nutrition" },
    { "id": "no_sweets", "label": "No sweets", "icon": "no_food" },
    { "id": "focus", "label": "4h focus session", "icon": "timer" },
    { "id": "steps", "label": "Steps goal", "icon": "directions_walk", "auto": "steps" },
    { "id": "morning", "label": "Morning routine", "icon": "wb_sunny" },
    { "id": "night", "label": "Night routine", "icon": "dark_mode" },
    { "id": "sleep_early", "label": "Asleep by 23:00", "icon": "bedtime", "auto": "sleep_early" },
    { "id": "read", "label": "Read something", "icon": "menu_book" }
  ],
  "goals": { "steps": 10000, "active_kcal": 600, "kcal": 2600, "protein_g": 160, "sleep_min": 450, "gym_per_week": 4,
             "sleep_by": "23:00" }
}
```
- **Day overrides:** `days.<weekday>` can override the icon and label shown for that day. Sunday is the "SPA DAY" with a hot tub.
- **Icons:** names of [Material Symbols](https://fonts.google.com/icons) from the set in `tools/icons/make_icons.mjs`.
- **Split colours** are used everywhere for that split: titles, buttons, week dots, the heat-map and the pending body map.

These values are **placeholders**. I'll set my real ones in the app.

### 4.5 Muscle IDs (shared by the backend, app, SVG and firmware)

- **Front:** `chest`, `front_delts`, `side_delts`, `biceps`, `forearms`, `abs`, `obliques`, `quads`, `calves_front`
- **Back:** `traps`, `rear_delts`, `upper_back`, `lats`, `triceps`, `lower_back`, `glutes`, `hamstrings`, `calves`

`calves` lights up both `calves` and `calves_front`.

---

## 5. Layouts

### 5.1 Desk screen: "Training HUD" (800×480, non-touch)

**Concept**

It feels like a game HUD or a sci-fi cockpit that is *about me*. It's dark and neon, alive with a few small animations, and every number shows **progress towards something**, never just a value. Glancing at it should give either a little hit of pride ("streak 12, score 86") or a gentle push ("Push day loaded").

**Visual language**

- **Palette** (define as tokens in `theme.h`):

  | Token | Hex | Used for |
  |---|---|---|
  | `bg` | `#07080C` | Background, near-black with a faint blue tint |
  | `panel` | `#11131A` | Panels, with a 1px border `#1E2230` and 14px corner radius |
  | `primary` | `#FF6A1A` (neon orange) | Today's target, CTAs, the score ring |
  | `cyan` | `#22D3EE` | Sleep and recovery |
  | `lime` | `#3DFF8F` | Done and goals hit |
  | `gold` | `#FFC53D` | XP, level, streak, records |
  | `violet` | `#8B7CFF` | REM sleep and accents |
  | `amber` | `#FFB020` | Stale data or warnings only |
  | `text` | `#F4F5F8` | Main text |
  | `text-dim` | `#8A90A2` | Labels |
  | `text-faint` | `#4A5063` | Faint text |

- **Background texture:** a very subtle 24px dot grid (`#FFFFFF` at 4% opacity) and one soft orange radial glow behind the body map. Pre-render both as one 800×480 background image so they cost no CPU.
- **Typography:**
  - Big numbers: Montserrat Bold 44/56 with tabular figures.
  - Labels: UPPERCASE, 12–14px, letter-spaced, dim.
  - Coach line: 20px.
- **Icons:** a small original icon set (moon, footsteps, flame, fork, heart, bolt, trophy). Use a free icon font with a compatible licence (e.g. Lucide/Tabler, converted with the LVGL font converter), or draw them as tiny 2-colour bitmaps. **No emoji on the device**, because the fonts don't include them.
- **Glow:** used only on the score ring, today's muscles and the celebrate banner. Use pre-rendered glow PNGs, not live LVGL shadows, because shadows are expensive on this chip.
- **Gradients:** keep them short, two colours only, because RGB565 bands long gradients.

**Layout**

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ THU 22 OCT · 18:10        [🐾 mascot] LV 7 ▰▰▰▰▰▱▱▱ 340/500 XP     🔥12   ● live  │ 48px HUD bar
├─────────────────────────────────────────────────────┬─────────────────────────────┤
│  ╭───────────╮   SLEEP  7h12  ▰▰▰▰▰▰▰▱  96%   ☾      │   TODAY                     │
│ │    78     │   ▇deep ▇core ▇rem  (stage bar)       │   P U S H   D A Y           │
│ │  DAILY    │   MOVE   8,432 steps ▰▰▰▰▰▰▱ 84%      │                             │
│ │  SCORE    │   FUEL   120/160 g protein ▰▰▰▰▱ 75%  │   ╭─────╮     ╭─────╮       │
│  ╰───────────╯   kcal 1850 / 2600                    │   │front│     │back │       │
│  4 colour arc segments: sleep·move·food·gym          │   │ map │     │ map │       │
│                                                      │   │glow │     │glow │       │
│  ┌ VITALS ─────────────────────┐ ┌ THIS WEEK ───────┐│   ╰─────╯     ╰─────╯       │
│  │ ▣ BP · 08:10   ♥ RESTING    │ │ M T W T F S S    ││  chest · delts · triceps    │
│  │ 128/82         58 bpm       │ │ ● ● ☾ ◎ ○ ☾ ☾    ││                             │
│  │ ♥ HEART  72    ◆ SPO2  97 % │ │                  ││  [ ◉ LET'S GO — not done ]  │
│  └─────────────────────────────┘ └──────────────────┘│                             │
├─────────────────────────────────────────────────────┴─────────────────────────────┤
│ ▸ Still time. 45 minutes is enough.                                    2/4 this wk │ 40px coach bar
└───────────────────────────────────────────────────────────────────────────────────┘
```
- Left column is about 500px; right column is about 300px.

**Components**

1. **HUD bar (top):**
   - Date and time on the left.
   - In the centre: the **mascot** (an original 32×32 pixel creature in 5 moods), "LV 7", and a gold XP bar with `xp/xp_next`.
   - On the right: a flame icon with the streak in gold (it turns lime with a sparkle at milestones), then a connection dot that is lime when live and amber with "data 4h old" when stale.
2. **Daily Score ring (hero):**
   - A 180px ring with **one segment per daily habit** (§4.3b): lime when done, a faint track when not. All segments turn **gold** on a perfect day.
   - In the middle: the score as a percentage and "6/9 HABITS".
   - On a perfect day, the ring gets a soft gold glow and a "PERFECT DAY" tag.
3. **Stat rows (sleep, move, fuel):**
   - Each row has an icon, a label, a big value and a segmented progress bar (8–10 blocks, game-style) with a %.
   - When a goal is hit, the bar turns lime, a small trophy icon appears, and the % becomes "GOAL ✓".
   - **Sleep** also shows a thin **stage bar**: deep in deep blue, core in cyan, REM in violet, awake in faint.
4. **Vitals card:**
   - A compact 2×2 grid: the latest BP reading (with its time) and three readings from Apple Health (`vitals`):
     resting heart rate, latest heart rate and blood oxygen (SpO₂). Each has an icon, a small label and a big value.
   - No trend chart: trends live in Apple Health; this screen is a glance at today. Missing values show "—".
   - **Neutral colours only** (white and cyan), with no judgement or medical colouring.
   - When no BP reading exists, its label reads "BP · log in app".
5. **This week:**
   - Seven day dots:
     - **done:** filled lime;
     - **rest:** moon;
     - **today:** pulsing orange ring;
     - **planned:** hollow;
     - **missed or skipped:** faint ✕.
   - Underneath: "2/4 sessions".
6. **Body map (right column, the star).** The polygons come from react-native-body-highlighter (MIT), see CREDITS.md. Untrained muscles are #232836 with #343B4D outlines. The title shows the split's icon and colour.
   - **Rest days** show a big teal icon instead of the body: a hot tub with rising steam on Sunday ("SPA DAY"), a moon on other rest days.
   - **Pending:** today's muscles are orange with a slow **breathing glow** (opacity 55% → 100% → 55% over 2.4 s). The rest of the body is faint outline only.
   - **Done:** the trained muscles fill **lime with a bottom-to-top sweep** (500 ms), and the pill becomes "✓ DONE · 55 MIN".
   - **Rest:** the whole body is a calm cyan outline at 40%, with a moon icon and "RECOVERY DAY".
   - **Skipped:** grey, with "SKIPPED". No guilt messaging.
   - Under the figures: the muscle names in small caps ("chest · delts · triceps").
   - The status pill is a big rounded pill: orange "◉ LET'S GO" when pending, lime when done, cyan when resting.
7. **Coach bar (bottom):**
   - A full-width strip showing `coach.text`. Its left accent colour follows the tone: hype = gold, nudge = orange, calm = cyan, proud = lime.
   - The text fades in on change. On the right: the weekly session count.

**Time-of-day modes** (`mode` from the server)

- **morning:** the Sleep row is enlarged and highlighted, the coach line talks about recovery, and the mascot wakes up.
- **day:** the default layout.
- **evening:** if gym is pending, the pill pulses faster and the coach line nudges. If it's done, everything is calm.
- **night (23:00–06:30):** the backlight goes off. If the board can't dim, show a minimal black screen with a dim clock and the day's score for 5 min after midnight, then turn off.

**Celebrations** (when `celebrate` has an id the device hasn't shown yet)

- A **3-second full-screen takeover**:
  1. Dark overlay.
  2. A big gold title ("PUSH DAY COMPLETE" / "LEVEL UP · 8" / "STREAK 14 🔥", where the flame is an icon, not an emoji).
  3. A subtitle ("+50 XP").
  4. 30–40 simple confetti particles (small rectangles, 4 colours) falling. Lightweight LVGL objects, deleted afterwards.
  5. Back to the HUD, with the XP bar filling and the body map sweeping to lime.

**Animation budget** (to stay smooth on ESP32-S3)

- At most 2 looping animations at once: the breathing body map and the pulsing today dot.
- Everything else animates only on data change.
- Only small regions are redrawn; never animate the full screen except during a celebration.
- Target: idle CPU under 30%, no visible tearing.

**Rules**

- Missing data shows as "—" in dim text, never 0.
- Text stays readable from about 1 m: values at least 28px, labels at least 12px but only for labels.
- Everything is original art, including the mascot, icons and body.

### 5.2 Phone app "Gym Log" (PWA, mobile-first)

**Design system:**
- Inter (self-hosted, OFL), type scale 40 / 28 / 20 / 16 / 13 / 12, on an 8 pt spacing grid.
- Surfaces are separated by elevation and contrast rather than borders. Text is #F4F5F8, labels #8A90A2, and tap targets are at least 44 px.
- **Split colours** are used everywhere: push orange, pull cyan, legs violet, rest teal.
- Icons are Material Symbols.
- The score / LV / XP header appears **only on Today**. Other tabs get a compact title bar.

**Today:**
- A hero card: the split name in large type in the split colour, the big body map (or the rest-day icon with steam), and one full-width primary button "I trained" in the split colour.
- The daily habits checklist, then 3 metric cards and the week dots.

**Plan:**
- 7 big day tiles. Tapping one opens a bottom sheet to pick the split.
- Split cards with a mini body preview and muscle chips. The habits editor, then goals.

**History:** a month heat-map (split colours, teal rest days, outline-only missed days, gold dot for a perfect day), stats, then recent sessions with a coloured stripe.

**Feedback:**
- **Celebration:** a centred card on a blurred backdrop, with confetti behind the card and below the header. It closes itself after 2.5 s.
- **Toasts:** one at a time, above the nav, shown for 2 s.

**Today tab**
- A big header: "Today: PUSH" (or "Rest day") with a small front/back body map in SVG, showing the same states as the desk screen.
- Big buttons: **"✓ I trained"**, **"Skip today"** and **"Undo"** when something is already logged.
- **"I trained"** opens a sheet that is fast to fill in with one thumb:
  - Split chips (Push / Pull / Legs / Other).
  - Muscle chips, pre-ticked from the split and toggleable.
  - Duration stepper (default 60).
  - Optional note.
  - Save.
- Today's metrics in small cards (sleep, steps, food) from the last Health sync.

**Vitals tab**
- At the top, three tiles from the last Health sync: resting heart rate, heart rate and SpO₂, with the sync time.
- Then the blood pressure form: three large number fields (SYS, DIA, pulse), with the time defaulting to now. Save.
- Below: the last 5 readings as a list (no chart; trends live in Apple Health).

**Plan tab**
- Edit the weekly schedule (each weekday → split).
- Edit which muscles belong to each split.
- Edit goals.
- Saving updates `/api/config`.

**History tab**
- The last 14 days as a list: day, split, done/skip/rest, trained muscles and note.

**Tech**
- Plain HTML, CSS and JS, or a tiny Preact/Vite build. Keep it light, with no heavy framework.
- Served by the Worker as static assets at `/app`.
- Include `manifest.webmanifest` and icons so "Add to Home Screen" gives a full-screen app with its own icon.
- **First launch:** ask for the token once and store it on the phone (localStorage, wrapped in try/catch). Add a Log out button.
- Works on iPhone Safari. Touch targets are at least 44px. Haptic-free, no paid services.

---

## Phase 0: Project setup (cloud)

**Tasks**
- [ ] Create the folder structure from §3.
- [ ] Add a `.gitignore` covering `secrets.h`, `.dev.vars`, `node_modules`, `.pio` and `out/`.
- [ ] Write `CLAUDE.md` with the principles from §1, where the data contract lives, and the rule "update architecture-notes.txt after each phase" (architecture-notebook skill).
- [ ] Write nine mock dashboard JSONs:
  - `morning_short_sleep`
  - `push_pending_day`
  - `push_pending_evening`
  - `push_done_celebrate`
  - `rest_day`
  - `perfect_day` (score 92)
  - `streak_milestone`
  - `no_data`
  - `stale`
- [ ] Check the cloud environment: Node, Python 3, gcc/cmake. Try installing PlatformIO with `pip install platformio` and note whether its toolchain download works under this environment's network settings.

**Acceptance:** the structure is committed, the mocks are valid, and an environment report is written to architecture-notes.txt.

---

## Phase 1: Backend (Cloudflare Worker)

**Tasks**
- [ ] Scaffold a TypeScript Worker in `backend/` with KV binding `DASH` and Static Assets from `backend/public/`.
- [ ] Add all endpoints from §4. Auth:
  - `INGEST_TOKEN` for writes and app reads.
  - `DEVICE_TOKEN` for `/api/dashboard` only.
  - `/app` and `/flash` are public static pages, but their data calls need the token.
- [ ] Use these KV keys:
  - `day:YYYY-MM-DD`: Health ingest, gym entry and overrides.
  - `bp:recent`: the last 60 readings.
  - `config`.
  - `meta:last_ingest`.
- [ ] Implement the logic as pure, unit-tested functions:
  - **Sleep:** the night ending today. Sum the samples whose value is in {Asleep, Core, Deep, REM} and merge overlaps. Also compute a 7-day average.
  - **Gym:** the rules in §4.3.
  - **Blood pressure:** the latest reading.
  - **Staleness:** more than 3 hours since the last Health sync.
  - **Motivation engine (§4.3b):** score, XP and levels, streak, coach line, mascot mood and celebrate events. Award XP idempotently, so re-ingesting can't double it.
  - **Time:** everything in Europe/Berlin.
- [ ] Validate all input: return `400` with a clear message on bad payloads and `401` on a bad token.
- [ ] Write vitest tests covering:
  - sleep across midnight and overlapping samples;
  - an app done entry overriding Apple Health;
  - training on a rest day;
  - skip, then undo;
  - no data at all;
  - the week rollover on Monday;
  - a config edit changing today's plan;
  - score parts with missing data;
  - XP not doubling on repeated ingest;
  - a level-up boundary;
  - a streak surviving rest days and resetting on a skip;
  - the coach rule priority;
  - a celebrate event firing once.
- [ ] Add a smoke script (`backend/scripts/smoke.sh`) that posts sample data with curl against a URL passed in.
- [ ] **[ME]** Connect the repo in Cloudflare (§0 step 3) and set the secrets. Claude Code then verifies the live URL with the smoke script.
- [ ] Run my **pre-deployment** skill on the backend before calling it live.

**Acceptance:** tests pass, the live `*.workers.dev` URL returns a correct dashboard after the smoke test, and wrong tokens get `401`.

---

## Phase 2: Phone app (PWA)

**Tasks**
- [ ] Build the app from §5.2 at `/app` (Today, BP, Plan, History).
- [ ] Add the body map as **inline SVG** built from `tools/body_map/body.svg` (Phase 3). If Phase 3 isn't done yet, start with simple placeholder shapes.
- [ ] Use optimistic UI: buttons respond instantly and roll back with a toast if the request fails.
- [ ] Test the API calls with a local `wrangler dev` plus a headless browser (Playwright) at iPhone viewport size, and take screenshots to check the layout.
- [ ] **[ME]** Open `https://<worker>.workers.dev/app` in Safari → Share → **Add to Home Screen**, then enter the token once.

**Acceptance:**
- Logging "I trained → Push → 55 min" from the phone shows `done` with those muscles in `/api/dashboard`.
- Logging BP appears in the dashboard.
- Editing the plan changes tomorrow's split.
- Screenshots at 390×844 look clean.

---

## Phase 3: Body map assets

**Tasks**
- [ ] Draw an **original**, simple, stylised front and back body as `tools/body_map/body.svg`. Each muscle is its own closed `<path id="<muscle_id>">` (§4.5), plus `silhouette_front` and `silhouette_back`. Use a clean geometric style with small gaps between muscles.
- [ ] Add `preview.html` that colours the muscles from a mock JSON.
- [ ] Write `svg_to_lvgl.py` (cairosvg + Pillow). Each figure is about 140×380px. It should:
  1. Render the silhouette as one image.
  2. Render each muscle as an **A8 alpha mask** cropped to its bounding box, plus its x/y offset.
  3. Emit `firmware/ui/assets/body_assets.c/.h` with a table `{id, img, x, y, view}`.
- [ ] The same SVG is reused by the phone app, so it's a single source of truth.

**Acceptance:** the preview shows push, pull, rest and done correctly, the generated C compiles, and the assets are under about 300 KB.

---

## Phase 4: Desk screen UI (LVGL, tested in the cloud)

**Tasks**
- [ ] Write `firmware/ui/` in **pure LVGL 9** C, with no Arduino includes:
  - `ui_init(lv_display_t*)`
  - `ui_update(const DashboardData*)`
  - `DashboardData` mirroring §4.2.
- [ ] Build the "Training HUD" from §5.1, following the component list in order: HUD bar → score ring → stat rows → BP card → week → body map → coach bar.
- [ ] Prepare the assets:
  - Pre-rendered background (dot grid + glow).
  - Glow sprites.
  - Original icon font.
  - Mascot sprites for the 5 moods (32×32, an original pixel creature; design it in Phase 3 alongside the body).
- [ ] Animations: the score sweep, breathing muscles, the done sweep, the pulsing today dot, the coach fade, and the celebration overlay with confetti. The snapshot tool renders the **final frame**, plus a `--frames` option that dumps 6 frames of a chosen animation so their look can be checked.
- [ ] Write the snapshot tool `tools/snapshot/`. It's a native Linux build (gcc + cmake, run directly in the cloud environment) that:
  1. Creates an 800×480 LVGL display with a memory framebuffer.
  2. Parses a mock JSON (cJSON).
  3. Renders and writes `out/<mock>.png` (stb_image_write).
  4. Is run with `tools/snapshot/run.sh`, which renders all mocks.
- [ ] After every UI change, Claude Code renders the snapshots, **opens the PNGs and checks them itself** (overlaps, clipping, tiny text, alignment), fixes problems, then shows me.

**Acceptance:**
- **Nine clean PNGs** at 800×480, one per mock.
- Each state is instantly distinguishable at a glance (pending, done, rest, perfect, stale).
- No text clipping. Values at least 28px.
- "—" for missing data.
- Celebration frames look exciting, not cluttered.
- Claude Code writes a short self-review of each PNG before showing me.

---

## Phase 5: Firmware (built in the cloud, flashed later)

Board: **Waveshare ESP32-S3-LCD-4.3** (non-touch, 800×480, 16 MB flash / 8 MB PSRAM, USB-C, LiPo header).

**Tasks**
- [ ] Set up `platformio.ini`: `env:esp32s3` with the Arduino framework, PSRAM, LVGL 9 and ArduinoJson. Take the RGB panel timings and the CH422G IO expander setup (backlight and reset) from **Waveshare's official Arduino example for this board**, not from guesses.
- [ ] `main.cpp`:
  - Wi-Fi from `secrets.h`, with auto-reconnect.
  - NTP with `CET-1CEST,M3.5.0,M10.5.0/3`.
  - Fetch `/api/dashboard` on boot and every 10 min, then call `ui_update`.
  - On a fetch error: keep the last data and show "offline".
  - Backlight off from 23:00 to 06:30, configurable. Check Waveshare's docs for whether this board's backlight is only on/off or can be dimmed.
  - Watchdog. Reboot if Wi-Fi has been down for more than 30 min.
- [ ] `api_client`: HTTPS with the Arduino-ESP32 **CA bundle** (no `setInsecure()` in the final version), bearer `DEVICE_TOKEN`, and parsing into `DashboardData`.
- [ ] Add `.github/workflows/firmware.yml` that builds `pio run -e esp32s3` on every push.
  - It produces a **merged** `firmware-merged.bin` (bootloader + partitions + app) as an artifact or release asset.
  - The Wi-Fi credentials and device token come from **GitHub Actions secrets** (`WIFI_SSID`, `WIFI_PASS`, `DEVICE_TOKEN`, `API_URL`) and are injected at build time. They're never committed.
- [ ] **[ME]** Add those 4 secrets in GitHub → repo Settings → Secrets → Actions.
- [ ] Add the browser flasher page `backend/public/flash/`, using **ESP Web Tools** and a `manifest.json` pointing at the latest merged .bin. This lets me flash from Chrome on Windows with **no local install**, via Web Serial. Add `FLASHING.md` with the steps.

**Acceptance:** the CI build is green, the merged .bin is downloadable, the flasher page loads, and the snapshot tool still renders identically (same `ui/` code).

---

## Phase 6: Hardware day (buy the screen now)

**Buy**

| Item | Where | ~Price |
|---|---|---|
| Waveshare **ESP32-S3-LCD-4.3** (non-touch) | eckstein-shop.de (fast, DE) or waveshare.com | ~€25–35 |
| USB-C cable that **carries data** | already have? | €0 |
| USB phone charger (5 V) | already have | €0 |

**Steps [ME, Claude guides]**
1. Flash **Waveshare's demo** first to prove the board works. If they offer a web flasher or a .bin, use that; otherwise Claude Code adds their demo to CI.
2. Open `https://<worker>.workers.dev/flash` in **Chrome or Edge on the PC** → Connect → pick the COM port → Install. You may need to hold BOOT while plugging in the first time.
3. Watch the serial log in the same page for Wi-Fi, time, fetch and render.
4. Compare the real screen to the snapshots, then adjust colours and brightness in code. CI rebuilds, and you reflash from the page.
5. Run it for 48 hours: check reconnects, the backlight schedule and stale detection.
6. **Later:** add OTA updates so the screen updates itself from the latest release, with no cable needed.

**Acceptance:** the screen on my desk shows live data, tapping "I trained" in the app turns the body map green within 10 min, and BP shows after logging.

---

## Phase 7: Apple Health sync (Shortcut)

The app covers the gym and BP, so this Shortcut only brings **sleep, steps, active kcal, food, heart rate and blood oxygen** from Apple Health.

**Tasks**
- [ ] Write `shortcuts/README.md` with exact steps for **"Sync Health"**:
  1. **Find Health Samples** with type Steps, start date today, then **Calculate Statistics** (Sum).
  2. Do the same for Active Energy, Dietary Energy and Protein.
  3. **Find Health Samples** with type Sleep Analysis, last 1 day. **Repeat with Each** to build a list of {start, end, value}.
  4. **Find Health Samples** with type Workouts, today. Loop to build a list of {type, start, duration_min}. This is only a backup for gym detection.
  5. **Dictionary** → **Get Contents of URL**: POST to `/api/ingest`, JSON body, `Authorization` header.
- [ ] **[ME] Automations** (Personal → "Run Immediately", turn off notify):
  - **Health data can't be read while the iPhone is locked.** As far as I know, Shortcuts can't read Health samples on a locked phone, so use triggers that fire while the phone is in use:
    - Alarm stopped (gets the sleep data).
    - App opened (1–2 apps I open daily). Repeats are harmless because the Worker overwrites the day.
    - Time of day 21:00 as a fallback.
  - The food tracker app must have "write to Apple Health" turned on.
  - **Fallback if the Shortcut keeps failing:** use the Health Auto Export app (REST API export, about €8 per year) and add `/api/ingest-hae` to map its format.
- [ ] Claude Code helps debug from the Worker side (logs and the `meta:last_ingest` key).

**Acceptance:** after one normal day, real sleep, steps and food appear on the desk screen.

---

## Phase 8: Later improvements (only when I ask)

- **Battery:** a 3.7 V LiPo with a **PH2.0** plug, 3000–5000 mAh, about €5–10. **Check the polarity before plugging it in.** The board draws about 450 mA, so expect roughly 4–8 hours. It's a charge-daily device.
- **Case:** a 3D-printed stand (university makerspace).
- **Weekly screen:** cycle every 30 s between today and 7-day trends.
- **Recovery hint:** show "Short sleep, consider a lighter session" when sleep is below the goal.
- **Muscle heat-map:** colour by days since each muscle was last trained (the app already logs trained muscles).
- **Exercise logging in the app** (sets, reps, weight) later on, if wanted.
- **Omron RS3 (Bluetooth)** someday: it syncs via OMRON connect → Apple Health, and could be pulled in by the Shortcut.

---

## 9. Cost summary

| Part | Cost |
|---|---|
| Screen board | ~€25–35 |
| Cloudflare Worker + KV + static app | €0 |
| GitHub repo + Actions | €0 |
| iOS Shortcuts + PWA | €0 |
| Optional: Health Auto Export Premium | ~€8 per year |
| Optional: LiPo battery | ~€5–10 |
| **Total (minimum)** | **~€25–35** |
