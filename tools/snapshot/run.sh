#!/usr/bin/env bash
# Build the native snapshot tool and render the desk screen for every mock.
#
#   tools/snapshot/run.sh                         → out/<mock>.png (+ out/<mock>_celebrate.png when it has one)
#   tools/snapshot/run.sh --frames NAME [MOCK]    → out/frames/<mock>_<NAME>_0..5.png
#        NAME: score | breathe | done | dot | coach | celebrate | pill   (default MOCK: push_done_celebrate)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD="$ROOT/out/snapshot-build"
OUT="$ROOT/out"

cmake -S "$ROOT/tools/snapshot" -B "$BUILD" -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$BUILD" -j"$(nproc)" >/dev/null
BIN="$BUILD/snapshot"

if [[ "${1:-}" == "--frames" ]]; then
  NAME="${2:?animation name}"
  MOCK="${3:-push_done_celebrate}"
  mkdir -p "$OUT/frames"
  "$BIN" "$ROOT/mock/$MOCK.json" "$OUT/frames/$MOCK" --frames "$NAME"
  exit 0
fi

mkdir -p "$OUT"
for f in "$ROOT"/mock/*.json; do
  name="$(basename "$f" .json)"
  "$BIN" "$f" "$OUT/$name.png"
  if grep -q '"celebrate": {' "$f"; then
    "$BIN" "$f" "$OUT/${name}_celebrate.png" --celebrate
  fi
done
