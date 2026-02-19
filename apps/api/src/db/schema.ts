import {
  mysqlTable,
  varchar,
  text,
  int,
  bigint,
  boolean,
  datetime,
  json,
  primaryKey,
  index,
  uniqueIndex,
  serial,
  unique,
  mysqlEnum,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// ── Users ──
export const users = mysqlTable(
  "users",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    username: varchar("username", { length: 255 }).notNull(),
    displayName: text("display_name"),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    avatar: text("avatar"),
    banner: text("banner"),
    bio: text("bio"),
    status: mysqlEnum("status", ["online", "idle", "dnd", "offline"])
      .notNull()
      .default("offline"),
    customStatus: json("custom_status").$type<{ text?: string; emoji?: string } | null>(),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    mfaSecret: text("mfa_secret"),
    mfaBackupCodes: json("mfa_backup_codes").$type<string[]>(),
    verified: boolean("verified").notNull().default(false),
    flags: int("flags").notNull().default(0),
    premiumType: int("premium_type").notNull().default(0),
    locale: varchar("locale", { length: 10 }).notNull().default("en-US"),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
    updatedAt: datetime("updated_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    uniqueIndex("users_username_idx").on(table.username),
  ]
);

// ── Guilds ──
export const guilds = mysqlTable(
  "guilds",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    name: text("name").notNull(),
    icon: text("icon"),
    banner: text("banner"),
    splash: text("splash"),
    ownerId: varchar("owner_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    description: text("description"),
    verificationLevel: int("verification_level").notNull().default(0),
    defaultMessageNotifications: int("default_message_notifications").notNull().default(0),
    explicitContentFilter: int("explicit_content_filter").notNull().default(0),
    features: json("features").$type<string[]>().notNull().default([]),
    systemChannelId: varchar("system_channel_id", { length: 64 }),
    rulesChannelId: varchar("rules_channel_id", { length: 64 }),
    vanityUrlCode: text("vanity_url_code"),
    premiumTier: int("premium_tier").notNull().default(0),
    premiumSubscriptionCount: int("premium_subscription_count").notNull().default(0),
    preferredLocale: varchar("preferred_locale", { length: 10 }).notNull().default("en-US"),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
    updatedAt: datetime("updated_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("guilds_owner_id_idx").on(table.ownerId),
  ]
);

// ── Channels ──
export const channels = mysqlTable(
  "channels",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 64 }).references(() => guilds.id, { onDelete: "cascade" }),
    type: int("type").notNull().default(0),
    name: text("name"),
    topic: text("topic"),
    position: int("position").notNull().default(0),
    parentId: varchar("parent_id", { length: 64 }),
    nsfw: boolean("nsfw").notNull().default(false),
    rateLimitPerUser: int("rate_limit_per_user").notNull().default(0),
    bitrate: int("bitrate"),
    userLimit: int("user_limit"),
    lastMessageId: varchar("last_message_id", { length: 64 }),
    ownerId: varchar("owner_id", { length: 64 }),
    flags: int("flags").notNull().default(0),
    messageRetentionSeconds: int("message_retention_seconds"),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("channels_guild_id_idx").on(table.guildId),
    index("channels_parent_id_idx").on(table.parentId),
  ]
);

// ── Messages ──
export const messages = mysqlTable(
  "messages",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    channelId: varchar("channel_id", { length: 64 })
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    authorId: varchar("author_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull().default(""),
    type: int("type").notNull().default(0),
    flags: int("flags").notNull().default(0),
    tts: boolean("tts").notNull().default(false),
    mentionEveryone: boolean("mention_everyone").notNull().default(false),
    pinned: boolean("pinned").notNull().default(false),
    editedTimestamp: datetime("edited_timestamp", { mode: "date" }),
    referencedMessageId: varchar("referenced_message_id", { length: 64 }),
    webhookId: varchar("webhook_id", { length: 64 }),
    nonce: text("nonce"),
    expiresAt: datetime("expires_at", { mode: "date" }),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("messages_channel_id_idx").on(table.channelId),
    index("messages_channel_created_idx").on(table.channelId, table.id),
    index("messages_author_id_idx").on(table.authorId),
  ]
);

