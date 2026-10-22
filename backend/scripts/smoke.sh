#!/usr/bin/env bash
# Smoke test against a running Worker. Posts sample data for today, then checks the dashboard.
#
#   INGEST_TOKEN=… DEVICE_TOKEN=… backend/scripts/smoke.sh https://desk-dashboard.<you>.workers.dev
#
# Warning: this writes real data for today (sample Health sync, a BP reading, gym "done").
# Pass --keep-gym to leave the gym entry in place; by default it is undone at the end.
set -euo pipefail

BASE="${1:?usage: smoke.sh <base-url> [--keep-gym]}"
BASE="${BASE%/}"
KEEP_GYM="${2:-}"
: "${INGEST_TOKEN:?set INGEST_TOKEN}"
: "${DEVICE_TOKEN:?set DEVICE_TOKEN}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TODAY="$(TZ=Europe/Berlin date +%F)"
YESTERDAY="$(TZ=Europe/Berlin date -d "$TODAY -1 day" +%F)"
NOW="$(TZ=Europe/Berlin date +%FT%T%:z)"
fail=0

check() { # name expected actual
  if [[ "$2" == "$3" ]]; then echo "  ok   $1"; else echo "  FAIL $1 (expected $2, got $3)"; fail=1; fi
}
status() { # method path token [body]
  curl -s -o /dev/null -w '%{http_code}' -X "$1" "$BASE$2" -H "authorization: Bearer $3" \
    -H 'content-type: application/json' ${4:+--data "$4"}
}
call() { # method path token [body]
  curl -sS -f -X "$1" "$BASE$2" -H "authorization: Bearer $3" -H 'content-type: application/json' ${4:+--data "$4"}
}

echo "Smoke test: $BASE (today $TODAY)"
check "health"                         200 "$(status GET /api/health none)"
check "dashboard, wrong token → 401"   401 "$(status GET /api/dashboard wrong-token)"
check "dashboard, ingest token → 401"  401 "$(status GET /api/dashboard "$INGEST_TOKEN")"
check "ingest, device token → 401"     401 "$(status POST /api/ingest "$DEVICE_TOKEN" '{"date":"'"$TODAY"'"}')"
check "bad payload → 400"              400 "$(status POST /api/bp "$INGEST_TOKEN" '{"sys":80,"dia":120}')"
check "app page"                       200 "$(status GET /app/ none)"

call POST /api/ingest "$INGEST_TOKEN" '{
  "date": "'"$TODAY"'", "sent_at": "'"$NOW"'",
  "steps": 8432, "active_kcal": 512, "nutrition": {"kcal": 1850, "protein_g": 120},
  "sleep_samples": [
    {"start": "'"$YESTERDAY"'T23:30:00+02:00", "end": "'"$TODAY"'T03:00:00+02:00", "value": "Core"},
    {"start": "'"$TODAY"'T03:00:00+02:00", "end": "'"$TODAY"'T04:10:00+02:00", "value": "Deep"},
    {"start": "'"$TODAY"'T04:10:00+02:00", "end": "'"$TODAY"'T06:42:00+02:00", "value": "REM"}
  ],
  "workouts": []
}' >/dev/null && echo "  ok   ingest"
call POST /api/bp "$INGEST_TOKEN" '{"sys": 128, "dia": 82, "pulse": 64}' >/dev/null && echo "  ok   bp"
call POST /api/gym "$INGEST_TOKEN" '{"action": "done", "split": "push", "muscles": ["chest","front_delts","triceps"], "duration_min": 55, "note": "smoke test"}' >/dev/null && echo "  ok   gym done"

DASH="$(call GET /api/dashboard "$DEVICE_TOKEN")"
OUT="$(mktemp -d)/live_dashboard.json"
echo "$DASH" > "$OUT"
python3 - "$OUT" <<'PY' || fail=1
import json, sys
d = json.load(open(sys.argv[1]))
checks = {
    "stale is false": d["stale"] is False,
    "steps = 8432": d["steps"]["value"] == 8432,
    "bp = 128/82": (d["bp"] or {}).get("sys") == 128 and d["bp"]["dia"] == 82,
    "gym done": d["gym"]["status"] == "done",
    "trained muscles": d["gym"]["muscles"] == ["chest", "front_delts", "triceps"],
    "sleep counted": (d["sleep"]["asleep_min"] or 0) > 0,
}
bad = [k for k, v in checks.items() if not v]
for k, v in checks.items():
    print(f"  {'ok  ' if v else 'FAIL'} {k}")
sys.exit(1 if bad else 0)
PY
python3 "$HERE/../../mock/validate.py" "$OUT" | sed 's/^/  /' || fail=1

if [[ "$KEEP_GYM" != "--keep-gym" ]]; then
  call POST /api/gym "$INGEST_TOKEN" '{"action": "undo"}' >/dev/null && echo "  ok   gym undo (cleanup)"
fi

echo
echo "$DASH" | python3 -m json.tool | head -40
[[ $fail == 0 ]] && echo "SMOKE PASSED" || { echo "SMOKE FAILED"; exit 1; }
