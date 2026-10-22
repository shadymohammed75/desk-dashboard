# Screens: self-review

## Desk screen (`tools/snapshot/run.sh`, 800×480, rendered from `mock/*.json` with the firmware's `ui/` code)

| Snapshot | What it shows | Verdict |
|---|---|---|
| `push_pending_day.png`, `push_pending_evening.png` | PUSH DAY in orange with its icon, push muscles orange with glow, "LET'S GO" pill, ring 5/9 habits | ✓ |
| `push_done_celebrate.png` | Trained muscles in lime (bottom-to-top sweep), "DONE · 55 MIN", Thursday dot filled orange | ✓ |
| `push_done_celebrate_celebrate.png` | Centred card with trophy badge, "PUSH DAY COMPLETE", "+50 XP · streak 13", confetti behind | ✓ |
| `perfect_day.png`, `perfect_day_celebrate.png` | All 9 habit segments gold with ring glow, "100%", PERFECT DAY tag; perfect-day card | ✓ |
| `spa_day.png` | Sunday: "SPA DAY" in teal, big hot tub with rising steam instead of the body, "RECOVERY DAY" pill, Sunday dot | ✓ |
| `rest_day.png` | Wednesday: "REST DAY" with a big moon | ✓ |
| `morning_short_sleep.png` | Sleep row highlighted, FUEL "—", sleepy Pip, calm coach | ✓ |
| `streak_milestone*.png` | Lime flame "14", hype coach, STREAK 14 card | ✓ |
| all main states | VITALS card as a 2×2 grid: BP (with time), resting HR, heart rate, SpO₂, each with an icon and a big value; no trend chart; "—" when there's no reading | ✓ |
| `no_data.png`, `stale.png` | "—" everywhere and "no sync yet"; amber "data 4h old" | ✓ |

**Fixed during review**
- Ring segments ran together: the rounded ends filled the 6° gaps, so the gaps are now 14°.
- "100%" touched the ring: three-digit scores now use 36 px.
- Steam wisps floated above the tub: they now start at the tub.
- The celebration was only a title on a dark overlay: it is now a centred card, matching the phone.

## Phone app (`backend/e2e/visual.mjs`, 390×844, fixtures from the real Worker; copies in `docs/app-screens/`)

States: push pending, push done + celebration, Sunday spa day, and a history month with mixed data.

**Automated checks (pass):**
- no console or CSP errors;
- every tap target is at least 44 px;
- confetti never draws over the header;
- the celebration auto-closes after 2.5 s;
- one toast at a time, above the nav, with the right text, gone after 2 s.

**Fixed during review**
- Vitals tiles wrapped ("HEART RATE", "BLOOD O₂"): shortened to Heart and SpO₂.
- "33%" crowded the ring segments: the ring is now 96 px and the number 22 px.
- "SPA DAY" wrapped onto two lines next to the status chip: the chip moved up to the date row.
- Plan tiles were truncated ("REST…"): they now show short labels (REST, SPA).
- Split cards listed all 17 muscle chips: they now show a 112 px mini body and the selected muscles, with "Edit muscles" to expand the chips.
- Rest cells in the heat-map were too dark: teal raised to 42%.
- An inline `style` attribute would have broken the CSP: replaced with a class.