// ── Roles ──
export const roles = mysqlTable(
  "roles",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 64 })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    color: int("color").notNull().default(0),
    hoist: boolean("hoist").notNull().default(false),
    icon: text("icon"),
    position: int("position").notNull().default(0),
    permissions: varchar("permissions", { length: 64 }).notNull().default("0"),
    managed: boolean("managed").notNull().default(false),
    mentionable: boolean("mentionable").notNull().default(false),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [index("roles_guild_id_idx").on(table.guildId)]
);

// ── Members ──
export const members = mysqlTable(
  "members",
  {
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    guildId: varchar("guild_id", { length: 64 })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    nickname: text("nickname"),
    avatar: text("avatar"),
    joinedAt: datetime("joined_at", { mode: "date" }).notNull().default(sql`NOW()`),
    premiumSince: datetime("premium_since", { mode: "date" }),
    deaf: boolean("deaf").notNull().default(false),
    mute: boolean("mute").notNull().default(false),
    pending: boolean("pending").notNull().default(false),
    communicationDisabledUntil: datetime("communication_disabled_until", { mode: "date" }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.guildId] }),
    index("members_guild_id_idx").on(table.guildId),
    index("members_user_id_idx").on(table.userId),
  ]
);

// ── Member Roles ──
export const memberRoles = mysqlTable(
  "member_roles",
  {
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    guildId: varchar("guild_id", { length: 64 })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    roleId: varchar("role_id", { length: 64 })
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.guildId, table.roleId] }),
    index("member_roles_guild_user_idx").on(table.guildId, table.userId),
    index("member_roles_role_id_idx").on(table.roleId),
  ]
);

// ── Permission Overwrites ──
export const permissionOverwrites = mysqlTable(
  "permission_overwrites",
  {
    channelId: varchar("channel_id", { length: 64 })
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    targetId: varchar("target_id", { length: 64 }).notNull(),
    targetType: int("target_type").notNull(),
    allow: varchar("allow", { length: 64 }).notNull().default("0"),
    deny: varchar("deny", { length: 64 }).notNull().default("0"),
  },
  (table) => [
    primaryKey({ columns: [table.channelId, table.targetId] }),
    index("permission_overwrites_target_id_idx").on(table.targetId),
  ]
);

// ── Relationships (friends, blocks) ──
export const relationships = mysqlTable(
  "relationships",
  {
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetId: varchar("target_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: int("type").notNull(),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.targetId] }),
    index("relationships_user_id_idx").on(table.userId),
    index("relationships_target_id_idx").on(table.targetId),
  ]
);

// ── DM Channels ──
export const dmChannels = mysqlTable(
  "dm_channels",
  {
    channelId: varchar("channel_id", { length: 64 })
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.channelId, table.userId] }),
    index("dm_channels_user_id_idx").on(table.userId),
  ]
);

// ── Invites ──
export const invites = mysqlTable(
  "invites",
  {
    code: varchar("code", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 64 })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    channelId: varchar("channel_id", { length: 64 })
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    inviterId: varchar("inviter_id", { length: 64 }).references(() => users.id, { onDelete: "cascade" }),
    maxUses: int("max_uses").notNull().default(0),
    uses: int("uses").notNull().default(0),
    maxAge: int("max_age").notNull().default(86400),
    temporary: boolean("temporary").notNull().default(false),
    expiresAt: datetime("expires_at", { mode: "date" }),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("invites_guild_id_idx").on(table.guildId),
    index("invites_expires_at_idx").on(table.expiresAt),
  ]
);

// ── Bans ──
export const bans = mysqlTable(
  "bans",
  {
    guildId: varchar("guild_id", { length: 64 })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason"),
    bannedBy: varchar("banned_by", { length: 64 }).references(() => users.id, { onDelete: "cascade" }),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.userId] }),
    index("bans_user_id_idx").on(table.userId),
  ]
);

// ── Message Attachments ──
export const messageAttachments = mysqlTable(
  "message_attachments",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    messageId: varchar("message_id", { length: 64 })
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    size: int("size").notNull(),
    url: text("url").notNull(),
    proxyUrl: text("proxy_url").notNull(),
    contentType: text("content_type"),
    width: int("width"),
    height: int("height"),
  },
  (table) => [index("attachments_message_id_idx").on(table.messageId)]
);

