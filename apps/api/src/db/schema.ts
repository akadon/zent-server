import {
  pgTable,
  pgEnum,
  varchar,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
  serial,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── Enum Types ──
export const userStatusEnum = pgEnum("user_status", ["online", "idle", "dnd", "offline"]);
export const banAppealStatusEnum = pgEnum("ban_appeal_status", ["pending", "accepted", "rejected"]);
export const moderationQueueStatusEnum = pgEnum("moderation_queue_status", ["pending", "approved", "rejected", "escalated"]);
export const notificationLevelEnum = pgEnum("notification_level", ["all", "mentions", "none"]);
export const verificationCodeTypeEnum = pgEnum("verification_code_type", ["email", "phone", "password_reset"]);
export const guildEventUserStatusEnum = pgEnum("guild_event_user_status", ["interested", "going", "not_going"]);

// ── Users ──
export const users = pgTable(
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
    status: userStatusEnum("status").notNull().default("offline"),
    customStatus: jsonb("custom_status").$type<{ text?: string; emoji?: string } | null>(),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    mfaSecret: text("mfa_secret"),
    mfaBackupCodes: jsonb("mfa_backup_codes").$type<string[]>(),
    verified: boolean("verified").notNull().default(false),
    flags: integer("flags").notNull().default(0),
    premiumType: integer("premium_type").notNull().default(0),
    locale: varchar("locale", { length: 10 }).notNull().default("en-US"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    uniqueIndex("users_username_idx").on(table.username),
  ]
);

// ── Guilds ──
export const guilds = pgTable(
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
    verificationLevel: integer("verification_level").notNull().default(0),
    defaultMessageNotifications: integer("default_message_notifications").notNull().default(0),
    explicitContentFilter: integer("explicit_content_filter").notNull().default(0),
    features: jsonb("features").$type<string[]>().notNull().default([]),
    systemChannelId: varchar("system_channel_id", { length: 64 }),
    rulesChannelId: varchar("rules_channel_id", { length: 64 }),
    vanityUrlCode: text("vanity_url_code"),
    premiumTier: integer("premium_tier").notNull().default(0),
    premiumSubscriptionCount: integer("premium_subscription_count").notNull().default(0),
    preferredLocale: varchar("preferred_locale", { length: 10 }).notNull().default("en-US"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("guilds_owner_id_idx").on(table.ownerId),
  ]
);

// ── Channels ──
export const channels = pgTable(
  "channels",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 64 }).references(() => guilds.id, { onDelete: "cascade" }),
    type: integer("type").notNull().default(0),
    name: text("name"),
    topic: text("topic"),
    position: integer("position").notNull().default(0),
    parentId: varchar("parent_id", { length: 64 }),
    nsfw: boolean("nsfw").notNull().default(false),
    rateLimitPerUser: integer("rate_limit_per_user").notNull().default(0),
    bitrate: integer("bitrate"),
    userLimit: integer("user_limit"),
    lastMessageId: varchar("last_message_id", { length: 64 }),
    ownerId: varchar("owner_id", { length: 64 }),
    flags: integer("flags").notNull().default(0),
    messageRetentionSeconds: integer("message_retention_seconds"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("channels_guild_id_idx").on(table.guildId),
    index("channels_parent_id_idx").on(table.parentId),
  ]
);

// ── Messages ──
export const messages = pgTable(
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
    type: integer("type").notNull().default(0),
    flags: integer("flags").notNull().default(0),
    tts: boolean("tts").notNull().default(false),
    mentionEveryone: boolean("mention_everyone").notNull().default(false),
    pinned: boolean("pinned").notNull().default(false),
    editedTimestamp: timestamp("edited_timestamp", { mode: "date" }),
    referencedMessageId: varchar("referenced_message_id", { length: 64 }),
    webhookId: varchar("webhook_id", { length: 64 }),
    nonce: text("nonce"),
    expiresAt: timestamp("expires_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("messages_channel_id_idx").on(table.channelId),
    index("messages_channel_created_idx").on(table.channelId, table.id),
    index("messages_author_id_idx").on(table.authorId),
    index("messages_expires_at_idx").on(table.expiresAt),
    index("messages_pinned_idx").on(table.channelId, table.pinned),
    index("messages_webhook_id_idx").on(table.webhookId),
    index("messages_reference_idx").on(table.referencedMessageId),
  ]
);

