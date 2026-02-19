// ── Channel Types ──
export enum ChannelType {
  GUILD_TEXT = 0,
  DM = 1,
  GUILD_VOICE = 2,
  GROUP_DM = 3,
  GUILD_CATEGORY = 4,
  GUILD_ANNOUNCEMENT = 5,
  ANNOUNCEMENT_THREAD = 10,
  PUBLIC_THREAD = 11,
  PRIVATE_THREAD = 12,
  GUILD_STAGE_VOICE = 13,
  GUILD_FORUM = 15,
}

// ── Verification Levels ──
export enum VerificationLevel {
  NONE = 0,
  LOW = 1,
  MEDIUM = 2,
  HIGH = 3,
  VERY_HIGH = 4,
}

// ── Message Notification Level ──
export enum MessageNotificationLevel {
  ALL_MESSAGES = 0,
  ONLY_MENTIONS = 1,
}

// ── Explicit Content Filter ──
export enum ExplicitContentFilter {
  DISABLED = 0,
  MEMBERS_WITHOUT_ROLES = 1,
  ALL_MEMBERS = 2,
}

// ── Message Types ──
export enum MessageType {
  DEFAULT = 0,
  RECIPIENT_ADD = 1,
  RECIPIENT_REMOVE = 2,
  CALL = 3,
  CHANNEL_NAME_CHANGE = 4,
  CHANNEL_ICON_CHANGE = 5,
  CHANNEL_PINNED_MESSAGE = 6,
  USER_JOIN = 7,
  GUILD_BOOST = 8,
  GUILD_BOOST_TIER_1 = 9,
  GUILD_BOOST_TIER_2 = 10,
  GUILD_BOOST_TIER_3 = 11,
  THREAD_CREATED = 18,
  REPLY = 19,
  AUTO_MODERATION_ACTION = 24,
}

// ── Relationship Types ──
export enum RelationshipType {
  FRIEND = 1,
  BLOCKED = 2,
  INCOMING_REQUEST = 3,
  OUTGOING_REQUEST = 4,
}

// ── Audit Log Action Types ──
export enum AuditLogActionType {
  GUILD_UPDATE = 1,
  CHANNEL_CREATE = 10,
  CHANNEL_UPDATE = 11,
  CHANNEL_DELETE = 12,
  CHANNEL_OVERWRITE_CREATE = 13,
  CHANNEL_OVERWRITE_UPDATE = 14,
  CHANNEL_OVERWRITE_DELETE = 15,
  MEMBER_KICK = 20,
  MEMBER_PRUNE = 21,
  MEMBER_BAN_ADD = 22,
  MEMBER_BAN_REMOVE = 23,
  MEMBER_UPDATE = 24,
  MEMBER_ROLE_UPDATE = 25,
  ROLE_CREATE = 30,
  ROLE_UPDATE = 31,
  ROLE_DELETE = 32,
  INVITE_CREATE = 40,
  INVITE_UPDATE = 41,
  INVITE_DELETE = 42,
  WEBHOOK_CREATE = 50,
  WEBHOOK_UPDATE = 51,
  WEBHOOK_DELETE = 52,
  EMOJI_CREATE = 60,
  EMOJI_UPDATE = 61,
  EMOJI_DELETE = 62,
  MESSAGE_DELETE = 72,
  MESSAGE_BULK_DELETE = 73,
  MESSAGE_PIN = 74,
  MESSAGE_UNPIN = 75,
  THREAD_CREATE = 110,
  THREAD_UPDATE = 111,
  THREAD_DELETE = 112,
  AUTO_MODERATION_RULE_CREATE = 140,
  AUTO_MODERATION_RULE_UPDATE = 141,
  AUTO_MODERATION_RULE_DELETE = 142,
  AUTO_MODERATION_BLOCK_MESSAGE = 143,
}

// ── API Types ──

export interface User {
  id: string;
  username: string;
  displayName: string | null;
  email?: string;
  avatar: string | null;
  banner: string | null;
  bio: string | null;
  status: "online" | "idle" | "dnd" | "offline";
  customStatus: { text?: string; emoji?: string } | null;
  mfaEnabled: boolean;
  verified: boolean;
  flags: number;
  premiumType: number;
  locale: string;
  createdAt: string;
}

