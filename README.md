# Zent Server

Backend monorepo for Zent. Turborepo workspace with four entry points: REST API, auth service, CDN, and WebSocket gateway.

## Setup

```bash
npm install
npx turbo build --filter="@yxc/snowflake" --filter="@yxc/permissions" --filter="@yxc/types" --filter="@yxc/gateway-types"
docker compose up mysql redis minio minio-init livekit -d
cd apps/api && npx drizzle-kit push
npx turbo dev
```

API on `:4000`, auth on `:4001`, CDN on `:4003`, gateway on `:4002`. Production: `docker compose up -d`.

## Stack

Fastify 5.2, **MySQL 9.0 HeatWave** (Drizzle ORM, mysql2 driver), Redis 7, Socket.IO 4.8, MinIO (S3-compatible), Caddy.

> `.env.example` incorrectly shows `postgresql://` — use `mysql://yxc:yxc_password@localhost:3306/yxc`. The entire schema and all services use `drizzle-orm/mysql-core`.

## Structure

```
apps/api/
  index.ts            REST API server (Fastify 5, port 4000)
  entry-auth.ts       auth service (JWT, MFA, passkeys) — port 4001
  entry-cdn.ts        file upload/serving — port 4003
  entry-gateway.ts    WebSocket gateway (Socket.IO) — port 4002
  rest/routes/        22 route files, ~70 endpoints
  services/           36+ service files
  db/schema.ts        60+ tables (Drizzle ORM, mysql-core)
  gateway/            real-time event dispatch (Redis pub/sub + Socket.IO adapter)
  middleware/         auth (JWT), rate limiting (Redis Lua sliding window)
  jobs/               scheduled tasks (message expiry, cleanup, Redis leader election)

packages/
  types/              shared TypeScript interfaces (User, Guild, Message, Member, etc.)
  permissions/        51-flag bitfield system (computePermissions, channel overwrites, 2-tier cache)
  snowflake/          custom ID generator (epoch 2024-01-01, 42+5+5+12 bits)
  gateway-types/      WebSocket protocol (12 opcodes, 27 intents, 55+ event types)
  eslint-config/
```

## API Routes

**Core:** auth, users, guilds, channels, messages, cdn
**Social:** relationships (friends/blocks), DMs, invites
**Voice:** voice state, stage channels, soundboard (proxied to zent-voice on port 4005)
**Moderation:** moderation queue, automod rules, ban appeals
**Advanced:** applications (bots), interactions (slash commands), webhooks, scheduled events, polls, stickers, forum tags, message search, public endpoints
**Auth extensions:** MFA (TOTP), passkeys (WebAuthn), recovery keys, email verification, session management

## Database Schema (60+ tables)

Core: `users`, `guilds`, `channels`, `messages`, `roles`, `members`, `memberRoles`, `permissionOverwrites`
Messaging: `messageAttachments`, `messageEmbeds`, `messageReactions`, `messageComponents`, `messageMentions`
Social: `relationships`, `dmChannels`, `readStates`
Guild management: `invites`, `bans`, `webhooks`, `emojis`, `stickers`, `guildScheduledEvents`
Moderation: `auditLogEntries`, `moderationQueue`, `banAppeals`, `automodRules`
Auth: `userSessions`, `passkeys`, `recoveryKeys`, `emailVerificationTokens`
Advanced: `polls`, `pollOptions`, `pollVotes`, `scheduledMessages`, `notificationLog`, `applications`, `applicationCommands`, `interactions`, `serverBackups`, `threadMetadata`, `threadMembers`

**Indexes:** `messages(channel_id, id)`, `channels(guild_id, id)`, `memberRoles(user_id, guild_id)`, `invites(expires_at)`, `auditLogEntries(guild_id, created_at)`

## Gateway Protocol

**12 opcodes:** DISPATCH(0), HEARTBEAT(1), IDENTIFY(2), PRESENCE_UPDATE(3), VOICE_STATE_UPDATE(4), RESUME(6), RECONNECT(7), REQUEST_GUILD_MEMBERS(8), INVALID_SESSION(9), HELLO(10), HEARTBEAT_ACK(11), VOICE_SPATIAL_UPDATE(12)

