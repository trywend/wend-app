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

cd "$(dirname "$0")/.."

# CRITICAL: `eas update --environment <env>` resolves env vars from the EAS
# environment STORE, which is empty for us — the EXPO_PUBLIC_* values live in
# eas.json's build profiles. Exporting an empty Clerk key drops <ClerkProvider>
# and crash-loops the app on launch. So we inline the build profile's
# EXPO_PUBLIC_* vars into the shell here; Metro reads process.env at export
# time and bakes them into the bundle. eas.json stays the single source.
echo "→ Loading EXPO_PUBLIC_* from eas.json profile '$BRANCH'…"
ENV_EXPORTS=$(BRANCH="$BRANCH" python3 - <<'PY'
import json, os, shlex
branch = os.environ["BRANCH"]
with open("eas.json") as f:
    cfg = json.load(f)
env = (cfg.get("build", {}).get(branch, {}) or {}).get("env", {}) or {}
pub = {k: v for k, v in env.items() if k.startswith("EXPO_PUBLIC_")}
if not pub:
    raise SystemExit(f"no EXPO_PUBLIC_* vars in eas.json build.{branch}.env")
for k, v in pub.items():
    print(f"export {k}={shlex.quote(str(v))}")
PY
)
eval "$ENV_EXPORTS"
echo "$ENV_EXPORTS" | sed 's/=.*/ ✓/'

echo "→ Publishing OTA to branch '$BRANCH'…"
npx eas update --branch "$BRANCH" --environment "$BRANCH" \
  --message "$MSG" --non-interactive

if [[ -z "${WEND_BROADCAST_SECRET:-}" ]]; then
  echo "⚠ WEND_BROADCAST_SECRET unset — skipping push. The in-app banner will"
  echo "  still show the update on next launch. Export the secret to also push."
  exit 0
fi

BASE="${EXPO_PUBLIC_RENDEZVOUS_BASE:-https://wend-landing.vercel.app}"
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