// ── Roles ──
export const roles = pgTable(
  "roles",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 64 })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    color: integer("color").notNull().default(0),
    hoist: boolean("hoist").notNull().default(false),
    icon: text("icon"),
    position: integer("position").notNull().default(0),
    permissions: varchar("permissions", { length: 64 }).notNull().default("0"),
    managed: boolean("managed").notNull().default(false),
    mentionable: boolean("mentionable").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [index("roles_guild_id_idx").on(table.guildId)]
);

// ── Members ──
export const members = pgTable(
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
    joinedAt: timestamp("joined_at", { mode: "date" }).notNull().default(sql`NOW()`),
    premiumSince: timestamp("premium_since", { mode: "date" }),
    deaf: boolean("deaf").notNull().default(false),
    mute: boolean("mute").notNull().default(false),
    pending: boolean("pending").notNull().default(false),
    communicationDisabledUntil: timestamp("communication_disabled_until", { mode: "date" }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.guildId] }),
    index("members_guild_id_idx").on(table.guildId),
    index("members_user_id_idx").on(table.userId),
  ]
);

// ── Member Roles ──
export const memberRoles = pgTable(
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
export const permissionOverwrites = pgTable(
  "permission_overwrites",
  {
    channelId: varchar("channel_id", { length: 64 })
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    targetId: varchar("target_id", { length: 64 }).notNull(),
    targetType: integer("target_type").notNull(),
    allow: varchar("allow", { length: 64 }).notNull().default("0"),
    deny: varchar("deny", { length: 64 }).notNull().default("0"),
  },
  (table) => [
    primaryKey({ columns: [table.channelId, table.targetId] }),
    index("permission_overwrites_target_id_idx").on(table.targetId),
  ]
);

// ── Relationships (friends, blocks) ──
export const relationships = pgTable(
  "relationships",
  {
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetId: varchar("target_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: integer("type").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.targetId] }),
    index("relationships_user_id_idx").on(table.userId),
    index("relationships_target_id_idx").on(table.targetId),
  ]
);

// ── DM Channels ──
export const dmChannels = pgTable(
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
export const invites = pgTable(
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
    maxUses: integer("max_uses").notNull().default(0),
    uses: integer("uses").notNull().default(0),
    maxAge: integer("max_age").notNull().default(86400),
    temporary: boolean("temporary").notNull().default(false),
    expiresAt: timestamp("expires_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("invites_guild_id_idx").on(table.guildId),
    index("invites_expires_at_idx").on(table.expiresAt),
  ]
);

// ── Bans ──
export const bans = pgTable(
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
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.userId] }),
    index("bans_user_id_idx").on(table.userId),
  ]
);

// ── Message Attachments ──
export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    messageId: varchar("message_id", { length: 64 })
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    size: integer("size").notNull(),
    url: text("url").notNull(),
    proxyUrl: text("proxy_url").notNull(),
    contentType: text("content_type"),
    width: integer("width"),
    height: integer("height"),
  },
  (table) => [index("attachments_message_id_idx").on(table.messageId)]
);

// ── Message Embeds ──
export const messageEmbeds = pgTable(
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
    color: integer("color"),
    footer: jsonb("footer"),
    image: jsonb("image"),
    thumbnail: jsonb("thumbnail"),
    author: jsonb("author"),
    fields: jsonb("fields"),
  },
  (table) => [index("embeds_message_id_idx").on(table.messageId)]
);

// ── Message Reactions ──
// emojiId uses "" for unicode emoji (no custom ID) so the composite PK works in PostgreSQL
export const messageReactions = pgTable(
  "message_reactions",
  {
    messageId: varchar("message_id", { length: 64 })
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emojiName: varchar("emoji_name", { length: 255 }).notNull(),
    emojiId: varchar("emoji_id", { length: 64 }).notNull().default(""),
  },
  (table) => [
    primaryKey({
      columns: [table.messageId, table.userId, table.emojiName, table.emojiId],
    }),
    index("message_reactions_message_id_idx").on(table.messageId),
    index("message_reactions_user_id_idx").on(table.userId),
    index("reactions_message_user_idx").on(table.messageId, table.userId),
  ]
);

