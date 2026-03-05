# Zent Server Architecture

A Discord-compatible real-time communication platform built with TypeScript.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 (Alpine) |
| Framework | Fastify 5.2 |
| WebSocket | Native `ws` library |
| ORM | Drizzle ORM (MySQL dialect) |
| Database | MySQL 9.0 (HeatWave managed) |
| Cache | Redis 7 (ioredis) |
| File Storage | MinIO (S3-compatible) |
| Build | Turborepo monorepo |
| Container | Docker (multi-stage Alpine builds) |
| Orchestration | Docker Compose (prod) / Kubernetes (cluster) |

## Monorepo Structure

```
zent-server/
├── apps/
│   └── api/                          # All backend services (single codebase, 4 entry points)
│       ├── src/
│       │   ├── index.ts              # API server (Fastify, port 4000) + embedded gateway
│       │   ├── entry-auth.ts         # Auth service (port 4001)
│       │   ├── entry-cdn.ts          # CDN/file service (port 4003)
│       │   ├── entry-gateway.ts      # Standalone gateway (port 4002)
│       │   ├── config/
│       │   │   ├── env.ts            # Zod-validated environment schema
│       │   │   ├── config.ts         # S3, stream, CORS config (env + config.json)
│       │   │   └── redis.ts          # 3 Redis connections (main, pub, sub)
│       │   ├── db/
│       │   │   ├── schema.ts         # 54 Drizzle table definitions
│       │   │   ├── index.ts          # Connection pool (2000 limit)
│       │   │   └── migrate.ts        # Migration runner
│       │   ├── gateway/
│       │   │   └── index.ts          # WebSocket server, sessions, pub/sub, sharding
│       │   ├── jobs/
│       │   │   └── index.ts          # Background jobs with Redis leader election
│       │   ├── middleware/
│       │   │   ├── auth.ts           # JWT verification
│       │   │   ├── rateLimit.ts      # Redis Lua sliding window
│       │   │   └── loadShedding.ts   # Event loop lag shedding
│       │   ├── repositories/         # 38 data access files
│       │   ├── services/             # 36+ business logic files
│       │   ├── rest/routes/          # 22 route files (~70 endpoints)
│       │   └── utils/
│       │       └── dispatch.ts       # Redis pub/sub + Streams dispatch
│       ├── drizzle.config.ts
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   ├── types/                        # Shared TypeScript interfaces
│   ├── snowflake/                    # Distributed ID generator
│   ├── permissions/                  # 51-flag permission bitfield + computation
│   ├── gateway-types/                # WebSocket protocol (opcodes, intents, events, payloads)
│   └── eslint-config/                # Shared linter config
├── docker/
│   ├── Dockerfile.api                # API image (port 4000)
│   ├── Dockerfile.auth               # Auth image (port 4001)
│   ├── Dockerfile.gateway            # Gateway image (port 4002)
│   ├── Dockerfile.cdn                # CDN image (port 4003)
│   └── Dockerfile.web                # Frontend image (port 3000)
├── k8s/zent/                         # Kubernetes manifests
│   ├── namespace.yaml
│   ├── gateway.yaml                  # 4 replicas, sharding, topology spread
│   ├── auth.yaml                     # 2 replicas, topology spread
│   ├── ingress.yaml                  # Path-based routing (gateway, auth, cdn, api, web)
│   ├── hpa.yaml                      # Autoscalers (api, web, gateway, auth, stream)
│   └── pdb.yaml                      # Disruption budgets (minAvailable: 1 each)
├── management/                       # Server management & monitoring
│   ├── docker-compose.a1flex.yml     # Grafana + Prometheus + OliveTin + CrowdSec
│   ├── docker-compose.micro2.yml     # node-exporter + OliveTin + CrowdSec
│   ├── prometheus/
│   │   ├── prometheus.yml            # Scrape configs (all 3 servers + Zent services)
│   │   └── alerts.yml                # Alert rules (CPU, memory, disk, service health)
│   ├── grafana/
│   │   ├── provisioning/             # Auto-configured datasources + dashboard providers
│   │   └── dashboards/               # Zent infrastructure overview dashboard
│   ├── olivetin/
│   │   └── config.yaml               # Custom action buttons
│   ├── nginx-manage.conf             # Nginx proxy for manage.3aka.com
│   ├── deploy-micro2.sh              # Deploy script for Micro 2
│   └── deploy-a1flex.sh              # Deploy script for A1.Flex
├── docker-compose.yml                # Development (postgres, redis, api, web, caddy)
├── docker-compose.prod.yml           # Production (redis, api, auth, gateway x4)
├── turbo.json
├── tsconfig.base.json
└── package.json                      # Workspace root
```

