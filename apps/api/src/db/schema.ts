import {
  pgTable,
  text,
  bigint,
  integer,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
  serial,
  unique,
} from "drizzle-orm/pg-core";

// ── Users ──
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    displayName: text("display_name"),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    avatar: text("avatar"),
    banner: text("banner"),
    bio: text("bio"),
    status: text("status", { enum: ["online", "idle", "dnd", "offline"] })
      .notNull()
      .default("offline"),
    customStatus: jsonb("custom_status").$type<{ text?: string; emoji?: string } | null>(),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    mfaSecret: text("mfa_secret"),
    mfaBackupCodes: jsonb("mfa_backup_codes").$type<string[]>(),
    verified: boolean("verified").notNull().default(false),
    flags: integer("flags").notNull().default(0),
    premiumType: integer("premium_type").notNull().default(0),
    locale: text("locale").notNull().default("en-US"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    uniqueIndex("users_username_idx").on(table.username),
  ]
);

// ── Guilds ──
export const guilds = pgTable("guilds", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon"),
  banner: text("banner"),
  splash: text("splash"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  description: text("description"),
  verificationLevel: integer("verification_level").notNull().default(0),
  defaultMessageNotifications: integer("default_message_notifications").notNull().default(0),
  explicitContentFilter: integer("explicit_content_filter").notNull().default(0),
  features: text("features").array().notNull().default([]),
  systemChannelId: text("system_channel_id"),
  rulesChannelId: text("rules_channel_id"),
  vanityUrlCode: text("vanity_url_code"),
  premiumTier: integer("premium_tier").notNull().default(0),
  premiumSubscriptionCount: integer("premium_subscription_count").notNull().default(0),
  preferredLocale: text("preferred_locale").notNull().default("en-US"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Channels ──
export const channels = pgTable(
  "channels",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id").references(() => guilds.id, { onDelete: "cascade" }),
    type: integer("type").notNull().default(0),
    name: text("name"),
    topic: text("topic"),
    position: integer("position").notNull().default(0),
    parentId: text("parent_id"),
    nsfw: boolean("nsfw").notNull().default(false),
    rateLimitPerUser: integer("rate_limit_per_user").notNull().default(0),
    bitrate: integer("bitrate"),
    userLimit: integer("user_limit"),
    lastMessageId: text("last_message_id"),
    ownerId: text("owner_id"),
    flags: integer("flags").notNull().default(0),
    messageRetentionSeconds: integer("message_retention_seconds"), // null = forever
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull().default(""),
    type: integer("type").notNull().default(0),
    flags: integer("flags").notNull().default(0),
    tts: boolean("tts").notNull().default(false),
    mentionEveryone: boolean("mention_everyone").notNull().default(false),
    pinned: boolean("pinned").notNull().default(false),
    editedTimestamp: timestamp("edited_timestamp", { withTimezone: true }),
    referencedMessageId: text("referenced_message_id"),
    webhookId: text("webhook_id"),
    nonce: text("nonce"),
    expiresAt: timestamp("expires_at", { withTimezone: true }), // for disappearing messages
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("messages_channel_id_idx").on(table.channelId),
    // Primary query pattern: paginated messages by channel
    index("messages_channel_created_idx").on(table.channelId, table.id),
    index("messages_author_id_idx").on(table.authorId),
  ]
);

// ── Roles ──
export const roles = pgTable(
  "roles",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: integer("color").notNull().default(0),
    hoist: boolean("hoist").notNull().default(false),
    icon: text("icon"),
    position: integer("position").notNull().default(0),
    permissions: text("permissions").notNull().default("0"), // BigInt as text
    managed: boolean("managed").notNull().default(false),
    mentionable: boolean("mentionable").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("roles_guild_id_idx").on(table.guildId)]
);

// ── Members ──
export const members = pgTable(
  "members",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    nickname: text("nickname"),
    avatar: text("avatar"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    premiumSince: timestamp("premium_since", { withTimezone: true }),
    deaf: boolean("deaf").notNull().default(false),
    mute: boolean("mute").notNull().default(false),
    pending: boolean("pending").notNull().default(false),
    communicationDisabledUntil: timestamp("communication_disabled_until", {
      withTimezone: true,
    }),
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
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.guildId, table.roleId] }),
    index("member_roles_guild_user_idx").on(table.guildId, table.userId),
  ]
);