// ── Custom Emojis ──
export const emojis = pgTable(
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
export const webhooks = pgTable(
  "webhooks",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 64 })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    channelId: varchar("channel_id", { length: 64 })
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    type: integer("type").notNull().default(1),
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
export const readStates = pgTable(
  "read_states",
  {
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channelId: varchar("channel_id", { length: 64 })
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    lastMessageId: varchar("last_message_id", { length: 64 }),
    mentionCount: integer("mention_count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.channelId] }),
    index("read_states_user_id_idx").on(table.userId),
  ]
);

// ── Audit Log ──
export const auditLogEntries = pgTable(
  "audit_log_entries",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 64 })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 }).references(() => users.id, { onDelete: "cascade" }),
    targetId: varchar("target_id", { length: 64 }),
    actionType: integer("action_type").notNull(),
    reason: text("reason"),
    changes: jsonb("changes"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("audit_log_guild_id_idx").on(table.guildId),
    index("audit_log_user_id_idx").on(table.userId),
    index("audit_log_guild_created_idx").on(table.guildId, table.createdAt),
  ]
);

// ── Polls ──
export const polls = pgTable(
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
    expiresAt: timestamp("expires_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [index("polls_message_id_idx").on(table.messageId)]
);

export const pollOptions = pgTable(
  "poll_options",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    pollId: varchar("poll_id", { length: 64 })
      .notNull()
      .references(() => polls.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    position: integer("position").notNull().default(0),
  },
  (table) => [index("poll_options_poll_id_idx").on(table.pollId)]
);

export const pollVotes = pgTable(
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
export const scheduledMessages = pgTable(
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
    scheduledFor: timestamp("scheduled_for", { mode: "date" }).notNull(),
    sent: boolean("sent").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("scheduled_messages_scheduled_for_idx").on(table.scheduledFor),
    index("scheduled_messages_author_id_idx").on(table.authorId),
    index("scheduled_messages_pending_idx").on(table.sent, table.scheduledFor),
  ]
);

// ── Notification Log ──
export const notificationLog = pgTable(
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
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("notification_log_user_id_idx").on(table.userId),
    index("notification_log_created_at_idx").on(table.createdAt),
    index("notification_log_user_read_idx").on(table.userId, table.read),
  ]
);

// ── Server Backups ──
export const serverBackups = pgTable(
  "server_backups",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 64 })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    createdBy: varchar("created_by", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [index("server_backups_guild_id_idx").on(table.guildId)]
);

// ── Ban Appeals ──
export const banAppeals = pgTable(
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
    status: banAppealStatusEnum("status").notNull().default("pending"),
    moderatorId: varchar("moderator_id", { length: 64 }).references(() => users.id, { onDelete: "set null" }),
    moderatorReason: text("moderator_reason"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
    resolvedAt: timestamp("resolved_at", { mode: "date" }),
  },
  (table) => [
    index("ban_appeals_guild_id_idx").on(table.guildId),
    index("ban_appeals_user_id_idx").on(table.userId),
  ]
);

// ── Thread Metadata ──
export const threadMetadata = pgTable("thread_metadata", {
  channelId: varchar("channel_id", { length: 64 })
    .primaryKey()
    .references(() => channels.id, { onDelete: "cascade" }),
  archived: boolean("archived").notNull().default(false),
  autoArchiveDuration: integer("auto_archive_duration").notNull().default(1440),
  archiveTimestamp: timestamp("archive_timestamp", { mode: "date" }),
  locked: boolean("locked").notNull().default(false),
  invitable: boolean("invitable").notNull().default(true),
});