## Services

### API Server (port 4000)

Main REST API. Handles all non-auth CRUD operations. Entry point: `src/index.ts`.

- 22 route files covering guilds, channels, messages, users, webhooks, polls, search, etc.
- Fastify with CORS, cookie, multipart (50MB file limit)
- Global rate limiting (50 req/s per user/IP)
- Load shedding middleware (event loop lag based)
- Adaptive poll interval (X-Poll-Interval header adjusts based on load)
- Graceful shutdown with 15s drain timeout
- Embeds the WebSocket gateway when running standalone (non-K8s)

### Auth Service (port 4001)

Dedicated authentication service. Entry point: `src/entry-auth.ts`.

- JWT tokens (HS256, 7-day expiry)
- bcrypt password hashing (12 rounds)
- WebAuthn/passkey registration and authentication
- TOTP MFA (SHA1, 30s window, +/-1 drift)
- Session management (list, revoke)
- Email verification, account recovery
- Graceful shutdown with 10s drain timeout

### Gateway Service (port 4002)

WebSocket gateway for real-time events. Entry point: `src/entry-gateway.ts`.

- Native `ws` library with per-message deflate (zlib level 1, threshold 128B)
- 12 opcodes: DISPATCH, HEARTBEAT, IDENTIFY, PRESENCE_UPDATE, VOICE_STATE_UPDATE, RESUME, RECONNECT, REQUEST_GUILD_MEMBERS, INVALID_SESSION, HELLO, HEARTBEAT_ACK, VOICE_SPATIAL_UPDATE
- 27 gateway intents (3 privileged: GUILD_MEMBERS, GUILD_PRESENCES, MESSAGE_CONTENT)
- 55+ event types
- Session resumption (5-min window, 500-event buffer in Redis)
- Per-opcode rate limiting (in-memory sliding window)
- Redis pub/sub for cross-instance event distribution
- Redis Streams for durable message event delivery
- Guild sharding via consistent hash (guildId → shard)
- TCP-level liveness via ws ping/pong (30s interval)
- Circuit breaker on voice service calls (5 failures → open, 30s reset)
- Request timeouts (5s AbortSignal) on external calls
- 500K max connections per instance
- Graceful shutdown: sends RECONNECT to all clients, stores session indexes

### CDN Service (port 4003)

File upload/download service. Entry point: `src/entry-cdn.ts`.

- MinIO (S3-compatible) backend
- Routes: `/cdn/attachments/`, `/avatars/`, `/icons/`, `/emojis/`, `/banners/`
- Magic-byte file type verification
- 50MB per file, 10 files per request

## Shared Packages

### @yxc/snowflake

Distributed ID generator. 64-bit IDs with custom epoch (2024-01-01).

| Field | Bits |
|-------|------|
| Timestamp | 42 |
| Process ID | 5 |
| Worker ID | 5 |
| Increment | 12 |

Pod hostname is hashed to derive worker/process IDs for uniqueness across replicas.

### @yxc/permissions

51-flag permission bitfield system using BigInt. Matches Discord's permission model.

- `computePermissions()`: guild owner → base roles → administrator check → channel overwrites (@everyone → roles → member)
- Two-tier cache: local LRU (5,000 entries, 60s TTL) + Redis (60s TTL)
- Singleflight deduplication on cache miss

Key flags: CREATE_INSTANT_INVITE, KICK_MEMBERS, BAN_MEMBERS, ADMINISTRATOR, MANAGE_CHANNELS, MANAGE_GUILD, VIEW_CHANNEL, SEND_MESSAGES, MANAGE_MESSAGES, CONNECT, SPEAK, MANAGE_ROLES, MANAGE_WEBHOOKS, MODERATE_MEMBERS, USE_SOUNDBOARD, MANAGE_AUTOMOD, + 35 more.

### @yxc/gateway-types

Full WebSocket protocol type definitions. Opcodes, intents, 55+ event types, and all payload interfaces for both client→server and server→client communication. Includes rich presence (activities, custom status), interactions (slash commands, buttons, modals), voice spatial audio, soundboard, and automod payloads.

### @yxc/types

Core shared interfaces: User, Guild, Channel, Message, Member, Role, VoiceState, ReadState, Poll, Notification, GuildEvent, ModerationQueueItem.

## Database Schema (54 tables)

### Core
`users`, `guilds`, `channels`, `messages`, `roles`, `members`, `memberRoles`, `permissionOverwrites`

### Messaging
`messageAttachments`, `messageEmbeds`, `messageReactions`, `messageComponents`, `messageStickers`

