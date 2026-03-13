# Zent Server Architecture

A Discord-compatible real-time communication platform built with TypeScript.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 (Alpine) |
| Framework | Fastify 5.2 |
| WebSocket | Native `ws` library |
| ORM | Drizzle ORM (MySQL dialect) |
| Database | MySQL 9.0 (managed) |
| Cache | Redis 7 (ioredis) |
| File Storage | S3-compatible (MinIO for dev) |
| Build | Turborepo monorepo |
| Container | Docker (multi-stage Alpine builds) |
| Orchestration | Kubernetes (prod), Docker Compose (dev) |

## Monorepo Structure

```
zent-server/
├── apps/
│   └── api/                          # All backend services (single codebase, 4 entry points)
│       └── src/
│           ├── index.ts              # API server (Fastify, port 4000) + embedded gateway
│           ├── entry-auth.ts         # Auth service (port 4001)
│           ├── entry-cdn.ts          # CDN/file service (port 4003)
│           ├── entry-gateway.ts      # Standalone gateway (port 4002)
│           ├── config/               # Zod-validated env, S3, Redis config
│           ├── db/                   # 54 Drizzle table definitions, connection pool
│           ├── gateway/              # WebSocket server, sessions, pub/sub, sharding
│           ├── jobs/                 # Background jobs with Redis leader election
│           ├── middleware/           # Auth (JWT), rate limiting, load shedding
│           ├── repositories/         # 38 data access files
│           ├── services/             # 36+ business logic files
│           ├── rest/routes/          # 22 route files (~70 endpoints)
│           └── utils/               # Redis pub/sub + Streams dispatch
├── packages/
│   ├── types/                        # Shared TypeScript interfaces
│   ├── snowflake/                    # Distributed ID generator
│   ├── permissions/                  # 51-flag permission bitfield + computation
│   ├── gateway-types/                # WebSocket protocol (opcodes, intents, events)
│   └── eslint-config/                # Shared linter config
├── docker/                           # Multi-stage Dockerfiles (api, auth, gateway, cdn)
├── k8s/zent/                         # Kubernetes manifests (deployments, ingress, HPA, PDB)
├── management/                       # Monitoring stack (Grafana, Prometheus, OliveTin)
├── docker-compose.yml                # Development environment
├── docker-compose.prod.yml           # Production (standalone Docker Compose)
├── turbo.json
└── package.json                      # Workspace root
```

## Services

### API Server (port 4000)

Main REST API. Handles all non-auth CRUD operations.

- 22 route files covering guilds, channels, messages, users, webhooks, polls, search, etc.
- Fastify with CORS, cookie, multipart (50MB file limit)
- Global rate limiting (50 req/s per user/IP)
- Load shedding middleware (event loop lag based)
- Graceful shutdown with 15s drain timeout
- Embeds the WebSocket gateway when running standalone

### Auth Service (port 4001)

Dedicated authentication service.

- JWT tokens (HS256, 7-day expiry)
- bcrypt password hashing (12 rounds)
- WebAuthn/passkey registration and authentication
- TOTP MFA (SHA1, 30s window, +/-1 drift)
- Session management (list, revoke)
- Email verification, account recovery

### Gateway Service (port 4002)

WebSocket gateway for real-time events.

- Native `ws` library with per-message deflate
- 12 opcodes, 27 intents (3 privileged), 55+ event types
- Session resumption (5-min window, event buffer in Redis)
- Per-opcode rate limiting
- Redis pub/sub for cross-instance event distribution
- Redis Streams for durable message event delivery
- Guild sharding via consistent hash
- Circuit breaker on voice service calls

### CDN Service (port 4003)

File upload/download service.

- S3-compatible backend (MinIO for dev, any S3-compatible for prod)
- Magic-byte file type verification
- 50MB per file, 10 files per request

## Shared Packages

### @yxc/snowflake

Distributed ID generator. 64-bit IDs with custom epoch (2024-01-01). Fields: timestamp (42 bits), process ID (5), worker ID (5), increment (12).

### @yxc/permissions

51-flag permission bitfield system using BigInt. Matches Discord's permission model. Two-tier cache: local LRU + Redis. Singleflight deduplication on cache miss.

### @yxc/gateway-types