export interface Guild {
  id: string;
  name: string;
  icon: string | null;
  banner: string | null;
  splash: string | null;
  ownerId: string;
  description: string | null;
  verificationLevel: VerificationLevel;
  defaultMessageNotifications: MessageNotificationLevel;
  explicitContentFilter: ExplicitContentFilter;
  features: string[];
  systemChannelId: string | null;
  rulesChannelId: string | null;
  vanityUrlCode: string | null;
  premiumTier: number;
  premiumSubscriptionCount: number;
  preferredLocale: string;
  createdAt: string;
}

export interface Channel {
  id: string;
  guildId: string | null;
  type: ChannelType;
  name: string | null;
  topic: string | null;
  position: number;
  parentId: string | null;
  nsfw: boolean;
  rateLimitPerUser: number;
  bitrate: number | null;
  userLimit: number | null;
  lastMessageId: string | null;
  ownerId: string | null;
  flags: number;
  messageRetentionSeconds: number | null;
  createdAt: string;
}

export interface Message {
  id: string;
  channelId: string;
  author: User;
  content: string;
  type: MessageType;
  flags: number;
  tts: boolean;
  mentionEveryone: boolean;
  pinned: boolean;
  editedTimestamp: string | null;
  referencedMessageId: string | null;
  referencedMessage?: Message | null;
  webhookId: string | null;
  attachments: Attachment[];
  embeds: Embed[];
  reactions: Reaction[];
  poll?: Poll | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface Attachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  proxyUrl: string;
  contentType: string | null;
  width: number | null;
  height: number | null;
}

export interface Embed {
  type: string;
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  footer?: { text: string; iconUrl?: string };
  image?: { url: string; width?: number; height?: number };
  thumbnail?: { url: string; width?: number; height?: number };
  author?: { name: string; url?: string; iconUrl?: string };
  fields?: { name: string; value: string; inline?: boolean }[];
}

export interface Reaction {
  emoji: { id: string | null; name: string };
  count: number;
  me: boolean;
}

export interface Role {
  id: string;
  guildId: string;
  name: string;
  color: number;
  hoist: boolean;
  icon: string | null;
  position: number;
  permissions: string; // BigInt as string
  managed: boolean;
  mentionable: boolean;
  createdAt: string;
}

export interface Member {
  userId: string;
  guildId: string;
  user?: User;
  nickname: string | null;
  avatar: string | null;
  roles: string[];
  joinedAt: string;
  premiumSince: string | null;
  deaf: boolean;
  mute: boolean;
  pending: boolean;
  communicationDisabledUntil: string | null;
}

export interface Invite {
  code: string;
  guildId: string;
  channelId: string;
  inviterId: string | null;
  maxUses: number;
  uses: number;
  maxAge: number;
  temporary: boolean;
  expiresAt: string | null;
  guild?: Partial<Guild>;
  channel?: Partial<Channel>;
  inviter?: User;
}

export interface VoiceState {
  userId: string;
  guildId: string;
  channelId: string | null;
  sessionId: string;
  deaf: boolean;
  mute: boolean;
  selfDeaf: boolean;
  selfMute: boolean;
  selfStream: boolean;
  selfVideo: boolean;
  suppress: boolean;
}

export interface ReadState {
  channelId: string;
  lastMessageId: string | null;
  mentionCount: number;
}

// ── API Request/Response Types ──

export interface CreateGuildRequest {
  name: string;
  icon?: string;
}

export interface CreateChannelRequest {
  name: string;
  type: ChannelType;
  topic?: string;
  parentId?: string;
  nsfw?: boolean;
  rateLimitPerUser?: number;
  bitrate?: number;
  userLimit?: number;
  position?: number;
}

export interface CreateMessageRequest {
  content?: string;
  tts?: boolean;
  nonce?: string;
  messageReference?: { messageId: string };
  attachments?: { id: string; filename: string }[];
}

export interface CreateRoleRequest {
  name?: string;
  color?: number;
  hoist?: boolean;
  permissions?: string;
  mentionable?: boolean;
}

export interface CreateInviteRequest {
  maxAge?: number;
  maxUses?: number;
  temporary?: boolean;
}

export interface UpdateUserRequest {
  username?: string;
  displayName?: string;
  avatar?: string;
  banner?: string;
  bio?: string;
}

export interface UpdateGuildRequest {
  name?: string;
  icon?: string;
  banner?: string;
  description?: string;
  verificationLevel?: VerificationLevel;
  defaultMessageNotifications?: MessageNotificationLevel;
  explicitContentFilter?: ExplicitContentFilter;
  systemChannelId?: string;
  rulesChannelId?: string;
}