### Social
`relationships` (friend/block), `dmChannels`, `readStates`

### Guild Features
`invites`, `bans`, `emojis`, `webhooks`, `stickers`, `guildTemplates`, `guildWelcomeScreens`, `guildOnboarding`, `guildWidgets`, `guildPreviews`

### Threads & Forums
`threadMetadata`, `threadMembers`, `threadTemplates`, `forumTags`, `forumPostTags`, `channelFollowers`

### Moderation
`auditLogEntries`, `automodConfig`, `moderationQueue`, `banAppeals`

### Events & Scheduling
`guildEvents`, `guildEventUsers`, `scheduledMessages`

### Interactions & Apps
`applications`, `applicationCommands`, `interactions`

### Polls
`polls`, `pollOptions`, `pollVotes`

### Auth & Sessions
`userSessions`, `passkeyCredentials`, `verificationCodes`, `recoveryKeys`

### Other
`notificationLog`, `notificationSettings`, `userActivities`, `userNotes`, `serverBackups`

### Key Indexes
- `messages(channel_id, id)` — pagination
- `channels(guild_id, id)` — guild channel listing
- `memberRoles(user_id, guild_id)` — permission lookups
- `invites(expires_at)` — expiration cleanup
- `auditLogEntries(guild_id, created_at)` — audit filtering

## Redis Usage

Three dedicated connections: main (autopipelining), pub, sub.

| Purpose | Key Pattern | TTL |
|---------|------------|-----|
| Sessions | `session:{connId}` | heartbeat interval + 30s |
| Session index | `session_idx:{sessionId}` | 5 min (resume window) |
| Resume buffer | `resume:{sessionId}` | 5 min, max 500 events |
| Presence | `presence:{userId}` | 5 min |
| Rate limiting | `rl:{bucket}:{identifier}` | window + 1s |
| Leader election | `zent:jobs:leader` | 30s |
| Job failure tracking | `jobs:fail:{id}` | 24h |
| Event streams | `zent:events:stream` | MAXLEN ~100k |

Pub/sub channels: `gateway:guild:{guildId}`, `gateway:user:{userId}`.

## Background Jobs

Redis-based leader election (SET NX EX pattern, 30s TTL, 10s renewal).

| Job | Interval | Description |
|-----|----------|-------------|
| Scheduled messages | 10s | Sends due scheduled messages, 3 retry max |
| Expired message cleanup | 30s | Deletes disappearing messages, dispatches MESSAGE_DELETE |

## Production Deployment (Docker Compose)

**Server:** Oracle Cloud A1.Flex — 4 OCPUs, 24GB RAM, ARM64

| Service | Port | Memory | CPU | Instances |
|---------|------|--------|-----|-----------|
| Redis | 6379 | 18G | 1.0 | 1 |
| API | 4000 | 800M | 0.5 | 1 |
| Auth | 4001 | 400M | 0.25 | 1 |
| Gateway 1 | 4002 | 1G | 0.5 | shard 0/4 |
| Gateway 2 | 4012 | 1G | 0.5 | shard 1/4 |
| Gateway 3 | 4022 | 1G | 0.5 | shard 2/4 |
| Gateway 4 | 4032 | 1G | 0.5 | shard 3/4 |

Total: ~23.2G allocated (0.8G for OS).

Redis config: 16GB maxmemory, volatile-lru eviction, AOF disabled (RDB snapshots every 5min/1000 changes), 500K maxclients, tcp-backlog 65535.

All containers: `cap_drop: ALL`, `no-new-privileges`, `read_only` filesystem, health checks (10s interval, 2 retries), `restart: unless-stopped`, 1M+ file descriptors on gateways.

## Kubernetes Deployment

**Namespace:** `zent`

| Component | Replicas | HPA min/max | CPU target |
|-----------|----------|-------------|------------|
| API | 1 | 1 / 3 | 60% |
| Auth | 2 | 1 / 3 | 60% |
| Gateway | 4 | 4 / 8 | 50% |
| Web | 1 | 1 / 2 | 65% |
| Stream | 1 | 1 / 2 | 50% |
| Redis | 1 | — | — |

Ingress: path-based routing (`/gateway` → gateway, `/api/auth` → auth, `/api/cdn` → cdn, `/api` → api, `/` → web).

Pod disruption budgets: `minAvailable: 1` for all services.

Gateway topology spread: `maxSkew: 1`, `kubernetes.io/hostname`, `ScheduleAnyway`.

## Nginx Reverse Proxy (Docker Compose mode)

Site config: `/etc/nginx/sites-enabled/api.3aka.com`

