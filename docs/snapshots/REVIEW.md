# Desk screen snapshots: self-review (Phase 4)

These snapshots were rendered by `tools/snapshot/run.sh` from `mock/*.json` with the same `firmware/ui/` code that runs on the board, at 800×480 RGB565.

Before writing this review I opened every PNG and checked for overlaps, clipping, tiny text and alignment. I fixed the problems I found, which are listed at the end.

| Snapshot | What it shows | Verdict |
|---|---|---|
| `push_pending_day.png` | Orange PUSH DAY, push muscles orange with glow, "LET'S GO" pill, coach "PUSH day loaded…", today ring on Thursday | ✓ clean |
| `push_pending_evening.png` | Same, evening. The pill pulses instead of the today dot (still 2 loops). Coach "Still time. 45 minutes is enough." | ✓ clean |
| `morning_short_sleep.png` | Sleep row highlighted in cyan, 5h40 at 75%. FUEL shows "—" for missing data, never 0. Mascot is sleepy. Coach is calm. | ✓ clean |
| `push_done_celebrate.png` | Final frame after the celebration: lime trained muscles (chest, front delts, triceps), "DONE · 55 MIN", week 3/4 with Thursday filled | ✓ clean |
| `push_done_celebrate_celebrate.png` | Peak of the celebration: dark overlay, gold "PUSH DAY COMPLETE", "+50 XP · streak 13", confetti | ✓ exciting, readable |
| `rest_day.png` | Cyan outline body, "REST DAY" with moon, "RECOVERY DAY" pill, "MUSCLES GROW NOW", Wednesday today ring | ✓ calm, clearly different |
| `perfect_day.png` | 92 in gold with ring glow and a PERFECT tag. Sleep goal hit (trophy, "GOAL ✓", lime blocks). LV 8. | ✓ clean |
| `streak_milestone.png` | Flame and "14" in lime, hype coach "14 days straight. Don't break it." | ✓ clean |
| `streak_milestone_celebrate.png` | "STREAK 14" celebration | ✓ |
| `no_data.png` | Every value "—" in faint text, an empty ring, amber "no sync yet", "Log BP in the app", LV 1 | ✓ clean |
| `stale.png` | Amber dot and "data 4h old" in the HUD; everything else still readable | ✓ clean |

Each state is distinguishable at a glance by the body map colour (orange, lime, cyan or grey), the pill and the title colour.

**Sizes:** values are at least 28 px (blood pressure 36, score 48). Labels are 12 px uppercase and used only for labels.

## Fixed during review

- **Sleep "avg 6h50" ran into the segmented bar.** Blocks narrowed from 11 to 9 px.
- **The glow behind the body map showed a visible ring (RGB565 banding).** Added a 4×4 ordered dither to the pre-rendered background.
- **The celebration overlay was too see-through and looked cluttered.** Raised it from 70% to about 88% and dimmed the banner glow.

## Animation frames (`tools/snapshot/run.sh --frames NAME`)

- **`score`**: the arcs and number sweep from 0 to 86 over 600 ms, with ease-out.
- **`breathe`**: pending muscles and glow go from 55% to 100% and back over 2.4 s.
- **`done`**: lime reveals bottom to top over the figure in 500 ms. The push muscles are in the upper body, so they appear in the second half.
- **`celebrate`**: 3 s total: fade in, confetti falls, fade out, then the XP bar fills.
- **`dot`** and **`pill`**: the today-ring pulse, and the faster evening pill pulse.

## Not verifiable in the cloud

- Real colours and brightness on the panel (Phase 6, step 4).
- Frame rate and CPU use on the ESP32-S3. The animation budget is respected by design: at most 2 looping animations, small invalidated areas, glows pre-rendered.
