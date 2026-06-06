# Wend — mobile app

> Notes that act.

The Expo client. Captures notes on your phone and dispatches them to Claude
Code running on your Mac (via the [spike daemon](../spike/daemon.mjs)
today; a Swift launchd daemon over Tailscale Funnel in Phase 3). The
response streams **inline into the note** as a foldable block — never a
chat pane.

Master design doc: `~/Desktop/Wend/Design Doc.md`.

## Quick start

```bash
pnpm install
pnpm expo start --tunnel        # ngrok tunnel so a phone can reach Metro
```

Then in another terminal, run the daemon:

```bash
cd ../spike
WEND_SPIKE_TOKEN=<pick-any-secret> node daemon.mjs
ngrok http 9876                 # copy the https://… URL it prints
```

Paste the daemon URL + token into `app/.env.local`:

```
EXPO_PUBLIC_DAEMON_URL=https://xxxx.ngrok-free.app
EXPO_PUBLIC_DAEMON_TOKEN=<the same secret>
EXPO_PUBLIC_DAEMON_CWD=             # leave blank — daemon auto-routes per note
```

Then on your Android phone (with the EAS dev build installed), reload the
app. Type a note, tap send.

## Stack

- **Expo SDK 56** (RN 0.85, React 19.2). Hermes. pnpm.
- **NativeWind 4** + cva. Paper & Ember semantic tokens (`src/theme/`).
- **Clerk** for auth — Google + GitHub OAuth + email verification-code.
- **Zustand** + **TanStack Query** + **AsyncStorage**. (MMKV deferred.)
- **Drizzle ORM** + **Neon Postgres** for the schema. Notes themselves
  currently live LOCAL on the device (Phase 4 adds server sync).
- **Reanimated v4** for sheets, springs, streaming caret.
- **Phosphor icons** (`phosphor-react-native`).
- **Inter Variable** + **JetBrains Mono** via `expo-font`.

## Architecture (current)

```
src/
├── app/
│   ├── _layout.tsx            ClerkProvider + theme + route gate
│   ├── (auth)/sign-in.tsx     S27 — Google / GitHub / email
│   ├── (app)/index.tsx        S1 / S2 — the editor
│   └── oauth-native-callback  fallback for Clerk's default redirect
├── auth/
│   ├── client.ts              Clerk-backed signIn/signOut/email-code hooks
│   ├── useSession.ts          mirrors Clerk → zustand authSlice
│   └── tokenCache.ts          expo-secure-store backing for Clerk
├── components/
│   ├── editor/
│   │   ├── AgentRunBlock.tsx       S3 — readonly run block (streaming/done/error)
│   │   └── FirstNoteCoachmark.tsx  "Tap send to dispatch" tooltip
│   ├── InboxSheet.tsx          pull-up list of notes + FAB + filters
│   ├── SettingsSheet.tsx       overflow ⋮ → account / theme / sign out
│   ├── IntegrationsSheet.tsx   stacked sub-sheet — GitHub / Linear
│   ├── ConnectGitHubSheet.tsx  authorize modal (stacked on Integrations)
│   ├── NoteActionsSheet.tsx    long-press → archive / delete
│   ├── HealthDot.tsx           daemon-reachable indicator
│   └── primitives/             Button / Input / Sheet / StatusDot / Text
├── lib/
│   ├── dispatch/
│   │   ├── useDispatch.ts      POST /run, parse SSE, expose typed events
│   │   └── useDaemonHealth.ts  20s ping of /health
│   ├── notes-storage.ts        local-first persistence (AsyncStorage)
│   └── notes/
│       ├── useNoteEditor.ts    debounced editor state (title/body/runs/cwd)
│       └── useNotesList.ts     inbox feed (with running overlay)
├── store/
│   ├── authSlice.ts            Clerk session mirror
│   ├── dispatchSlice.ts        currently-running note id
│   └── uiSlice.ts              theme preference, toggles
├── theme/
│   ├── tokens.ts               Paper & Ember semantic color tokens
│   ├── ThemeProvider.tsx       resolves scheme, wires NativeWind
│   ├── fonts.ts                Inter + JetBrains Mono
│   └── global.css              CSS-var Tailwind layer
├── db/                         Drizzle schema + client (server sync, Phase 4+)
└── config/env.ts               typed env access (EXPO_PUBLIC_*)
```

## Smart routing (Phase 2 v1)

The daemon scans `~/Desktop`, `~/Code`, `~/Documents` for git repos on
startup and watches for new ones via `fs.watch`. On `/run` without an
explicit `cwd`, it scores the prompt against each repo (name match,
package.json name, README first-line keyword overlap) and dispatches into
the highest-scoring repo. The chosen target is emitted as an SSE
`event: route` before Claude's first frame; the app renders it in the
AgentRunBlock header.

Per-note `cwd` is persisted after the first auto-resolve so follow-ups
stay in the same project without re-running the resolver.

Plan: `[[wend-dispatch-routing]]` memory. Phase 4 swaps the daemon-side
keyword resolver for semantic matching once we have the Swift daemon.

## NativeWind 4 gotcha — critical

NativeWind 4's `cssInterop` is auto-registered on `Pressable`. It mangles
function-form `style={({pressed}) => ({...})}` — drops layout utilities
AND stomps `backgroundColor`. The fix is to put all visual styling on a
non-Pressable parent View; make the Pressable a transparent interaction
overlay inside. This has bit Wend 4 times. See
`[[wend-nativewind-gotcha]]` memory and reference `src/components/InboxSheet.tsx`
FAB or the AgentRunBlock for the proven pattern.

## Scripts

- `pnpm expo start --tunnel` — Metro with ngrok tunnel for phone testing.
- `pnpm tsc --noEmit` — typecheck (must pass before commits).
- `pnpm db:migrate` — Drizzle migration against Neon.
- `eas build -p android --profile development` — EAS dev build (APK).

## Repo layout above `app/`

```
~/Desktop/Wend/
├── app/               this directory — the Expo client
├── landing/           Next.js landing page (separate repo: agnij-dutta/wend-landing)
├── spike/             throwaway Node daemon for Phase 0/2 dispatch — moves to
│                      Swift launchd in Phase 3
├── Design Doc.md      29-screen spec
├── Landing Page Design Doc.md
└── App Tasklist.md    phase-by-phase build plan
```

## Spike daemon endpoints

The Phase 0/2 daemon (`~/Desktop/Wend/spike/daemon.mjs`) exposes:

- `GET  /?t=<token>`        — debug web UI
- `POST /run?t=<token>`     — dispatch a prompt. SSE response of `claude -p` JSONL
                              frames + a `event: route` preamble announcing the
                              chosen project.
- `GET  /health?t=<token>`  — lightweight ping: `{ ok, projects, indexedAt, uptimeMs }`
- `GET  /index?t=<token>`   — full debug list of indexed repos
- `POST /reindex?t=<token>` — force a rebuild (the watcher does this on its own
                              when files change in the scan roots)
