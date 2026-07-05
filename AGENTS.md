# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

## Ship & dev SOP

How to build, verify, OTA, and cut a native build lives in the runbook at
`../AGENTS.md` (repo-root of the Wend workspace), alongside `../CLAUDE.md`. The
short version: JS/TS-only change → `./scripts/ota.sh "changelog"` (publishes to
the `preview` channel + pushes devices); native/`app.json`/SDK change → `eas
build --platform android --profile preview`. Always `npx tsc --noEmit` before
committing.