// ── Permission Overwrites ──
export const permissionOverwrites = pgTable(
  "permission_overwrites",
  {
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    targetId: text("target_id").notNull(),
    targetType: integer("target_type").notNull(), // 0 = role, 1 = member
    allow: text("allow").notNull().default("0"),
    deny: text("deny").notNull().default("0"),
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
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetId: text("target_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: integer("type").notNull(), // 1=friend, 2=blocked, 3=incoming, 4=outgoing
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: text("user_id")
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
    code: text("code").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    inviterId: text("inviter_id").references(() => users.id, { onDelete: "cascade" }),
    maxUses: integer("max_uses").notNull().default(0),
    uses: integer("uses").notNull().default(0),
    maxAge: integer("max_age").notNull().default(86400), // 24h default
    temporary: boolean("temporary").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("invites_guild_id_idx").on(table.guildId),
  ]
);

// ── Bans ──
export const bans = pgTable(
  "bans",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason"),
    bannedBy: text("banned_by").references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })]
);

// ── Message Attachments ──
export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
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
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("rich"),
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
export const messageReactions = pgTable(
  "message_reactions",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emojiName: text("emoji_name").notNull(),
    emojiId: text("emoji_id"),
  },
  (table) => [
    primaryKey({
      columns: [table.messageId, table.userId, table.emojiName, table.emojiId],
    }),
    index("message_reactions_user_id_idx").on(table.userId),
  ]
);

// ── Custom Emojis ──
export const emojis = pgTable(
  "emojis",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    creatorId: text("creator_id").references(() => users.id, { onDelete: "cascade" }),
    animated: boolean("animated").notNull().default(false),
    available: boolean("available").notNull().default(true),
  },
  (table) => [index("emojis_guild_id_idx").on(table.guildId)]
);

// ── Webhooks ──
export const webhooks = pgTable(
  "webhooks",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    type: integer("type").notNull().default(1),
    name: text("name"),
    avatar: text("avatar"),
    token: text("token"),
    creatorId: text("creator_id").references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("webhooks_channel_id_idx").on(table.channelId)]
);

// ── Read States ──
export const readStates = pgTable(
  "read_states",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    lastMessageId: text("last_message_id"),
    mentionCount: integer("mention_count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.channelId] })]
);

// ── Audit Log ──
export const auditLogEntries = pgTable(
  "audit_log_entries",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    targetId: text("target_id"),
    actionType: integer("action_type").notNull(),
    reason: text("reason"),
    changes: jsonb("changes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_log_guild_id_idx").on(table.guildId)]
);

// ── Polls ──
export const polls = pgTable(
  "polls",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    allowMultiselect: boolean("allow_multiselect").notNull().default(false),
    anonymous: boolean("anonymous").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("polls_message_id_idx").on(table.messageId)]
);

export const pollOptions = pgTable(
  "poll_options",
  {
    id: text("id").primaryKey(),
    pollId: text("poll_id")
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
    pollId: text("poll_id")
      .notNull()
      .references(() => polls.id, { onDelete: "cascade" }),
    optionId: text("option_id")
      .notNull()
      .references(() => pollOptions.id, { onDelete: "cascade" }),
    userId: text("user_id")
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
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    sent: boolean("sent").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("scheduled_messages_scheduled_for_idx").on(table.scheduledFor),
    index("scheduled_messages_author_id_idx").on(table.authorId),
  ]
);

// ── Notification Log ──
export const notificationLog = pgTable(
  "notification_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // "mention", "reply", "dm", "friend_request"
    sourceGuildId: text("source_guild_id"),
    sourceChannelId: text("source_channel_id"),
    sourceMessageId: text("source_message_id"),
    sourceUserId: text("source_user_id"),
    title: text("title").notNull(),
    body: text("body"),
    read: boolean("read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("notification_log_user_id_idx").on(table.userId),
    index("notification_log_created_at_idx").on(table.createdAt),
  ]
);

