# polly

A cross-platform prediction-market **trade journal**. Users connect their
Kalshi account and see their portfolio, trades, and analytics unified across
web, iOS, and Android.

This repo is a pnpm monorepo, built across sessions:

- **Session 1** — the skeleton: Expo client on all three platforms, a Hono
  backend, a shared types package, TypeScript strict mode, Tamagui styling.
- **Session 2** — the data layer and authentication: Postgres + Drizzle, Better
  Auth (email/password), and encrypted-at-rest Kalshi credential storage.

## Stack

| Package           | What it is                                                  |
| ----------------- | ----------------------------------------------------------- |
| `apps/mobile`     | Expo (SDK 55) + Expo Router + Tamagui — web, iOS, Android   |
| `apps/api`        | Hono backend — Postgres/Drizzle, Better Auth, credentials   |
| `packages/shared` | Zod schemas + types shared by client and server            |

## Prerequisites

- **Node** ≥ 20 (developed on 24)
- **pnpm** 9 — `npm install -g pnpm`
- **Postgres** 17 — `brew install postgresql@17 && brew services start postgresql@17`
- **iOS**: Xcode + an iOS Simulator (macOS only)
- **Android**: Android Studio with an emulator (AVD) running

## Setup

```bash
pnpm install
```

The repo uses pnpm's **hoisted** node-linker (`.npmrc`) so Metro and Expo
resolve dependencies reliably.

### Database + environment

Create the database and configure the API's environment:

```bash
createdb polly_dev
cd apps/api
cp .env.example .env          # then fill in the secrets — see below
pnpm db:migrate               # apply the schema to polly_dev
```

`apps/api/.env` needs four secrets (`.env.example` documents each):

| Variable                | How to produce it                                                  |
| ----------------------- | ------------------------------------------------------------------ |
| `DATABASE_URL`          | `postgresql://<you>@localhost:5432/polly_dev`                       |
| `BETTER_AUTH_SECRET`    | `node -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))'` |
| `BETTER_AUTH_URL`       | `http://localhost:3001`                                             |
| `ENCRYPTION_MASTER_KEY` | `node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'` |

The API validates these with Zod at startup and exits immediately with a
readable message if any are missing or malformed.

> `psql`, `createdb`, etc. from Homebrew's `postgresql@17` are not on `PATH` by
> default — prefix with `/usr/local/opt/postgresql@17/bin` (Intel) or
> `/opt/homebrew/opt/postgresql@17/bin` (Apple Silicon) if the commands aren't
> found.

## Running

### Backend — `apps/api`

```bash
pnpm dev:api          # or: pnpm --filter api dev
```

Serves on **http://localhost:3001** (`tsx watch`, `.env` auto-loaded).

### Frontend — `apps/mobile`

Start the backend first, then:

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

The client resolves the API URL per platform (`apps/mobile/lib/config.ts`):

- **Web** and **iOS Simulator** → `http://localhost:3001`
- **Android emulator** → `http://10.0.2.2:3001`
- Override anywhere with `EXPO_PUBLIC_API_URL` — required for physical devices.

## Authentication & credentials

### Better Auth