**27 intents** (3 privileged: GUILD_MEMBERS bit 1, GUILD_PRESENCES bit 8, MESSAGE_CONTENT bit 15)

**Heartbeat:** 41,250ms interval, SESSION_TTL 71s, RESUME_WINDOW 5min (500 events max per session in Redis list)

**Session store:** Redis Hash `session:{socketId}`, resume index `session_idx:{sessionId}`, presence `presence:{userId}` (5min TTL)

## Permission System

51-flag bitfield in `@yxc/permissions`. Computation order:
1. Guild owner → ALL
2. Base = @everyone perms | all role perms
3. ADMINISTRATOR → ALL
4. Channel overwrites: @everyone → roles → member
5. No VIEW_CHANNEL → deny ALL

Two-tier cache: local LRU (5,000 entries, **60s TTL**) + Redis (**60s TTL** — keep these aligned). Singleflight dedup on miss. Invalidation via `perm:invalidate` Redis pub/sub.

## Auth System

- **JWT:** HS256, 7-day expiry, `AUTH_SECRET` (min 64 chars)
- **Passwords:** bcrypt, 12 rounds
- **MFA:** TOTP (SHA1, 6 digits, 30s, ±1 window), 8 backup codes stored hashed
- **WebAuthn:** passkey registration and authentication routes exist
- **Recovery:** bcrypt-hashed one-time recovery keys
- **Sessions:** `userSessions` table exists; session listing/revocation routes at `sessions.ts`

## File Storage

MinIO (S3-compatible). Bucket: `yxc-uploads`. Allowed types: images (JPEG/PNG/GIF/WebP, magic-byte verified), video, audio, pdf, txt, zip, json. Max 50MB. CDN paths: `attachments/{channelId}/{id}/{hash}{ext}`, `avatars/{userId}/{filename}`, `icons/{guildId}/{filename}`, `banners/{guildId}/{filename}`.

## Redis Architecture

Three connections: `redis` (main), `redisPub`, `redisSub`. Key patterns:
- `gateway:guild:{guildId}` — broadcast guild events
- `gateway:user:{userId}` — broadcast user events (DMs, personal)
- `perm:invalidate` — permission cache invalidation (pub/sub)
- `resume:{sessionId}` — event replay buffer (list, max 500, 5min TTL)
- `session:{socketId}` — session data hash (71s TTL)
- `presence:{userId}` — user presence hash (5min TTL)
- `rl:*` — rate limit buckets (sliding window)
- `zent:jobs:leader` — leader election for background jobs

## Rate Limiting

Redis Lua atomic sliding window. Buckets:

| Bucket | Limit | Window |
|--------|-------|--------|
| global | 50 | 1s |
| auth | 5 | 60s |
| messageCreate | 5 | 5s |
| messageDelete | 5 | 1s |
| channelEdit | 10 | 10s |
| guildCreate | 10 | 3600s |
| inviteCreate | 5 | 60s |
| typing | 10 | 10s |
| reaction | 10 | 5s |

Gateway per-opcode limits: IDENTIFY 1/5s, HEARTBEAT 3/41s, PRESENCE_UPDATE 5/60s, VOICE_STATE_UPDATE 5/10s, REQUEST_GUILD_MEMBERS 10/120s.

---

## Known Issues & Bugs

### Security (fix immediately)
- **WebAuthn authentication has zero cryptographic verification** — `passkey.service.ts:151-171`: `authenticatorData` and `signature` from the client are parsed in the Zod schema but never used. The auth succeeds after just finding the credentialId in the DB. An attacker with any user's `credentialId` can authenticate without the private key. **Fix:** replace with `@simplewebauthn/server` v12+.
- **WebAuthn RP ID hardcoded to `"localhost"`** — `passkeys.ts:44`. Must be configurable for production.
- **MFA backup codes use unsalted SHA-256** — `mfa.ts:107-109`: codes have 32 bits of entropy (~4 billion values), rainbow-tableable in seconds. `recoveryKeys` correctly uses bcrypt (`hashPassword`). Apply same pattern to backup codes.
- **No JWT revocation / session invalidation** — `userSessions` table is never read in auth middleware. A compromised or logged-out 7-day token remains valid. **Fix:** short-lived access tokens (15min) + refresh token rotation via Redis.
- **Background job infinite retry loop** — `jobs/index.ts` catches scheduled message errors with `console.error` but never marks the job failed. Same broken message retries forever. Add a `failed` status and mark after N attempts.
- **MANAGE_MESSAGES not checked on delete** — `message.service.ts:deleteMessage()` only checks `authorId !== userId`. Moderators with MANAGE_MESSAGES cannot delete others' messages.
- **Redis pub/sub messages not validated** — `permInvalidateSub` does `JSON.parse(message)` with no schema check. Malformed Redis messages can inject garbage into the permission LRU.
- **No account lockout on failed login** — rate limiter (5/60s) is the only protection against brute-force.