Full WebSocket protocol type definitions. Opcodes, intents, 55+ event types, and all payload interfaces.

### @yxc/types

Core shared interfaces: User, Guild, Channel, Message, Member, Role, VoiceState, ReadState, Poll, Notification, etc.

## Database Schema (54 tables)

- **Core:** `users`, `guilds`, `channels`, `messages`, `roles`, `members`, `memberRoles`, `permissionOverwrites`
- **Messaging:** `messageAttachments`, `messageEmbeds`, `messageReactions`, `messageComponents`, `messageStickers`
- **Social:** `relationships`, `dmChannels`, `readStates`
- **Guild:** `invites`, `bans`, `emojis`, `webhooks`, `stickers`, `guildTemplates`
- **Threads:** `threadMetadata`, `threadMembers`, `forumTags`
- **Moderation:** `auditLogEntries`, `automodConfig`, `moderationQueue`, `banAppeals`
- **Auth:** `userSessions`, `passkeyCredentials`, `verificationCodes`, `recoveryKeys`
- **Other:** `polls`, `pollOptions`, `pollVotes`, `scheduledMessages`, `notificationLog`, `applications`, `interactions`

## Redis Usage

Three dedicated connections: main (autopipelining), pub, sub.

| Purpose | Key Pattern | TTL |
|---------|------------|-----|
| Sessions | `session:{connId}` | heartbeat + 30s |
| Resume buffer | `resume:{sessionId}` | 5 min |
| Presence | `presence:{userId}` | 5 min |
| Rate limiting | `rl:{bucket}:{identifier}` | window + 1s |
| Leader election | `zent:jobs:leader` | 30s |
| Event streams | `zent:events:stream` | MAXLEN ~100k |

## Background Jobs

Redis-based leader election (SET NX EX pattern).

| Job | Interval | Description |
|-----|----------|-------------|
| Scheduled messages | 10s | Sends due scheduled messages, 3 retry max |
| Expired message cleanup | 30s | Deletes disappearing messages |

## Resilience Patterns

| Pattern | Implementation |
|---------|---------------|
| **Rate limiting** | Redis Lua sliding window (global + per-bucket) |
| **Load shedding** | Event loop lag monitoring |
| **Circuit breaker** | Voice service calls (5 failures, 30s reset) |
| **Request timeouts** | `AbortSignal.timeout(5000)` on external calls |
| **Graceful shutdown** | API 15s drain, Auth 10s, Gateway sends RECONNECT |
| **Durable delivery** | Redis Streams for critical events |

## Container Security

All production containers are hardened:

- `cap_drop: ALL` — no Linux capabilities
- `no-new-privileges` — prevent privilege escalation
- `read_only` filesystem with tmpfs for `/tmp`
- Health checks with start period
- Resource limits (CPU + memory)
- Non-root users

## Deployment

Designed for self-hosting on minimal infrastructure. The reference deployment runs entirely on **Oracle Cloud Always Free** resources:

- **Compute:** ARM64 (Always Free tier)
- **Database:** MySQL HeatWave (managed, Always Free)
- **Storage:** S3-compatible object storage
- **Networking:** OCI Load Balancers (public-facing), backend on private VCN
- **CDN/DNS:** Cloudflare (Free plan)
- **CI/CD:** GitHub Actions with self-hosted runner (Free tier)

### Traffic Flow

All public traffic is routed through load balancers — backend servers are not directly internet-facing:

1. **Cloudflare** — DDoS protection, CDN caching, DNS
2. **OCI Network Load Balancer** — unlimited bandwidth, handles main API/gateway traffic
3. **OCI Flexible Load Balancer** — 10 Mbps (Always Free), handles auxiliary services

### Kubernetes

Production uses Kubernetes (kubeadm) with:

- Namespace isolation
- Horizontal Pod Autoscalers (HPA)
- Pod Disruption Budgets (PDB)
- Topology spread constraints
- Gateway sharding (1-4 shards via consistent hash)
- Path-based ingress routing

### Docker Compose

For simpler deployments, `docker-compose.prod.yml` provides a single-node production setup with the same security hardening.

## Environment Variables

See `.env.example` for all required and optional variables. All secrets must be provided via environment variables or a secrets manager — never committed to source.
