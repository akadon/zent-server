# Zent Server

Backend monorepo for **Zent** — a self-hosted Discord alternative built with TypeScript. Turborepo workspace with four entry points: REST API, auth service, CDN, and WebSocket gateway.

## Quick Start

```bash
# Install dependencies
npm install

# Build shared packages
npx turbo build --filter="@yxc/snowflake" --filter="@yxc/permissions" --filter="@yxc/types" --filter="@yxc/gateway-types"

# Start dev infrastructure (MySQL, Redis, MinIO, LiveKit)
docker compose up -d

# Push database schema
cd apps/api && npx drizzle-kit push && cd ../..

# Start all services
npx turbo dev
```

> Copy `.env.example` to `.env` and fill in your own values before starting. Use `mysql://` connection strings — the schema uses `drizzle-orm/mysql-core`. All secrets must be provided via environment variables — never committed to source.

## Services

| Service | Port | Description |
|---------|------|-------------|
| API | 4000 | REST API (Fastify 5, ~70 endpoints) |
| Auth | 4001 | JWT, MFA (TOTP), passkeys (WebAuthn), sessions |
| Gateway | 4002 | WebSocket (12 opcodes, 27 intents, 55+ events) |
| CDN | 4003 | File upload/serving via S3-compatible storage |

## Stack

Fastify 5.2, MySQL 9.0 (Drizzle ORM), Redis 7 (ioredis), native `ws` WebSocket, MinIO (S3-compatible), Turborepo.

## Structure

```
apps/api/src/
  index.ts              API server (Fastify 5)
  entry-auth.ts         Auth service (JWT, MFA, passkeys)
  entry-cdn.ts          File upload/serving
  entry-gateway.ts      WebSocket gateway
  rest/routes/          22 route files, ~70 endpoints
  services/             36+ business logic files
  repositories/         38 data access files
  db/schema.ts          54 tables (Drizzle ORM, mysql-core)
  gateway/              Real-time event dispatch (Redis pub/sub + Streams)
  middleware/            Auth (JWT), rate limiting (Redis Lua), load shedding
  jobs/                 Scheduled tasks (message expiry, cleanup)

packages/
  types/                Shared TypeScript interfaces
  permissions/          51-flag bitfield permission system
  snowflake/            Distributed ID generator (custom epoch, 42+5+5+12 bits)
  gateway-types/        WebSocket protocol definitions
```

## API Routes

- **Core:** auth, users, guilds, channels, messages, cdn
- **Social:** relationships (friends/blocks), DMs, invites
- **Voice:** voice state, stage channels, soundboard
- **Moderation:** moderation queue, automod rules, ban appeals
- **Advanced:** applications, interactions, webhooks, scheduled events, polls, stickers, search
- **Auth:** MFA (TOTP), passkeys (WebAuthn), recovery keys, email verification, sessions

## Deployment

Runs entirely on **Oracle Cloud Always Free** resources. All traffic routed through Cloudflare (Free plan) and OCI load balancers — backend servers are not directly internet-facing. CI/CD via self-hosted GitHub Actions runner over private VCN.

See `ARCHITECTURE.md` for detailed architecture and deployment information.

## License

Private. All rights reserved.