- Upstreams: `zent_api` (4000), `zent_auth` (4001), `zent_gateway` (4002, 4012, 4022, 4032)
- Keepalive pools: API 128, Auth 32, Gateway 256 (keepalive_requests 10000, timeout 120)
- Worker connections: 65535, rlimit_nofile 1048576
- Rate limits: general 100r/s, API 200r/s
- WebSocket upgrade for `/gateway` path
- Proxy buffers: 16x32k + busy_buffers_size 64k

## Resilience Patterns

| Pattern | Implementation |
|---------|---------------|
| **Rate limiting** | Redis Lua sliding window (global + per-bucket) |
| **Load shedding** | Event loop lag monitoring (warn 100ms, critical 500ms) |
| **Circuit breaker** | Voice service calls (5 failures → open, 30s reset, half-open probe) |
| **Request timeouts** | `AbortSignal.timeout(5000)` on external service calls |
| **Retry with jitter** | Exponential backoff + full jitter on all Redis connections (base 50ms, cap 3s) |
| **Graceful shutdown** | API 15s drain, Auth 10s drain, Gateway sends RECONNECT + stores sessions |
| **Health checks** | Dependency verification (DB + Redis), event loop lag, draining awareness (503) |
| **Request coalescing** | Singleflight on permission cache miss |
| **Durable delivery** | Redis Streams for critical message events (MAXLEN ~100k) |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | yes | — | MySQL connection string |
| `REDIS_URL` | no | `redis://localhost:6379` | Redis connection |
| `AUTH_SECRET` | yes | — | JWT signing key (min 32 chars) |
| `API_PORT` | no | 4000 | HTTP port |
| `API_HOST` | no | 0.0.0.0 | Bind address |
| `NODE_ENV` | no | development | development / production / test |
| `CORS_ORIGIN` | no | `http://localhost:3000` | Comma-separated origins |
| `MINIO_ENDPOINT` | no | localhost | S3 endpoint |
| `MINIO_PORT` | no | 9000 | S3 port |
| `MINIO_ACCESS_KEY` | no | minioadmin | S3 access key |
| `MINIO_SECRET_KEY` | no | minioadmin | S3 secret key |
| `MINIO_BUCKET` | no | yxc-uploads | S3 bucket name |
| `MINIO_USE_SSL` | no | false | S3 TLS |
| `VOICE_SERVICE_URL` | no | — | Voice/stream service URL |
| `VOICE_INTERNAL_KEY` | no | — | Internal API key for voice |
| `RP_ID` | no | 3aka.com | WebAuthn relying party ID |
| `RP_ORIGIN` | no | `https://3aka.com` | WebAuthn origin |
| `ENABLE_PRESENCE` | no | false | Enable presence broadcasts |
| `GATEWAY_HEARTBEAT_INTERVAL` | no | 60000 | Heartbeat interval (ms) |
| `WORKER_ID` | no | 1 | Snowflake worker ID (1-31) |
| `PROCESS_ID` | no | 1 | Snowflake process ID (1-31) |
| `SHARD_ID` | no | 0 | Gateway shard index |
| `NUM_SHARDS` | no | 1 | Total gateway shards |
| `GATEWAY_PORT` | no | 4002 | Gateway listen port |

## Management & Monitoring Stack

Single pane of glass at `manage.3aka.com`. Configs in `management/`.

### Infrastructure Overview

```
Clients (https://3aka.com)
  ↓ Cloudflare → Nginx

Oracle Cloud Always Free
├── A1.Flex (4 OCPU, 24GB ARM64) — 193.123.36.192
│   ├── Zent Stack (docker-compose.prod.yml)
│   │   ├── Redis 7 (16GB, port 6379)
│   │   ├── API (port 4000)
│   │   ├── Auth (port 4001)
│   │   └── Gateway x4 (ports 4002, 4012, 4022, 4032)
│   ├── Management Stack (management/docker-compose.a1flex.yml)
│   │   ├── Grafana (port 3100 → manage.3aka.com)
│   │   ├── Prometheus (port 9190)
│   │   ├── OliveTin (port 1337 → manage.3aka.com/olivetin/)
│   │   ├── CrowdSec (log-based IDS)
│   │   └── node-exporter (port 9100)
│   ├── Cockpit (port 9090, VCN only)
│   └── Nginx reverse proxy
│
├── Micro 1 — AMD (1GB) — 158.101.199.90
│   ├── SeaweedFS S3 + Filestash
│   ├── Cockpit
│   └── node-exporter → scraped by central Prometheus
│
├── Micro 2 — AMD (1GB) — 144.21.37.202 (NOT a K8s node)
│   ├── Registrar (nginx static site)
│   ├── Management (management/docker-compose.micro2.yml)
│   │   ├── OliveTin (local actions)
│   │   ├── CrowdSec (log-based IDS)
│   │   └── node-exporter → scraped by central Prometheus
│   ├── Cockpit (port 9090, VCN only)
│   └── kubectl access to K8s cluster (management only, no workloads)
│
├── MySQL HeatWave (10.0.10.19:3306, managed)
└── Cloudflare (frontend CDN + DNS + Access zero-trust)
```