### Performance
- **Blocking Redis SCAN on permission invalidation** — `permission.service.ts:invalidateGuildPermissions()` does a full SCAN across all Redis keys. On large guilds this can block the Redis client. Fix: maintain an explicit Redis Set per guild containing all permission cache keys, delete with SMEMBERS + DEL.
- **Voice states fetched on every guild load** — calls external zent-voice HTTP endpoint with no caching. Cache in Redis with a 5s TTL.
- **Read states loaded unbounded** — `getUserReadStates()` loads all channels with no limit. Load lazily per guild.
- **`getGuildMembers` has no upper bound** — will OOM on large guilds. Add cursor pagination.
- **`incrementMentionCount` is SELECT + UPDATE** — use Drizzle's `onDuplicateKeyUpdate` (already used correctly in `ackMessage`).
- **Permission cache TTL mismatch** — LRU 60s but Redis previously 5min. Both should be 60s to prevent stale data cross-pod.
- **PRESENCE_TTL (5min) >> SESSION_TTL (71s)** — crashed pods appear online for up to 5 minutes. Reduce PRESENCE_TTL to ~90s.

### Missing indexes
- `messages.webhook_id` — queried but not indexed
- `messages.reference_message_id` — used in reply chains, no index
- `scheduled_messages(sent, scheduled_for)` — compound index needed for background job query
- `audit_log_entries.target_id` — queried in moderation views, no index

### Missing / incomplete features
- Password reset email not implemented
- DM presence not dispatched (backend never sends `PRESENCE_UPDATE` to DM participants)
- Thread auto-archive — `autoArchiveDuration` field exists, no background job
- Group DMs — channel type `GROUP_DM` defined, no API routes
- Forum channels — schema + `forumTags.ts` routes exist, thread creation flow incomplete
- Application commands end-to-end — schema + interaction routes exist, dispatch flow needs completion
- Data export — `data-export.service.ts` exists, no REST routes (GDPR requirement)
- Services exist but no routes: `backup.service.ts`, `guild-template.service.ts`, `channel-follow.service.ts`
- Resume buffer — 500 events is too low for high-activity guilds. Increase to 2000.

---

## Technical Improvements

### Testing (highest priority)
Zero test coverage. Recommended stack: **Vitest** (native ESM, fast, first-class Turborepo integration) + **Testcontainers MySQL** for real-DB tests (do not mock Drizzle) + Fastify's `app.inject()` for HTTP routes + `socket.io-mock-ts` for gateway unit tests. Priority order: auth → permissions → gateway → messages → voice.

Add to `turbo.json`: `"test": { "dependsOn": ["^build"] }`. Add per-package `vitest.config.ts` for better cache hit rates.

### Gateway scaling — consider Centrifugo
Socket.IO with the Redis adapter has a structural scaling issue: every node receives every pub/sub message then discards messages for rooms where it has no local clients. Adding more nodes increases total work without reducing per-node load proportionally. Centrifugo (Go) handles 10k connections per 1 vCPU with 1 GB RAM, has built-in smart batching, message history with replay, and presence — and scales to 1M+ connections in Kubernetes. The trade-off is replacing Socket.IO's client SDK with Centrifugo's.

Short term: keep Socket.IO, upgrade to `createShardedAdapter` (Redis 7 cluster-aware, distributes subscriptions across nodes instead of broadcasting to all).