// ── Server Backups ──
export const serverBackups = pgTable(
  "server_backups",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("server_backups_guild_id_idx").on(table.guildId)]
);

// ── Ban Appeals ──
export const banAppeals = pgTable(
  "ban_appeals",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["pending", "accepted", "rejected"] })
      .notNull()
      .default("pending"),
    moderatorId: text("moderator_id").references(() => users.id, { onDelete: "set null" }),
    moderatorReason: text("moderator_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("ban_appeals_guild_id_idx").on(table.guildId),
    index("ban_appeals_user_id_idx").on(table.userId),
  ]
);

// ── Thread Metadata ──
export const threadMetadata = pgTable("thread_metadata", {
  channelId: text("channel_id")
    .primaryKey()
    .references(() => channels.id, { onDelete: "cascade" }),
  archived: boolean("archived").notNull().default(false),
  autoArchiveDuration: integer("auto_archive_duration").notNull().default(1440), // minutes
  archiveTimestamp: timestamp("archive_timestamp", { withTimezone: true }),
  locked: boolean("locked").notNull().default(false),
  invitable: boolean("invitable").notNull().default(true),
});

// ── Thread Members ──
export const threadMembers = pgTable(
  "thread_members",
  {
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinTimestamp: timestamp("join_timestamp", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.channelId, table.userId] })]
);

// ── Moderation Queue ──
export const moderationQueue = pgTable(
  "moderation_queue",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // "message", "user", "automod"
    targetId: text("target_id").notNull(),
    reason: text("reason").notNull(),
    reportedBy: text("reported_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "approved", "rejected", "escalated"] })
      .notNull()
      .default("pending"),
    moderatorId: text("moderator_id").references(() => users.id, { onDelete: "set null" }),
    moderatorNote: text("moderator_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
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
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    guildId: text("guild_id").references(() => guilds.id, { onDelete: "cascade" }),
    channelId: text("channel_id").references(() => channels.id, { onDelete: "cascade" }),
    level: text("level", { enum: ["all", "mentions", "none"] }).notNull().default("all"),
    suppressEveryone: boolean("suppress_everyone").notNull().default(false),
    suppressRoles: boolean("suppress_roles").notNull().default(false),
    muted: boolean("muted").notNull().default(false),
    muteUntil: timestamp("mute_until", { withTimezone: true }),
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
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    content: text("content").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("thread_templates_channel_id_idx").on(table.channelId),
  ]
);

// ══════════════════════════════════════════════════════════════════════════════
// NEW TABLES - P0 Critical Features
// ══════════════════════════════════════════════════════════════════════════════

// ── Forum Tags ──
export const forumTags = pgTable(
  "forum_tags",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    emojiId: text("emoji_id"),
    emojiName: text("emoji_name"),
    moderated: boolean("moderated").notNull().default(false), // Only mods can apply
    position: integer("position").notNull().default(0),
  },
  (table) => [index("forum_tags_channel_id_idx").on(table.channelId)]
);

// ── Forum Post Tags (join table) ──
export const forumPostTags = pgTable(
  "forum_post_tags",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => forumTags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.tagId] }),
    index("forum_post_tags_thread_idx").on(table.threadId),
  ]
);

