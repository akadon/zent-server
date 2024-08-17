# Zent Server

Backend monorepo for Zent. Turborepo workspace with four entry points: REST API, auth service, CDN, and WebSocket gateway.

## Setup

```bash
npm install
npx turbo build --filter="@yxc/snowflake" --filter="@yxc/permissions" --filter="@yxc/types" --filter="@yxc/gateway-types"
docker compose up postgres redis minio minio-init livekit -d
cd apps/api && npx drizzle-kit push
npx turbo dev
```

API on `:4000`, web on `:3000`. Production: `docker compose up -d`.

## Structure

```
apps/api/
  index.ts            REST API server (Fastify 5)
  entry-auth.ts       auth service (OAuth, MFA, passkeys)
  entry-cdn.ts        file upload/serving
  entry-gateway.ts    WebSocket gateway (Socket.IO)
  routes/             38 route files
  services/           40+ service files
  db/schema.ts        52+ tables (Drizzle ORM)
  gateway/            real-time event dispatch
  middleware/          auth, rate limiting
  jobs/               scheduled tasks (message expiry, temp bans)

packages/
  types/              shared TypeScript interfaces
  permissions/        41-flag bitfield system
  snowflake/          custom ID generator (epoch 2024-01-01)
  gateway-types/      WebSocket protocol definitions
  eslint-config/
```

## API routes

Core: auth, users, guilds, channels, messages, cdn
Social: relationships (friends/blocks), DMs, invites
Voice: voicestate, stage channels, soundboard
Moderation: moderation queue, automod, ban appeals
Advanced: applications (bots), interactions (slash commands), webhooks, events, polls, stickers, forum tags, search, public endpoints
Auth extensions: MFA (TOTP), passkeys (WebAuthn), recovery keys, email verification, session management

## Stack

Fastify 5.2, PostgreSQL 16 (Drizzle ORM), Redis 7, Socket.IO 4.8, Next.js 14, Zustand, TanStack Query, Tailwind, LiveKit, MinIO, Caddy.