// ── Thread Members ──
export const threadMembers = pgTable(
  "thread_members",
  {
    channelId: varchar("channel_id", { length: 64 })
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinTimestamp: timestamp("join_timestamp", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    primaryKey({ columns: [table.channelId, table.userId] }),
    index("thread_members_user_id_idx").on(table.userId),
  ]
);

// ── Moderation Queue ──
export const moderationQueue = pgTable(
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
    status: moderationQueueStatusEnum("status").notNull().default("pending"),
    moderatorId: varchar("moderator_id", { length: 64 }).references(() => users.id, { onDelete: "set null" }),
    moderatorNote: text("moderator_note"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
    resolvedAt: timestamp("resolved_at", { mode: "date" }),
  },
  (table) => [
    index("moderation_queue_guild_id_idx").on(table.guildId),
    index("moderation_queue_status_idx").on(table.status),
  ]
);

// ── Notification Settings (per-server/channel granularity) ──
export const notificationSettings = pgTable(
  "notification_settings",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    guildId: varchar("guild_id", { length: 64 }).references(() => guilds.id, { onDelete: "cascade" }),
    channelId: varchar("channel_id", { length: 64 }).references(() => channels.id, { onDelete: "cascade" }),
    level: notificationLevelEnum("level").notNull().default("all"),
    suppressEveryone: boolean("suppress_everyone").notNull().default(false),
    suppressRoles: boolean("suppress_roles").notNull().default(false),
    muted: boolean("muted").notNull().default(false),
    muteUntil: timestamp("mute_until", { mode: "date" }),
  },
  (table) => [
    unique("notification_settings_user_guild_channel_unique").on(table.userId, table.guildId, table.channelId),
    index("notification_settings_user_idx").on(table.userId),
    index("notification_settings_guild_idx").on(table.guildId),
  ]
);

// ── Thread Templates ──
export const threadTemplates = pgTable(
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
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("thread_templates_channel_id_idx").on(table.channelId),
  ]
);

// ══════════════════════════════════════════════════════════════════════════════
// P0 Critical Features
// ══════════════════════════════════════════════════════════════════════════════

// ── Forum Tags ──
export const forumTags = pgTable(
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
    position: integer("position").notNull().default(0),
  },
  (table) => [index("forum_tags_channel_id_idx").on(table.channelId)]
);

// ── Forum Post Tags (join table) ──
export const forumPostTags = pgTable(
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
export const automodConfig = pgTable("automod_config", {
  guildId: varchar("guild_id", { length: 64 })
    .primaryKey()
    .references(() => guilds.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  keywordFilters: jsonb("keyword_filters").$type<{
    enabled: boolean;
    blockedWords: string[];
    action: "delete" | "warn" | "timeout";
  }>().notNull().default({ enabled: false, blockedWords: [], action: "delete" }),
  mentionSpam: jsonb("mention_spam").$type<{
    enabled: boolean;
    maxMentions: number;
    action: "delete" | "warn" | "timeout";
  }>().notNull().default({ enabled: false, maxMentions: 10, action: "delete" }),
  linkFilter: jsonb("link_filter").$type<{
    enabled: boolean;
    blockAllLinks: boolean;
    whitelist: string[];
    action: "delete" | "warn" | "timeout";
  }>().notNull().default({ enabled: false, blockAllLinks: false, whitelist: [], action: "delete" }),
  antiRaid: jsonb("anti_raid").$type<{
    enabled: boolean;
    joinRateLimit: number;
    joinRateWindow: number;
    action: "lockdown" | "kick" | "notify";
  }>().notNull().default({ enabled: false, joinRateLimit: 10, joinRateWindow: 60, action: "notify" }),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().default(sql`NOW()`),
});

// ── Passkey Credentials (WebAuthn) ──
export const passkeyCredentials = pgTable(
  "passkey_credentials",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: varchar("credential_id", { length: 512 }).notNull(),
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    deviceType: text("device_type"),
    backedUp: boolean("backed_up").notNull().default(false),
    transports: jsonb("transports").$type<string[]>(),
    aaguid: varchar("aaguid", { length: 64 }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("passkey_credentials_user_idx").on(table.userId),
    uniqueIndex("passkey_credentials_cred_id_idx").on(table.credentialId),
  ]
);

// ── Verification Codes ──
export const verificationCodes = pgTable(
  "verification_codes",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 255 }).notNull(),
    type: verificationCodeTypeEnum("type").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    used: boolean("used").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("verification_codes_user_idx").on(table.userId),
    index("verification_codes_expires_idx").on(table.expiresAt),
    uniqueIndex("verification_codes_code_idx").on(table.code),
  ]
);