// ── Message Embeds ──
export const messageEmbeds = mysqlTable(
  "message_embeds",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    messageId: varchar("message_id", { length: 64 })
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 32 }).notNull().default("rich"),
    title: text("title"),
    description: text("description"),
    url: text("url"),
    color: int("color"),
    footer: json("footer"),
    image: json("image"),
    thumbnail: json("thumbnail"),
    author: json("author"),
    fields: json("fields"),
  },
  (table) => [index("embeds_message_id_idx").on(table.messageId)]
);

// ── Message Reactions ──
export const messageReactions = mysqlTable(
  "message_reactions",
  {
    messageId: varchar("message_id", { length: 64 })
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emojiName: varchar("emoji_name", { length: 255 }).notNull(),
    emojiId: varchar("emoji_id", { length: 64 }),
  },
  (table) => [
    primaryKey({
      columns: [table.messageId, table.userId, table.emojiName, table.emojiId],
    }),
    index("message_reactions_message_id_idx").on(table.messageId),
    index("message_reactions_user_id_idx").on(table.userId),
  ]
);

// ── Custom Emojis ──
export const emojis = mysqlTable(
  "emojis",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 64 })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    creatorId: varchar("creator_id", { length: 64 }).references(() => users.id, { onDelete: "cascade" }),
    animated: boolean("animated").notNull().default(false),
    available: boolean("available").notNull().default(true),
  },
  (table) => [
    index("emojis_guild_id_idx").on(table.guildId),
    index("emojis_creator_id_idx").on(table.creatorId),
  ]
);

// ── Webhooks ──
export const webhooks = mysqlTable(
  "webhooks",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 64 })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    channelId: varchar("channel_id", { length: 64 })
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    type: int("type").notNull().default(1),
    name: text("name"),
    avatar: text("avatar"),
    token: text("token"),
    creatorId: varchar("creator_id", { length: 64 }).references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("webhooks_channel_id_idx").on(table.channelId),
    index("webhooks_guild_id_idx").on(table.guildId),
    index("webhooks_creator_id_idx").on(table.creatorId),
  ]
);

// ── Read States ──
export const readStates = mysqlTable(
  "read_states",
  {
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channelId: varchar("channel_id", { length: 64 })
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    lastMessageId: varchar("last_message_id", { length: 64 }),
    mentionCount: int("mention_count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.channelId] }),
    index("read_states_user_id_idx").on(table.userId),
  ]
);

// ── Audit Log ──
export const auditLogEntries = mysqlTable(
  "audit_log_entries",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 64 })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 }).references(() => users.id, { onDelete: "cascade" }),
    targetId: varchar("target_id", { length: 64 }),
    actionType: int("action_type").notNull(),
    reason: text("reason"),
    changes: json("changes"),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("audit_log_guild_id_idx").on(table.guildId),
    index("audit_log_user_id_idx").on(table.userId),
    index("audit_log_guild_created_idx").on(table.guildId, table.createdAt),
  ]
);

// ── Polls ──
export const polls = mysqlTable(
  "polls",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    channelId: varchar("channel_id", { length: 64 })
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    messageId: varchar("message_id", { length: 64 })
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    allowMultiselect: boolean("allow_multiselect").notNull().default(false),
    anonymous: boolean("anonymous").notNull().default(false),
    expiresAt: datetime("expires_at", { mode: "date" }),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [index("polls_message_id_idx").on(table.messageId)]
);

export const pollOptions = mysqlTable(
  "poll_options",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    pollId: varchar("poll_id", { length: 64 })
      .notNull()
      .references(() => polls.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    position: int("position").notNull().default(0),
  },
  (table) => [index("poll_options_poll_id_idx").on(table.pollId)]
);

export const pollVotes = mysqlTable(
  "poll_votes",
  {
    pollId: varchar("poll_id", { length: 64 })
      .notNull()
      .references(() => polls.id, { onDelete: "cascade" }),
    optionId: varchar("option_id", { length: 64 })
      .notNull()
      .references(() => pollOptions.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.pollId, table.optionId, table.userId] }),
    index("poll_votes_poll_id_idx").on(table.pollId),
  ]
);

// ── Scheduled Messages ──
export const scheduledMessages = mysqlTable(
  "scheduled_messages",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    channelId: varchar("channel_id", { length: 64 })
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    authorId: varchar("author_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    scheduledFor: datetime("scheduled_for", { mode: "date" }).notNull(),
    sent: boolean("sent").notNull().default(false),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("scheduled_messages_scheduled_for_idx").on(table.scheduledFor),
    index("scheduled_messages_author_id_idx").on(table.authorId),
  ]
);