### Redis Streams for durable events
Currently pub/sub is used for all gateway events. Pub/sub is fire-and-forget: if a gateway node restarts during an event, that event is lost even within the session resume window. Switch durable events (MESSAGE_CREATE/UPDATE/DELETE, guild mutations, permission changes) to Redis Streams with consumer groups. Keep pub/sub only for ephemeral events (typing, presence, voice state). This also enables reliable session resume without the current in-memory buffer.

### Event serialization
The current fan-out pipeline serializes the same event multiple times (JSON → Redis → JSON → socket). Serialize once at the source with MessagePack (5-10x faster than JSON), store raw bytes in Redis, and forward raw bytes directly to socket clients without re-serialization. Use `socket.volatile.emit()` for typing and presence (dropping events under load is acceptable for ephemeral state).

### Message search — Meilisearch
MySQL FULLTEXT is not supported on partitioned tables, degrades on high-write workloads, and has no typo tolerance. Deploy Meilisearch as a sidecar pod (Rust binary, native ARM64, sub-50ms search, 1-4 GB for 10M messages). Index messages asynchronously from a Redis Stream consumer.

### JWT / session hardening
Short-lived access token (15 min) in memory only (never localStorage), plus long-lived refresh token in an httpOnly SameSite=Strict cookie sent only to `/api/auth/refresh`. Implement the existing `userSessions` table as the session store. The gateway uses the in-memory access token in the handshake. This eliminates XSS token theft entirely.

### Redis presence pattern
Current: `presence:{userId}` key with 5min TTL. Better: sorted set `presence:guild:{guildId}` with scores = last heartbeat timestamp. ZRANGEBYSCORE to find online members in O(log N). ZADD with NX/XX to heartbeat. ZRANGEBYSCORE with score < (now - 45s) to find stale members. Eliminates per-key TTL churn and enables efficient bulk presence queries.

### Connection pool tuning
Current: 30 connections per replica. With 6 API replicas = 180 connections total. MySQL HeatWave default max_connections is 151 on smaller instances. Reduce to 15 per replica (6 × 15 = 90). Add `waitForConnections: true, queueLimit: 0` for graceful queuing under load.

---

## Market & Product Context

### The Discord exodus (Feb–Mar 2026)
Discord mandated government ID or face scan age verification starting March 2026. Search demand for alternatives spiked 10,000%+. Revolt/Stoat saw 9,900% spike but their servers crashed — they couldn't handle the load. Matrix saw 2,133% increase but has a steep learning curve. Zent is production-deployed, ARM64-optimized, and technically ahead of all open-source alternatives on voice/video and permission system depth.

### What keeps people on Discord (must match these)
1. **Per-user volume sliders in voice calls** — every participant has an individual volume control. Unique to Discord. Not in Zent's voice UI yet. Implementable via LiveKit + client-side GainNode per track.
2. **Bot ecosystem** — 50,000+ bots on top.gg. Without bot API compatibility, migrations require rebuilding all automation. Consider implementing enough of Discord's bot API that existing bots work with minimal changes.
3. **Screen share with audio** — coded in the guild store (`toggleSelfStream`) but no UI button exists.
4. **Network effect** — solve with federation (zent-registrar).

### Competitive advantages Zent has now
- MySQL 9.0 HeatWave with full ACID guarantees vs Revolt's MongoDB
- Full 51-flag permission system with overwrite computation (Revolt has basic roles only)
- LiveKit voice with stage channels and soundboard (Revolt voice "not fully where it needs to be")
- Production K8s deployment with HPA, Prometheus, ArgoCD, TLS via Cloudflare DNS-01
- ARM64-native (free tier OCI VM.Standard.A1.Flex: 4 vCPU, 24GB RAM)
- zent-registrar for federation (no other Discord alternative has this)

### Recommended positioning
"Self-hosted Discord that actually works — voice, permissions, federation, no ID verification, ever."

Target beachhead: open-source project communities fleeing Discord's knowledge-black-hole problem (conversations unsearchable by Google, require login). Make guild channels optionally public and indexable. Discourse charges $100+/month for this. Zent self-hosted is free.

### MLS end-to-end encryption
IETF RFC 9420 (Messaging Layer Security) supports groups up to 50,000 members, provides forward secrecy and post-compromise security. Apple, Google (RCS), and Matrix are all migrating to it. Implementing MLS for DMs would give Zent a feature Discord cannot offer without a full architectural rewrite.