### Management Components

| Component | Location | Port | RAM | Purpose |
|-----------|----------|------|-----|---------|
| **Grafana** | A1.Flex | 3100 | ~120MB | Dashboards, alerts, OliveTin embed |
| **Prometheus** | A1.Flex | 9190 | ~25MB | Metrics collection (30d retention, 2GB cap) |
| **OliveTin** | A1.Flex + Micro 2 | 1337 | ~3MB | Custom action buttons (restart, reboot, status) |
| **CrowdSec** | A1.Flex + Micro 2 | 8080 | ~40MB | Log-based intrusion detection + community blocklists |
| **node-exporter** | All servers | 9100 | ~3MB | Host metrics (CPU, RAM, disk, network, TCP) |
| **Cockpit** | All servers | 9090 | ~50MB idle | Host-level GUI (reboots, updates, storage, network) |

Total management overhead: ~240MB on A1.Flex, ~70MB on Micro 2.

### Access Model

- **Grafana** (`manage.3aka.com`): Single pane — dashboards, alerts, embedded OliveTin
- **Cockpit** (port 9090): Host management — VCN-only access, linked from Grafana
- **OliveTin**: Custom buttons — restart services, reboot servers, check logs, block IPs
- **RBAC**: Grafana Viewer role for junior devs (metrics + OliveTin buttons, no config changes)

### OliveTin Actions (Config: `management/olivetin/config.yaml`)

| Action | Command | Scope |
|--------|---------|-------|
| Restart Zent API/Auth/Gateway | `docker restart <service>` | A1.Flex |
| Redeploy Zent Stack | `docker compose up -d` | A1.Flex |
| Check All Services | `curl /health` on all ports | A1.Flex |
| Docker/Redis Status | `docker ps`, `redis-cli INFO` | A1.Flex |
| Reboot Micro 1/2 | SSH + `sudo reboot` | Remote |
| Remote Server Status | SSH + `free -h && df -h` | Remote |
| Nginx Reload | `nginx -t && reload` | A1.Flex |
| Block IP | `ufw deny from <ip>` | A1.Flex |
| CrowdSec Decisions | `cscli decisions list` | A1.Flex |
| fail2ban Status | `fail2ban-client status` | A1.Flex |
| View Logs | `docker logs --tail 50` | A1.Flex |

### Prometheus Targets

| Job | Target | Labels |
|-----|--------|--------|
| node-a1flex | localhost:9100 | server=a1flex, role=main |
| node-micro2 | 144.21.37.202:9100 | server=micro2, role=registrar |
| node-micro1 | 158.101.199.90:9100 | server=micro1, role=seaweedfs |
| zent-api | localhost:4000 | service=api |
| zent-auth | localhost:4001 | service=auth |
| zent-gateway | localhost:4002,4012,4022,4032 | service=gateway |
| crowdsec | localhost:6060 | service=crowdsec |

### Alerts (Prometheus: `management/prometheus/alerts.yml`)

- **HighCPU**: >85% for 5min
- **HighMemory**: >90% for 5min
- **DiskSpaceLow**: >85% used for 5min
- **HostDown**: unreachable for 2min
- **ZentServiceDown**: health check failing for 1min
- **HighNetworkTraffic**: >100MB/s inbound for 5min

### Deploy Scripts

```bash
# Deploy management on Micro 2
bash management/deploy-micro2.sh

# Deploy management on A1.Flex
bash management/deploy-a1flex.sh
```

## OS Tuning (Production)

Applied via `/etc/sysctl.d/99-perf.conf`:

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `net.core.somaxconn` | 262144 | TCP listen backlog |
| `net.ipv4.tcp_max_syn_backlog` | 262144 | SYN queue |
| `net.core.netdev_max_backlog` | 262144 | Network device queue |
| `fs.file-max` | 10485760 | System-wide file descriptor limit |
| `net.core.rmem_max` | 67108864 | Max receive buffer (64MB) |
| `net.core.wmem_max` | 67108864 | Max send buffer (64MB) |
| `net.ipv4.tcp_keepalive_probes` | 3 | Faster dead connection detection |
| `net.ipv4.tcp_congestion_control` | bbr | BBR congestion control |