// ── AutoMod Config (persistent, was in-memory) ──
export const automodConfig = pgTable("automod_config", {
  guildId: text("guild_id")
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
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Passkey Credentials (WebAuthn, was in-memory) ──
export const passkeyCredentials = pgTable(
  "passkey_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull(),
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    deviceType: text("device_type"),
    backedUp: boolean("backed_up").notNull().default(false),
    transports: text("transports").array(),
    aaguid: text("aaguid"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("passkey_credentials_user_idx").on(table.userId),
    uniqueIndex("passkey_credentials_cred_id_idx").on(table.credentialId),
  ]
);

// ── Verification Codes (was in-memory) ──
export const verificationCodes = pgTable(
  "verification_codes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    type: text("type", { enum: ["email", "phone", "password_reset"] }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    used: boolean("used").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("verification_codes_user_idx").on(table.userId),
    index("verification_codes_expires_idx").on(table.expiresAt),
    uniqueIndex("verification_codes_code_idx").on(table.code),
  ]
);

// ── Guild Events (persistent, was in-memory) ──
export const guildEvents = pgTable(
  "guild_events",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    channelId: text("channel_id").references(() => channels.id, { onDelete: "set null" }),
    creatorId: text("creator_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    image: text("image"),
    scheduledStartTime: timestamp("scheduled_start_time", { withTimezone: true }).notNull(),
    scheduledEndTime: timestamp("scheduled_end_time", { withTimezone: true }),
    privacyLevel: integer("privacy_level").notNull().default(2), // 1=public, 2=guild_only
    status: integer("status").notNull().default(1), // 1=scheduled, 2=active, 3=completed, 4=canceled
    entityType: integer("entity_type").notNull().default(1), // 1=stage, 2=voice, 3=external
    entityMetadata: jsonb("entity_metadata").$type<{ location?: string }>(),
    recurrenceRule: jsonb("recurrence_rule").$type<{
      frequency: "daily" | "weekly" | "monthly";
      interval?: number;
      byWeekday?: number[];
      count?: number;
      endDate?: string;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
    eventId: text("event_id")
      .notNull()
      .references(() => guildEvents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["interested", "going", "not_going"] }).notNull().default("interested"),
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
export const applications = pgTable(
  "applications",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    icon: text("icon"),
    description: text("description").notNull().default(""),
    botPublic: boolean("bot_public").notNull().default(true),
    botRequireCodeGrant: boolean("bot_require_code_grant").notNull().default(false),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    botUserId: text("bot_user_id").references(() => users.id, { onDelete: "cascade" }),
    verifyKey: text("verify_key").notNull(),
    flags: integer("flags").notNull().default(0),
    interactionsEndpointUrl: text("interactions_endpoint_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("applications_owner_idx").on(table.ownerId)]
);

// ── Application Commands (Slash Commands) ──
export const applicationCommands = pgTable(
  "application_commands",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    guildId: text("guild_id").references(() => guilds.id, { onDelete: "cascade" }), // null = global
    name: text("name").notNull(),
    description: text("description").notNull(),
    type: integer("type").notNull().default(1), // 1=CHAT_INPUT, 2=USER, 3=MESSAGE
    options: jsonb("options").$type<ApplicationCommandOption[]>(),
    defaultMemberPermissions: text("default_member_permissions"),
    dmPermission: boolean("dm_permission").notNull().default(true),
    nsfw: boolean("nsfw").notNull().default(false),
    version: text("version").notNull(),
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
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    type: integer("type").notNull(), // 1=ActionRow, 2=Button, 3=StringSelect, 4=TextInput, 5=UserSelect, 6=RoleSelect, 7=MentionableSelect, 8=ChannelSelect
    customId: text("custom_id"),
    label: text("label"),
    style: integer("style"), // Button: 1=Primary, 2=Secondary, 3=Success, 4=Danger, 5=Link
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
    parentId: text("parent_id"),
    position: integer("position").notNull().default(0),
  },
  (table) => [index("message_components_message_idx").on(table.messageId)]
);

// ── Interactions ──
export const interactions = pgTable(
  "interactions",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    type: integer("type").notNull(), // 1=Ping, 2=ApplicationCommand, 3=MessageComponent, 4=Autocomplete, 5=ModalSubmit
    guildId: text("guild_id").references(() => guilds.id, { onDelete: "cascade" }),
    channelId: text("channel_id").references(() => channels.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    data: jsonb("data"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (table) => [
    index("interactions_app_idx").on(table.applicationId),
    index("interactions_token_idx").on(table.token),
  ]
);

// ══════════════════════════════════════════════════════════════════════════════
// NEW TABLES - P2 Medium Priority Features
// ══════════════════════════════════════════════════════════════════════════════

// ── Stickers ──
export const stickers = pgTable(
  "stickers",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id").references(() => guilds.id, { onDelete: "cascade" }), // null = standard
    packId: text("pack_id"),
    name: text("name").notNull(),
    description: text("description"),
    tags: text("tags").notNull(), // Autocomplete/suggestion tags
    type: integer("type").notNull(), // 1=standard, 2=guild
    formatType: integer("format_type").notNull(), // 1=png, 2=apng, 3=lottie, 4=gif
    available: boolean("available").notNull().default(true),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }), // Creator
    sortValue: integer("sort_value"),
  },
  (table) => [index("stickers_guild_idx").on(table.guildId)]
);

// ── Message Stickers (join table) ──
export const messageStickers = pgTable(
  "message_stickers",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    stickerId: text("sticker_id")
      .notNull()
      .references(() => stickers.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.stickerId] })]
);