// ── Notification Log ──
export const notificationLog = mysqlTable(
  "notification_log",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 64 }).notNull(),
    sourceGuildId: varchar("source_guild_id", { length: 64 }),
    sourceChannelId: varchar("source_channel_id", { length: 64 }),
    sourceMessageId: varchar("source_message_id", { length: 64 }),
    sourceUserId: varchar("source_user_id", { length: 64 }),
    title: text("title").notNull(),
    body: text("body"),
    read: boolean("read").notNull().default(false),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("notification_log_user_id_idx").on(table.userId),
    index("notification_log_created_at_idx").on(table.createdAt),
  ]
);

// ── Server Backups ──
export const serverBackups = mysqlTable(
  "server_backups",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 64 })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    createdBy: varchar("created_by", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    data: json("data").notNull(),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [index("server_backups_guild_id_idx").on(table.guildId)]
);

// ── Ban Appeals ──
export const banAppeals = mysqlTable(
  "ban_appeals",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 64 })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    status: mysqlEnum("status", ["pending", "accepted", "rejected"])
      .notNull()
      .default("pending"),
    moderatorId: varchar("moderator_id", { length: 64 }).references(() => users.id, { onDelete: "set null" }),
    moderatorReason: text("moderator_reason"),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
    resolvedAt: datetime("resolved_at", { mode: "date" }),
  },
  (table) => [
    index("ban_appeals_guild_id_idx").on(table.guildId),
    index("ban_appeals_user_id_idx").on(table.userId),
  ]
);

// ── Thread Metadata ──
export const threadMetadata = mysqlTable("thread_metadata", {
  channelId: varchar("channel_id", { length: 64 })
    .primaryKey()
    .references(() => channels.id, { onDelete: "cascade" }),
  archived: boolean("archived").notNull().default(false),
  autoArchiveDuration: int("auto_archive_duration").notNull().default(1440),
  archiveTimestamp: datetime("archive_timestamp", { mode: "date" }),
  locked: boolean("locked").notNull().default(false),
  invitable: boolean("invitable").notNull().default(true),
});

// ── Thread Members ──
export const threadMembers = mysqlTable(
  "thread_members",
  {
    channelId: varchar("channel_id", { length: 64 })
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinTimestamp: datetime("join_timestamp", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    primaryKey({ columns: [table.channelId, table.userId] }),
    index("thread_members_user_id_idx").on(table.userId),
  ]
);

// ── Moderation Queue ──
export const moderationQueue = mysqlTable(
  "moderation_queue",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 64 })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 32 }).notNull(),
    targetId: varchar("target_id", { length: 64 }).notNull(),
    reason: text("reason").notNull(),
    reportedBy: varchar("reported_by", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: mysqlEnum("status", ["pending", "approved", "rejected", "escalated"])
      .notNull()
      .default("pending"),
    moderatorId: varchar("moderator_id", { length: 64 }).references(() => users.id, { onDelete: "set null" }),
    moderatorNote: text("moderator_note"),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
    resolvedAt: datetime("resolved_at", { mode: "date" }),
  },
  (table) => [
    index("moderation_queue_guild_id_idx").on(table.guildId),
    index("moderation_queue_status_idx").on(table.status),
  ]
);

// ── Notification Settings (per-server/channel granularity) ──
export const notificationSettings = mysqlTable(
  "notification_settings",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    guildId: varchar("guild_id", { length: 64 }).references(() => guilds.id, { onDelete: "cascade" }),
    channelId: varchar("channel_id", { length: 64 }).references(() => channels.id, { onDelete: "cascade" }),
    level: mysqlEnum("level", ["all", "mentions", "none"]).notNull().default("all"),
    suppressEveryone: boolean("suppress_everyone").notNull().default(false),
    suppressRoles: boolean("suppress_roles").notNull().default(false),
    muted: boolean("muted").notNull().default(false),
    muteUntil: datetime("mute_until", { mode: "date" }),
  },
  (table) => [
    unique("notification_settings_user_guild_channel_unique").on(table.userId, table.guildId, table.channelId),
    index("notification_settings_user_idx").on(table.userId),
    index("notification_settings_guild_idx").on(table.guildId),
  ]
);

