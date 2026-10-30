#!/usr/bin/env bash
# Run one browser test in CI. On failure, show the end of its output and of the API log as an
# annotation, so the cause is visible on the pull request without opening the full log.
set -uo pipefail
name="$1"; shift
out="$(mktemp)"
"$@" 2>&1 | tee "$out"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  esc() { sed -e 's/%/%25/g' -e 's/\r/%0D/g' | awk 'BEGIN{ORS="%0A"} {print}'; }
  # the error first: GitHub shortens long annotations, and the "ok - " lines before it say little
  echo "::error title=${name} failed::$(grep -v -e '^\s*at ' -e '^ok - ' "$out" | head -n 30 | esc)"
  if [ -f /tmp/api.log ]; then echo "::error title=API log (${name})::$(tail -n 25 /tmp/api.log | esc)"; fi
fi
exit "$status"