// ── User Activities (Rich Presence) ──
export const userActivities = pgTable(
  "user_activities",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    activities: jsonb("activities").$type<UserActivity[]>().notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// NEW TABLES - User Sessions & Recovery
// ══════════════════════════════════════════════════════════════════════════════

// ── User Sessions ──
export const userSessions = pgTable(
  "user_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(), // Hashed JWT ID for revocation
    deviceInfo: jsonb("device_info").$type<{ os?: string; browser?: string; device?: string }>(),
    ipAddress: text("ip_address"),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
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
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull(), // Hashed recovery key
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("recovery_keys_user_idx").on(table.userId)]
);

// ══════════════════════════════════════════════════════════════════════════════
// NEW TABLES - User Notes & Guild Features
// ══════════════════════════════════════════════════════════════════════════════

// ── User Notes (private notes about other users) ──
export const userNotes = pgTable(
  "user_notes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetUserId: text("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    note: text("note").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
    code: text("code").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    usageCount: integer("usage_count").notNull().default(0),
    creatorId: text("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    serializedGuild: jsonb("serialized_guild").$type<SerializedGuild>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    isDirty: boolean("is_dirty").notNull().default(false),
  },
  (table) => [
    index("guild_templates_guild_idx").on(table.guildId),
  ]
);

// ── Guild Welcome Screens ──
export const guildWelcomeScreens = pgTable("guild_welcome_screens", {
  guildId: text("guild_id")
    .primaryKey()
    .references(() => guilds.id, { onDelete: "cascade" }),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(false),
  welcomeChannels: jsonb("welcome_channels").$type<WelcomeChannel[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Guild Onboarding ──
export const guildOnboarding = pgTable("guild_onboarding", {
  guildId: text("guild_id")
    .primaryKey()
    .references(() => guilds.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  defaultChannelIds: text("default_channel_ids").array().notNull().default([]),
  mode: integer("mode").notNull().default(0), // 0=default, 1=advanced
  prompts: jsonb("prompts").$type<OnboardingPrompt[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Guild Widgets ──
export const guildWidgets = pgTable("guild_widgets", {
  guildId: text("guild_id")
    .primaryKey()
    .references(() => guilds.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  channelId: text("channel_id").references(() => channels.id, { onDelete: "set null" }),
});

// ── Channel Following (announcements) ──
export const channelFollowers = pgTable(
  "channel_followers",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("channel_followers_channel_idx").on(table.channelId),
    index("channel_followers_webhook_idx").on(table.webhookId),
  ]
);

// ── Guild Previews (for discovery) ──
export const guildPreviews = pgTable("guild_previews", {
  guildId: text("guild_id")
    .primaryKey()
    .references(() => guilds.id, { onDelete: "cascade" }),
  approximateMemberCount: integer("approximate_member_count").notNull().default(0),
  approximatePresenceCount: integer("approximate_presence_count").notNull().default(0),
  discoverable: boolean("discoverable").notNull().default(false),
  featuredAt: timestamp("featured_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ══════════════════════════════════════════════════════════════════════════════
// Type Definitions for JSONB fields
// ══════════════════════════════════════════════════════════════════════════════

export interface ApplicationCommandOption {
  type: number; // 1-11 for various types
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
  type: number; // 0=Playing, 1=Streaming, 2=Listening, 3=Watching, 4=Custom, 5=Competing
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
  type: number; // 0=multiple_choice, 1=dropdown
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