// ── Thread Templates ──
export const threadTemplates = mysqlTable(
  "thread_templates",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    channelId: varchar("channel_id", { length: 64 })
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    guildId: varchar("guild_id", { length: 64 })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    content: text("content").notNull(),
    createdBy: varchar("created_by", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("thread_templates_channel_id_idx").on(table.channelId),
  ]
);

// ══════════════════════════════════════════════════════════════════════════════
// NEW TABLES - P0 Critical Features
// ══════════════════════════════════════════════════════════════════════════════

// ── Forum Tags ──
export const forumTags = mysqlTable(
  "forum_tags",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    channelId: varchar("channel_id", { length: 64 })
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    emojiId: varchar("emoji_id", { length: 64 }),
    emojiName: varchar("emoji_name", { length: 255 }),
    moderated: boolean("moderated").notNull().default(false),
    position: int("position").notNull().default(0),
  },
  (table) => [index("forum_tags_channel_id_idx").on(table.channelId)]
);

// ── Forum Post Tags (join table) ──
export const forumPostTags = mysqlTable(
  "forum_post_tags",
  {
    threadId: varchar("thread_id", { length: 64 })
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    tagId: varchar("tag_id", { length: 64 })
      .notNull()
      .references(() => forumTags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.tagId] }),
    index("forum_post_tags_thread_idx").on(table.threadId),
  ]
);

// ── AutoMod Config (persistent) ──
export const automodConfig = mysqlTable("automod_config", {
  guildId: varchar("guild_id", { length: 64 })
    .primaryKey()
    .references(() => guilds.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  keywordFilters: json("keyword_filters").$type<{
    enabled: boolean;
    blockedWords: string[];
    action: "delete" | "warn" | "timeout";
  }>().notNull().default({ enabled: false, blockedWords: [], action: "delete" }),
  mentionSpam: json("mention_spam").$type<{
    enabled: boolean;
    maxMentions: number;
    action: "delete" | "warn" | "timeout";
  }>().notNull().default({ enabled: false, maxMentions: 10, action: "delete" }),
  linkFilter: json("link_filter").$type<{
    enabled: boolean;
    blockAllLinks: boolean;
    whitelist: string[];
    action: "delete" | "warn" | "timeout";
  }>().notNull().default({ enabled: false, blockAllLinks: false, whitelist: [], action: "delete" }),
  antiRaid: json("anti_raid").$type<{
    enabled: boolean;
    joinRateLimit: number;
    joinRateWindow: number;
    action: "lockdown" | "kick" | "notify";
  }>().notNull().default({ enabled: false, joinRateLimit: 10, joinRateWindow: 60, action: "notify" }),
  updatedAt: datetime("updated_at", { mode: "date" }).notNull().default(sql`NOW()`),
});

// ── Passkey Credentials (WebAuthn) ──
export const passkeyCredentials = mysqlTable(
  "passkey_credentials",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: varchar("credential_id", { length: 512 }).notNull(),
    publicKey: text("public_key").notNull(),
    counter: int("counter").notNull().default(0),
    deviceType: text("device_type"),
    backedUp: boolean("backed_up").notNull().default(false),
    transports: json("transports").$type<string[]>(),
    aaguid: varchar("aaguid", { length: 64 }),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("passkey_credentials_user_idx").on(table.userId),
    uniqueIndex("passkey_credentials_cred_id_idx").on(table.credentialId),
  ]
);

// ── Verification Codes ──
export const verificationCodes = mysqlTable(
  "verification_codes",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 255 }).notNull(),
    type: mysqlEnum("type", ["email", "phone", "password_reset"]).notNull(),
    expiresAt: datetime("expires_at", { mode: "date" }).notNull(),
    used: boolean("used").notNull().default(false),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("verification_codes_user_idx").on(table.userId),
    index("verification_codes_expires_idx").on(table.expiresAt),
    uniqueIndex("verification_codes_code_idx").on(table.code),
  ]
);