export interface UpdateChannelRequest {
  name?: string;
  topic?: string;
  position?: number;
  parentId?: string | null;
  nsfw?: boolean;
  rateLimitPerUser?: number;
  bitrate?: number;
  userLimit?: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
}

export interface AuthResponse {
  token: string | null;
  user: User | null;
  mfa?: boolean;
  ticket?: string;
}

// ── Poll Types ──

export interface Poll {
  id: string;
  channelId: string;
  messageId: string;
  question: string;
  allowMultiselect: boolean;
  anonymous: boolean;
  expiresAt: string | null;
  options: PollOption[];
  totalVotes: number;
  createdAt: string;
}

export interface PollOption {
  id: string;
  text: string;
  position: number;
  votes: number;
  voted: boolean; // whether current user voted for this option
}

export interface CreatePollRequest {
  question: string;
  options: string[];
  allowMultiselect?: boolean;
  anonymous?: boolean;
  duration?: number; // seconds until expiry
}

// ── Scheduled Message Types ──

export interface ScheduledMessage {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  scheduledFor: string;
  sent: boolean;
  createdAt: string;
}

export interface CreateScheduledMessageRequest {
  content: string;
  scheduledFor: string; // ISO date string
}

// ── Notification Types ──

export interface Notification {
  id: string;
  userId: string;
  type: string;
  sourceGuildId: string | null;
  sourceChannelId: string | null;
  sourceMessageId: string | null;
  sourceUserId: string | null;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
}

// ── Server Backup Types ──

export interface ServerBackup {
  id: string;
  guildId: string;
  createdBy: string;
  createdAt: string;
}

// ── Ban Appeal Types ──

export interface BanAppeal {
  id: string;
  guildId: string;
  userId: string;
  reason: string;
  status: "pending" | "accepted" | "rejected";
  moderatorId: string | null;
  moderatorReason: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

// ── Moderation Queue Types ──

export interface ModerationQueueItem {
  id: string;
  guildId: string;
  type: string;
  targetId: string;
  reason: string;
  reportedBy: string;
  status: "pending" | "approved" | "rejected" | "escalated";
  moderatorId: string | null;
  moderatorNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ModeratorAnalytics {
  moderatorActions: Array<{ moderatorId: string | null; count: number }>;
  statusBreakdown: Array<{ status: string; count: number }>;
  typeBreakdown: Array<{ type: string; count: number }>;
  recentItemCount: number;
}

// ── Thread Template Types ──

export interface ThreadTemplate {
  id: string;
  channelId: string;
  guildId: string;
  name: string;
  content: string;
  createdBy: string;
  createdAt: string;
}

// ── Notification Settings Types ──

export interface NotificationSettings {
  userId: string;
  guildId: string | null;
  channelId: string | null;
  level: "all" | "mentions" | "none";
  suppressEveryone: boolean;
  suppressRoles: boolean;
  muted: boolean;
  muteUntil: string | null;
}

// ── Event Types ──

export interface GuildEvent {
  id: string;
  guildId: string;
  channelId?: string;
  title: string;
  description: string;
  startTime: string;
  endTime?: string;
  location?: string;
  creatorId: string;
  interested: string[];
  recurring?: {
    frequency: "daily" | "weekly" | "monthly";
    interval: number;
    until?: string;
  };
  createdAt: string;
}

// ── AutoMod Types ──

export interface AutoModConfig {
  keywordFilter: { enabled: boolean; keywords: string[] };
  spamProtection: { enabled: boolean; maxMessages: number; timeWindow: number };
  antiRaid: { enabled: boolean; minAccountAge: number; maxJoinsPerMinute: number };
  linkFilter: { enabled: boolean; whitelist: string[] };
  mentionSpam: { enabled: boolean; maxMentions: number };
  action: "delete" | "warn" | "mute" | "kick" | "ban";
}

// ── Passkey Types ──

export interface Passkey {
  credentialId: string;
  name: string;
  createdAt: string;
  lastUsed?: string;
}

// ── Data Export Types ──

export interface UserDataExport {
  exportedAt: string;
  user: Partial<User>;
  guilds: Array<{ guildId: string; nickname: string | null; joinedAt: string }>;
  messages: Array<{ id: string; channelId: string; content: string; createdAt: string }>;
  relationships: Array<{ userId: string; targetId: string; type: number; createdAt: string }>;
  readStates: Array<{ channelId: string; lastMessageId: string | null; mentionCount: number }>;
}