`apps/api/src/auth.ts` configures [Better Auth](https://better-auth.com):

- **Email/password only** for v0 — no social OAuth.
- **argon2id** password hashing (`@node-rs/argon2`), configured explicitly.
- **30-day sessions**, refreshed at most once a day.
- Better Auth owns the `user` / `session` / `account` / `verification` tables
  (`src/db/auth-schema.ts`) through the Drizzle adapter, and serves
  `/api/auth/*`.
- **Web** uses httpOnly cookies (marked `secure` automatically when
  `BETTER_AUTH_URL` is https). **Native** uses the `@better-auth/expo` plugin,
  which persists the session in Expo SecureStore.

On the client, `lib/auth-client.ts` is the counterpart; `app/_layout.tsx`
hydrates a Zustand auth store (`stores/auth.ts`) from a one-time session check,
and the `(app)` route group redirects unauthenticated users to `/sign-in`.

### Kalshi credential storage — envelope encryption

A user's Kalshi RSA private key is **never stored in plaintext**. See
`src/crypto/envelope.ts`:

1. The private key is encrypted under a fresh, random 32-byte **data
   encryption key (DEK)** with AES-256-GCM.
2. That DEK is itself encrypted under the server's **master key**
   (`ENCRYPTION_MASTER_KEY`, env-only).

Recovering the key requires *both* the master key and the stored row — the
master key alone decrypts nothing. The four ciphertext columns of
`user_kalshi_credentials` map directly onto the sealed-secret shape; the
wrapped DEK carries its own IV + auth tag framed inside `encrypted_dek`.

Decryption happens only in the `validate` endpoint (and, later, the trade
poller) — it is never exposed through a UI endpoint.

### Credential endpoints (all require a session)

| Method + path                      | Purpose                                            |
| ----------------------------------- | -------------------------------------------------- |
| `POST /credentials/kalshi`           | Store/replace the key (sealed before it's saved)   |
| `GET /credentials/kalshi`            | Metadata only — never the private key              |
| `DELETE /credentials/kalshi`         | Remove the stored credential                       |
| `POST /credentials/kalshi/validate`  | Make one authenticated Kalshi call, persist result |

## Project layout

```
polly/
├─ apps/
│  ├─ api/                  Hono backend
│  │  ├─ drizzle/            generated SQL migrations
│  │  ├─ drizzle.config.ts
│  │  └─ src/
│  │     ├─ index.ts         server entry — health, auth, credentials
│  │     ├─ env.ts           Zod-validated environment
│  │     ├─ auth.ts          Better Auth instance
│  │     ├─ db/              Drizzle client, schema, migrate runner
│  │     ├─ crypto/          envelope encryption (+ vitest tests)
│  │     ├─ kalshi/          request signing + validation probe
│  │     ├─ middleware/      requireAuth session gate
│  │     └─ routes/          credential endpoints
│  └─ mobile/               Expo app
│     ├─ app/                file-based routes (Expo Router)
│     │  ├─ _layout.tsx       providers + auth hydration
│     │  ├─ (auth)/           sign-in / sign-up (public)
│     │  └─ (app)/            tabs (auth-gated)
│     ├─ components/          FormField + shared UI
│     ├─ hooks/               auth + credential hooks
│     ├─ lib/                 auth client, API fetcher, query client
│     └─ stores/              Zustand auth store
└─ packages/
   └─ shared/
      └─ src/index.ts         shared Zod schemas
```

## Scripts

| Command                              | Effect                                       |
| ------------------------------------ | -------------------------------------------- |
| `pnpm dev`                           | Run the API and the mobile app in parallel   |
| `pnpm typecheck`                     | `tsc --noEmit` across every package          |
| `pnpm lint`                          | ESLint across the repo                       |
| `pnpm --filter api test`             | Vitest — envelope-encryption unit tests      |
| `pnpm --filter api db:generate`      | Diff the schema → new SQL migration          |
| `pnpm --filter api db:migrate`       | Apply pending migrations                     |
| `pnpm --filter api db:studio`        | Drizzle Studio (browse the database)         |

## Notes & decisions

- **Web is bundled by Metro, not webpack** — Tamagui's Metro + Babel plugins
  cover native *and* web from one configuration.
- **Better Auth, not Lucia** — Lucia is deprecated; Better Auth has a
  first-class Drizzle adapter and an official Expo integration.
- **`@polly/shared`** is consumed as raw TypeScript source (no build step).
- **The master key lives only in `ENCRYPTION_MASTER_KEY`** — never in the
  database, never logged. Rotating it re-wraps DEKs but never the secret
  ciphertext.

## Verified in session 2

- `pnpm typecheck`, `pnpm lint` — clean across all packages.
- `pnpm --filter api test` — 15 envelope-encryption tests pass (roundtrip,
  tampered-ciphertext rejection, wrong-key rejection).
- End-to-end against a live Postgres: sign up → sign in → store a Kalshi
  credential → validate → sign out → sign back in (credential persists) →
  delete. Unauthenticated `/credentials/*` calls return 401; a wrong password
  is rejected.
- Database inspection confirms `encrypted_private_key` / `encrypted_dek` hold
  no plaintext PEM markers, and `account.password` is an `$argon2id$` hash.
- The Expo **web** build bundles (`expo export --platform web`).
- iOS/Android sign-in relies on the `@better-auth/expo` SecureStore
  integration — run in a simulator/emulator to exercise it.