// ── Guild Events ──
export const guildEvents = pgTable(
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
    scheduledStartTime: timestamp("scheduled_start_time", { mode: "date" }).notNull(),
    scheduledEndTime: timestamp("scheduled_end_time", { mode: "date" }),
    privacyLevel: integer("privacy_level").notNull().default(2),
    status: integer("status").notNull().default(1),
    entityType: integer("entity_type").notNull().default(1),
    entityMetadata: jsonb("entity_metadata").$type<{ location?: string }>(),
    recurrenceRule: jsonb("recurrence_rule").$type<{
      frequency: "daily" | "weekly" | "monthly";
      interval?: number;
      byWeekday?: number[];
      count?: number;
      endDate?: string;
    }>(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("guild_events_guild_idx").on(table.guildId),
    index("guild_events_start_idx").on(table.scheduledStartTime),
  ]
);

// ── Guild Event Users (RSVP) ──
export const guildEventUsers = pgTable(
  "guild_event_users",
  {
    eventId: varchar("event_id", { length: 64 })
      .notNull()
      .references(() => guildEvents.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: guildEventUserStatusEnum("status").notNull().default("interested"),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.userId] }),
    index("guild_event_users_event_idx").on(table.eventId),
    index("guild_event_users_user_idx").on(table.userId),
  ]
);

// ══════════════════════════════════════════════════════════════════════════════
// P1 High Priority Features
// ══════════════════════════════════════════════════════════════════════════════

