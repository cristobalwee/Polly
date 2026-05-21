# polly

A cross-platform prediction-market **trade journal**. Users connect their
Kalshi account and see their portfolio, trades, and analytics unified across
web, iOS, and Android.

This repo is a pnpm monorepo. **Session 1** delivers the skeleton: an Expo
client rendering on all three platforms, a Hono backend, a shared types
package, TypeScript strict mode everywhere, and Tamagui for cross-platform
styling.

## Stack

| Package           | What it is                                              |
| ----------------- | ------------------------------------------------------- |
| `apps/mobile`     | Expo (SDK 55) + Expo Router + Tamagui — web, iOS, Android |
| `apps/api`        | Hono backend (Drizzle installed, not yet wired)         |
| `packages/shared` | Zod schemas + types shared by client and server         |

## Prerequisites

- **Node** ≥ 20 (developed on 24)
- **pnpm** 9 — `npm install -g pnpm`
- **iOS**: Xcode + an iOS Simulator (macOS only)
- **Android**: Android Studio with an emulator (AVD) running

## Setup

```bash
pnpm install
```

The repo uses pnpm's **hoisted** node-linker (`.npmrc`) so Metro and Expo
resolve dependencies reliably.

## Running

### Backend — `apps/api`

```bash
pnpm dev:api          # or: pnpm --filter api dev
```

Serves on **http://localhost:3001**. Health check:

```bash
curl http://localhost:3001/health
# {"status":"ok","timestamp":"2026-05-20T..."}
```

### Frontend — `apps/mobile`

Start the backend first (the dashboard fetches its health endpoint), then:

```bash
pnpm --filter mobile dev:web       # browser
pnpm --filter mobile dev:ios       # iOS Simulator
pnpm --filter mobile dev:android   # Android emulator
pnpm --filter mobile dev           # interactive — pick a platform
```

### Both at once

```bash
pnpm dev               # runs api + mobile in parallel
```

## Connecting the client to the API

The dashboard resolves the API URL per platform:

- **Web** and **iOS Simulator** → `http://localhost:3001`
- **Android emulator** → `http://10.0.2.2:3001` (the emulator's alias for the
  host machine)
- Override anywhere with the `EXPO_PUBLIC_API_URL` env var — required for
  physical devices, e.g. `EXPO_PUBLIC_API_URL=http://192.168.1.x:3001`.

## Project layout

```
polly/
├─ apps/
│  ├─ api/                 Hono backend
│  │  └─ src/index.ts       GET /health
│  └─ mobile/              Expo app
│     ├─ app/               file-based routes (Expo Router)
│     │  ├─ _layout.tsx      root: Tamagui provider + Stack
│     │  ├─ (auth)/
│     │  │  ├─ sign-in.tsx
│     │  │  └─ sign-up.tsx
│     │  └─ (app)/
│     │     ├─ _layout.tsx   tab navigator (bottom on native, top on web)
│     │     ├─ index.tsx     dashboard — fetches /health
│     │     ├─ markets.tsx
│     │     ├─ analysis.tsx
│     │     └─ settings.tsx
│     ├─ components/         shared UI helpers
│     ├─ tamagui.config.ts   theme: neutral grays + indigo accent
│     ├─ metro.config.js     Metro + Tamagui (drives native AND web)
│     └─ babel.config.js     Tamagui compiler
└─ packages/
   └─ shared/
      └─ src/index.ts        HealthResponseSchema + HealthResponse type
```

`app/(app)/index.tsx` is the route `/`, so the app opens on the dashboard.
The `(auth)` screens exist at `/sign-in` and `/sign-up` but are not yet linked
— authentication arrives next session.

## Scripts (root)

| Command          | Effect                                       |
| ---------------- | -------------------------------------------- |
| `pnpm dev`       | Run the API and the mobile app in parallel   |
| `pnpm typecheck` | `tsc --noEmit` across every package          |
| `pnpm lint`      | ESLint across the repo                       |

## Notes & decisions

- **Web is bundled by Metro, not webpack.** Expo removed the webpack bundler;
  SDK 55 builds web through Metro. Tamagui's `metro-plugin` + `babel-plugin`
  therefore cover native *and* web from one configuration — there is no
  separate webpack config to maintain.
- **Tamagui theme** is intentionally minimal: Tamagui's neutral-gray default
  tokens (spacing, sizing, radius, fonts) with custom `light`/`dark` themes
  layering a single indigo `$accent`. `<Text color="$accent">` resolves to the
  same value on web and native.
- **`@polly/shared`** is consumed as raw TypeScript source (no build step).
  Both `apps/api` and `apps/mobile` import `HealthResponseSchema` from it.
- **Drizzle** is installed in `apps/api` but not configured — the database
  lands in a later session.

## Verified in session 1

- `pnpm typecheck` — passes across all packages, zero errors.
- `pnpm lint` — clean.
- `apps/api` serves `GET /health` on port 3001.
- `apps/mobile` bundles for web, iOS, and Android (`expo export`).