// ── Guild Events ──
export const guildEvents = mysqlTable(
  "guild_events",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 64 })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    channelId: varchar("channel_id", { length: 64 }).references(() => channels.id, { onDelete: "set null" }),
    creatorId: varchar("creator_id", { length: 64 }).references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    image: text("image"),
    scheduledStartTime: datetime("scheduled_start_time", { mode: "date" }).notNull(),
    scheduledEndTime: datetime("scheduled_end_time", { mode: "date" }),
    privacyLevel: int("privacy_level").notNull().default(2),
    status: int("status").notNull().default(1),
    entityType: int("entity_type").notNull().default(1),
    entityMetadata: json("entity_metadata").$type<{ location?: string }>(),
    recurrenceRule: json("recurrence_rule").$type<{
      frequency: "daily" | "weekly" | "monthly";
      interval?: number;
      byWeekday?: number[];
      count?: number;
      endDate?: string;
    }>(),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("guild_events_guild_idx").on(table.guildId),
    index("guild_events_start_idx").on(table.scheduledStartTime),
  ]
);

// ── Guild Event Users (RSVP) ──
export const guildEventUsers = mysqlTable(
  "guild_event_users",
  {
    eventId: varchar("event_id", { length: 64 })
      .notNull()
      .references(() => guildEvents.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: mysqlEnum("status", ["interested", "going", "not_going"]).notNull().default("interested"),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.userId] }),
    index("guild_event_users_event_idx").on(table.eventId),
    index("guild_event_users_user_idx").on(table.userId),
  ]
);

// ══════════════════════════════════════════════════════════════════════════════
// NEW TABLES - P1 High Priority Features
// ══════════════════════════════════════════════════════════════════════════════

// ── Applications (Bots) ──
export const applications = mysqlTable(
  "applications",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    icon: text("icon"),
    description: text("description").notNull().default(""),
    botPublic: boolean("bot_public").notNull().default(true),
    botRequireCodeGrant: boolean("bot_require_code_grant").notNull().default(false),
    ownerId: varchar("owner_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    botUserId: varchar("bot_user_id", { length: 64 }).references(() => users.id, { onDelete: "cascade" }),
    verifyKey: text("verify_key").notNull(),
    flags: int("flags").notNull().default(0),
    interactionsEndpointUrl: text("interactions_endpoint_url"),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [index("applications_owner_idx").on(table.ownerId)]
);

// ── Application Commands (Slash Commands) ──
export const applicationCommands = mysqlTable(
  "application_commands",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    applicationId: varchar("application_id", { length: 64 })
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    guildId: varchar("guild_id", { length: 64 }).references(() => guilds.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description").notNull(),
    type: int("type").notNull().default(1),
    options: json("options").$type<ApplicationCommandOption[]>(),
    defaultMemberPermissions: varchar("default_member_permissions", { length: 64 }),
    dmPermission: boolean("dm_permission").notNull().default(true),
    nsfw: boolean("nsfw").notNull().default(false),
    version: varchar("version", { length: 64 }).notNull(),
  },
  (table) => [
    index("app_commands_app_idx").on(table.applicationId),
    index("app_commands_guild_idx").on(table.guildId),
  ]
);

// ── Message Components ──
export const messageComponents = mysqlTable(
  "message_components",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    messageId: varchar("message_id", { length: 64 })
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    type: int("type").notNull(),
    customId: varchar("custom_id", { length: 255 }),
    label: text("label"),
    style: int("style"),
    url: text("url"),
    disabled: boolean("disabled").notNull().default(false),
    emoji: json("emoji").$type<{ id?: string; name?: string; animated?: boolean }>(),
    options: json("options").$type<SelectMenuOption[]>(),
    placeholder: text("placeholder"),
    minValues: int("min_values"),
    maxValues: int("max_values"),
    minLength: int("min_length"),
    maxLength: int("max_length"),
    required: boolean("required"),
    parentId: varchar("parent_id", { length: 64 }),
    position: int("position").notNull().default(0),
  },
  (table) => [index("message_components_message_idx").on(table.messageId)]
);

// ── Interactions ──
export const interactions = mysqlTable(
  "interactions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    applicationId: varchar("application_id", { length: 64 })
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    type: int("type").notNull(),
    guildId: varchar("guild_id", { length: 64 }).references(() => guilds.id, { onDelete: "cascade" }),
    channelId: varchar("channel_id", { length: 64 }).references(() => channels.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    data: json("data"),
    version: int("version").notNull().default(1),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
    respondedAt: datetime("responded_at", { mode: "date" }),
  },
  (table) => [
    index("interactions_app_idx").on(table.applicationId),
    index("interactions_guild_id_idx").on(table.guildId),
    index("interactions_channel_id_idx").on(table.channelId),
    index("interactions_user_id_idx").on(table.userId),
  ]
);