// ── Applications (Bots) ──
export const applications = pgTable(
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
    flags: integer("flags").notNull().default(0),
    interactionsEndpointUrl: text("interactions_endpoint_url"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [index("applications_owner_idx").on(table.ownerId)]
);

// ── Application Commands (Slash Commands) ──
export const applicationCommands = pgTable(
  "application_commands",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    applicationId: varchar("application_id", { length: 64 })
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    guildId: varchar("guild_id", { length: 64 }).references(() => guilds.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description").notNull(),
    type: integer("type").notNull().default(1),
    options: jsonb("options").$type<ApplicationCommandOption[]>(),
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
export const messageComponents = pgTable(
  "message_components",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    messageId: varchar("message_id", { length: 64 })
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    type: integer("type").notNull(),
    customId: varchar("custom_id", { length: 255 }),
    label: text("label"),
    style: integer("style"),
    url: text("url"),
    disabled: boolean("disabled").notNull().default(false),
    emoji: jsonb("emoji").$type<{ id?: string; name?: string; animated?: boolean }>(),
    options: jsonb("options").$type<SelectMenuOption[]>(),
    placeholder: text("placeholder"),
    minValues: integer("min_values"),
    maxValues: integer("max_values"),
    minLength: integer("min_length"),
    maxLength: integer("max_length"),
    required: boolean("required"),
    parentId: varchar("parent_id", { length: 64 }),
    position: integer("position").notNull().default(0),
  },
  (table) => [index("message_components_message_idx").on(table.messageId)]
);

// ── Interactions ──
export const interactions = pgTable(
  "interactions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    applicationId: varchar("application_id", { length: 64 })
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    type: integer("type").notNull(),
    guildId: varchar("guild_id", { length: 64 }).references(() => guilds.id, { onDelete: "cascade" }),
    channelId: varchar("channel_id", { length: 64 }).references(() => channels.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    data: jsonb("data"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
    respondedAt: timestamp("responded_at", { mode: "date" }),
  },
  (table) => [
    index("interactions_app_idx").on(table.applicationId),
    index("interactions_guild_id_idx").on(table.guildId),
    index("interactions_channel_id_idx").on(table.channelId),
    index("interactions_user_id_idx").on(table.userId),
  ]
);

// ══════════════════════════════════════════════════════════════════════════════
// P2 Medium Priority Features
// ══════════════════════════════════════════════════════════════════════════════

// ── Stickers ──
export const stickers = pgTable(
  "stickers",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 64 }).references(() => guilds.id, { onDelete: "cascade" }),
    packId: varchar("pack_id", { length: 64 }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    tags: varchar("tags", { length: 255 }).notNull(),
    type: integer("type").notNull(),
    formatType: integer("format_type").notNull(),
    available: boolean("available").notNull().default(true),
    userId: varchar("user_id", { length: 64 }).references(() => users.id, { onDelete: "cascade" }),
    sortValue: integer("sort_value"),
  },
  (table) => [index("stickers_guild_idx").on(table.guildId)]
);

// ── Message Stickers (join table) ──
export const messageStickers = pgTable(
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
export const userActivities = pgTable(
  "user_activities",
  {
    userId: varchar("user_id", { length: 64 })
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    activities: jsonb("activities").$type<UserActivity[]>().notNull().default([]),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().default(sql`NOW()`),
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// User Sessions & Recovery
// ══════════════════════════════════════════════════════════════════════════════

// ── User Sessions ──
export const userSessions = pgTable(
  "user_sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 255 }).notNull(),
    deviceInfo: jsonb("device_info").$type<{ os?: string; browser?: string; device?: string }>(),
    ipAddress: varchar("ip_address", { length: 45 }),
    lastActiveAt: timestamp("last_active_at", { mode: "date" }).notNull().default(sql`NOW()`),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  },
  (table) => [
    index("user_sessions_user_idx").on(table.userId),
    index("user_sessions_token_idx").on(table.tokenHash),
  ]
);

// ── Recovery Keys ──
export const recoveryKeys = pgTable(
  "recovery_keys",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
    usedAt: timestamp("used_at", { mode: "date" }),
  },
  (table) => [uniqueIndex("recovery_keys_user_idx").on(table.userId)]
);

// ══════════════════════════════════════════════════════════════════════════════
// User Notes & Guild Features
// ══════════════════════════════════════════════════════════════════════════════

// ── User Notes (private notes about other users) ──
export const userNotes = pgTable(
  "user_notes",
  {
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetUserId: varchar("target_user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    note: text("note").notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.targetUserId] }),
    index("user_notes_user_idx").on(table.userId),
    index("user_notes_target_user_idx").on(table.targetUserId),
  ]
);

// ── Guild Templates (server templates) ──
export const guildTemplates = pgTable(
  "guild_templates",
  {
    code: varchar("code", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 64 })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    usageCount: integer("usage_count").notNull().default(0),
    creatorId: varchar("creator_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    serializedGuild: jsonb("serialized_guild").$type<SerializedGuild>().notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().default(sql`NOW()`),
    isDirty: boolean("is_dirty").notNull().default(false),
  },
  (table) => [
    index("guild_templates_guild_idx").on(table.guildId),
  ]
);

// ── Guild Welcome Screens ──
export const guildWelcomeScreens = pgTable("guild_welcome_screens", {
  guildId: varchar("guild_id", { length: 64 })
    .primaryKey()
    .references(() => guilds.id, { onDelete: "cascade" }),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(false),
  welcomeChannels: jsonb("welcome_channels").$type<WelcomeChannel[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().default(sql`NOW()`),
});

// ── Guild Onboarding ──
export const guildOnboarding = pgTable("guild_onboarding", {
  guildId: varchar("guild_id", { length: 64 })
    .primaryKey()
    .references(() => guilds.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  defaultChannelIds: jsonb("default_channel_ids").$type<string[]>().notNull().default([]),
  mode: integer("mode").notNull().default(0),
  prompts: jsonb("prompts").$type<OnboardingPrompt[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().default(sql`NOW()`),
});

// ── Guild Widgets ──
export const guildWidgets = pgTable("guild_widgets", {
  guildId: varchar("guild_id", { length: 64 })
    .primaryKey()
    .references(() => guilds.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  channelId: varchar("channel_id", { length: 64 }).references(() => channels.id, { onDelete: "set null" }),
});

// ── Channel Following (announcements) ──
export const channelFollowers = pgTable(
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
    createdAt: timestamp("created_at", { mode: "date" }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index("channel_followers_channel_idx").on(table.channelId),
    index("channel_followers_webhook_idx").on(table.webhookId),
  ]
);

// ── Guild Previews (for discovery) ──
export const guildPreviews = pgTable("guild_previews", {
  guildId: varchar("guild_id", { length: 64 })
    .primaryKey()
    .references(() => guilds.id, { onDelete: "cascade" }),
  approximateMemberCount: integer("approximate_member_count").notNull().default(0),
  approximatePresenceCount: integer("approximate_presence_count").notNull().default(0),
  discoverable: boolean("discoverable").notNull().default(false),
  featuredAt: timestamp("featured_at", { mode: "date" }),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().default(sql`NOW()`),
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
