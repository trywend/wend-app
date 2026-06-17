#!/usr/bin/env bash
#
# Publish an OTA update AND notify every registered phone with a push.
#
#   scripts/ota.sh "<message>" [branch]
#
# branch defaults to "preview" (the alpha sideload channel). The EAS
# environment is matched to the branch name.
#
# The push step requires WEND_BROADCAST_SECRET (the same value set on the
# landing Vercel deployment). Without it, the OTA still publishes and the
# script exits 0 after warning — the in-app banner alone will surface the
# update on next launch.
set -euo pipefail

MSG="${1:?usage: scripts/ota.sh \"<message>\" [branch]}"
BRANCH="${2:-preview}"
BASE="${EXPO_PUBLIC_RENDEZVOUS_BASE:-https://wend-landing.vercel.app}"

cd "$(dirname "$0")/.."

echo "→ Publishing OTA to branch '$BRANCH'…"
npx eas update --branch "$BRANCH" --environment "$BRANCH" \
  --message "$MSG" --non-interactive

if [[ -z "${WEND_BROADCAST_SECRET:-}" ]]; then
  echo "⚠ WEND_BROADCAST_SECRET unset — skipping push. The in-app banner will"
  echo "  still show the update on next launch. Export the secret to also push."
  exit 0
fi

echo "→ Broadcasting update push…"
PAYLOAD=$(MSG="$MSG" python3 - <<'PY'
import json, os
msg = os.environ["MSG"]
print(json.dumps({
    "title": "Wend updated",
    "body": f"{msg} — open Wend and restart to get it.",
    "data": {"type": "ota"},
}))
PY
)

curl -fsS -X POST "$BASE/api/notifications/broadcast" \
  -H "Authorization: Bearer $WEND_BROADCAST_SECRET" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD"
echo
echo "✓ Done."