// ══════════════════════════════════════════════════════════════════════════════
// NEW TABLES - P2 Medium Priority Features
// ══════════════════════════════════════════════════════════════════════════════

// ── Stickers ──
export const stickers = mysqlTable(
  "stickers",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 64 }).references(() => guilds.id, { onDelete: "cascade" }),
    packId: varchar("pack_id", { length: 64 }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    tags: varchar("tags", { length: 255 }).notNull(),
    type: int("type").notNull(),
    formatType: int("format_type").notNull(),
    available: boolean("available").notNull().default(true),
    userId: varchar("user_id", { length: 64 }).references(() => users.id, { onDelete: "cascade" }),
    sortValue: int("sort_value"),
  },
  (table) => [index("stickers_guild_idx").on(table.guildId)]
);

// ── Message Stickers (join table) ──
export const messageStickers = mysqlTable(
  "message_stickers",
  {
    messageId: varchar("message_id", { length: 64 })
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    stickerId: varchar("sticker_id", { length: 64 })
      .notNull()
      .references(() => stickers.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.stickerId] }),
    index("message_stickers_message_id_idx").on(table.messageId),
    index("message_stickers_sticker_id_idx").on(table.stickerId),
  ]
);

// ── User Activities (Rich Presence) ──
export const userActivities = mysqlTable(
  "user_activities",
  {
    userId: varchar("user_id", { length: 64 })
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    activities: json("activities").$type<UserActivity[]>().notNull().default([]),
    updatedAt: datetime("updated_at", { mode: "date" }).notNull().default(sql`NOW()`),
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// NEW TABLES - User Sessions & Recovery
// ══════════════════════════════════════════════════════════════════════════════

// ── User Sessions ──
export const userSessions = mysqlTable(
  "user_sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 255 }).notNull(),
    deviceInfo: json("device_info").$type<{ os?: string; browser?: string; device?: string }>(),
    ipAddress: varchar("ip_address", { length: 45 }),
    lastActiveAt: datetime("last_active_at", { mode: "date" }).notNull().default(sql`NOW()`),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
    expiresAt: datetime("expires_at", { mode: "date" }).notNull(),
  },
  (table) => [
    index("user_sessions_user_idx").on(table.userId),
    index("user_sessions_token_idx").on(table.tokenHash),
  ]
);

// ── Recovery Keys ──
export const recoveryKeys = mysqlTable(
  "recovery_keys",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull(),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
    usedAt: datetime("used_at", { mode: "date" }),
  },
  (table) => [uniqueIndex("recovery_keys_user_idx").on(table.userId)]
);

// ══════════════════════════════════════════════════════════════════════════════
// NEW TABLES - User Notes & Guild Features
// ══════════════════════════════════════════════════════════════════════════════

// ── User Notes (private notes about other users) ──
export const userNotes = mysqlTable(
  "user_notes",
  {
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetUserId: varchar("target_user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    note: text("note").notNull(),
    updatedAt: datetime("updated_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.targetUserId] }),
    index("user_notes_user_idx").on(table.userId),
    index("user_notes_target_user_idx").on(table.targetUserId),
  ]
);

// ── Guild Templates (server templates) ──
export const guildTemplates = mysqlTable(
  "guild_templates",
  {
    code: varchar("code", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 64 })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    usageCount: int("usage_count").notNull().default(0),
    creatorId: varchar("creator_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    serializedGuild: json("serialized_guild").$type<SerializedGuild>().notNull(),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
    updatedAt: datetime("updated_at", { mode: "date" }).notNull().default(sql`NOW()`),
    isDirty: boolean("is_dirty").notNull().default(false),
  },
  (table) => [
    index("guild_templates_guild_idx").on(table.guildId),
  ]
);

// ── Guild Welcome Screens ──
export const guildWelcomeScreens = mysqlTable("guild_welcome_screens", {
  guildId: varchar("guild_id", { length: 64 })
    .primaryKey()
    .references(() => guilds.id, { onDelete: "cascade" }),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(false),
  welcomeChannels: json("welcome_channels").$type<WelcomeChannel[]>().notNull().default([]),
  updatedAt: datetime("updated_at", { mode: "date" }).notNull().default(sql`NOW()`),
});

// ── Guild Onboarding ──
export const guildOnboarding = mysqlTable("guild_onboarding", {
  guildId: varchar("guild_id", { length: 64 })
    .primaryKey()
    .references(() => guilds.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  defaultChannelIds: json("default_channel_ids").$type<string[]>().notNull().default([]),
  mode: int("mode").notNull().default(0),
  prompts: json("prompts").$type<OnboardingPrompt[]>().notNull().default([]),
  updatedAt: datetime("updated_at", { mode: "date" }).notNull().default(sql`NOW()`),
});

// ── Guild Widgets ──
export const guildWidgets = mysqlTable("guild_widgets", {
  guildId: varchar("guild_id", { length: 64 })
    .primaryKey()
    .references(() => guilds.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  channelId: varchar("channel_id", { length: 64 }).references(() => channels.id, { onDelete: "set null" }),
});

// ── Channel Following (announcements) ──
export const channelFollowers = mysqlTable(
  "channel_followers",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    channelId: varchar("channel_id", { length: 64 })
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    webhookId: varchar("webhook_id", { length: 64 })
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    guildId: varchar("guild_id", { length: 64 })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("channel_followers_channel_idx").on(table.channelId),
    index("channel_followers_webhook_idx").on(table.webhookId),
  ]
);

// ── Guild Previews (for discovery) ──
export const guildPreviews = mysqlTable("guild_previews", {
  guildId: varchar("guild_id", { length: 64 })
    .primaryKey()
    .references(() => guilds.id, { onDelete: "cascade" }),
  approximateMemberCount: int("approximate_member_count").notNull().default(0),
  approximatePresenceCount: int("approximate_presence_count").notNull().default(0),
  discoverable: boolean("discoverable").notNull().default(false),
  featuredAt: datetime("featured_at", { mode: "date" }),
  updatedAt: datetime("updated_at", { mode: "date" }).notNull().default(sql`NOW()`),
});

// ══════════════════════════════════════════════════════════════════════════════
// Type Definitions for JSON fields
// ══════════════════════════════════════════════════════════════════════════════

export interface ApplicationCommandOption {
  type: number;
  name: string;
  description: string;
  required?: boolean;
  choices?: Array<{ name: string; value: string | number }>;
  options?: ApplicationCommandOption[];
  channelTypes?: number[];
  minValue?: number;
  maxValue?: number;
  minLength?: number;
  maxLength?: number;
  autocomplete?: boolean;
}

export interface SelectMenuOption {
  label: string;
  value: string;
  description?: string;
  emoji?: { id?: string; name?: string; animated?: boolean };
  default?: boolean;
}

export interface UserActivity {
  name: string;
  type: number;
  url?: string;
  createdAt?: number;
  timestamps?: { start?: number; end?: number };
  applicationId?: string;
  details?: string;
  state?: string;
  emoji?: { name: string; id?: string; animated?: boolean };
  party?: { id?: string; size?: [number, number] };
  assets?: {
    largeImage?: string;
    largeText?: string;
    smallImage?: string;
    smallText?: string;
  };
  secrets?: { join?: string; spectate?: string; match?: string };
  instance?: boolean;
  flags?: number;
  buttons?: Array<{ label: string; url: string }>;
}

export interface SerializedGuild {
  name: string;
  icon?: string;
  description?: string;
  verificationLevel: number;
  defaultMessageNotifications: number;
  explicitContentFilter: number;
  preferredLocale: string;
  afkTimeout?: number;
  roles: Array<{
    id: string;
    name: string;
    color: number;
    hoist: boolean;
    position: number;
    permissions: string;
    mentionable: boolean;
  }>;
  channels: Array<{
    id: string;
    name: string;
    type: number;
    topic?: string;
    position: number;
    parentId?: string;
    nsfw: boolean;
    rateLimitPerUser: number;
    bitrate?: number;
    userLimit?: number;
    permissionOverwrites?: Array<{
      id: string;
      type: number;
      allow: string;
      deny: string;
    }>;
  }>;
  systemChannelId?: string;
}

export interface WelcomeChannel {
  channelId: string;
  description: string;
  emojiId?: string;
  emojiName?: string;
}

export interface OnboardingPrompt {
  id: string;
  type: number;
  title: string;
  singleSelect: boolean;
  required: boolean;
  inOnboarding: boolean;
  options: Array<{
    id: string;
    channelIds: string[];
    roleIds: string[];
    title: string;
    description?: string;
    emojiId?: string;
    emojiName?: string;
    emojiAnimated?: boolean;
  }>;
}
