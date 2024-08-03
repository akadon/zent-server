import type { User, Guild, Channel, Message, Member, VoiceState, ReadState, Role, Poll, Notification, GuildEvent, ModerationQueueItem } from "@yxc/types";

// ── Gateway Opcodes ──
export enum GatewayOp {
  DISPATCH = 0,
  HEARTBEAT = 1,
  IDENTIFY = 2,
  PRESENCE_UPDATE = 3,
  VOICE_STATE_UPDATE = 4,
  RESUME = 6,
  RECONNECT = 7,
  REQUEST_GUILD_MEMBERS = 8,
  INVALID_SESSION = 9,
  HELLO = 10,
  HEARTBEAT_ACK = 11,
  // New opcodes for spatial audio
  VOICE_SPATIAL_UPDATE = 12,
}

// ── Gateway Intents ──
export enum GatewayIntentBits {
  GUILDS = 1 << 0,
  GUILD_MEMBERS = 1 << 1, // Privileged
  GUILD_MODERATION = 1 << 2,
  GUILD_EMOJIS_AND_STICKERS = 1 << 3,
  GUILD_INTEGRATIONS = 1 << 4,
  GUILD_WEBHOOKS = 1 << 5,
  GUILD_INVITES = 1 << 6,
  GUILD_VOICE_STATES = 1 << 7,
  GUILD_PRESENCES = 1 << 8, // Privileged
  GUILD_MESSAGES = 1 << 9,
  GUILD_MESSAGE_REACTIONS = 1 << 10,
  GUILD_MESSAGE_TYPING = 1 << 11,
  DIRECT_MESSAGES = 1 << 12,
  DIRECT_MESSAGE_REACTIONS = 1 << 13,
  DIRECT_MESSAGE_TYPING = 1 << 14,
  MESSAGE_CONTENT = 1 << 15, // Privileged
  GUILD_SCHEDULED_EVENTS = 1 << 16,
  // 17-19 reserved
  AUTO_MODERATION_CONFIGURATION = 1 << 20,
  AUTO_MODERATION_EXECUTION = 1 << 21,
  // 22-23 reserved
  GUILD_MESSAGE_POLLS = 1 << 24,
  DIRECT_MESSAGE_POLLS = 1 << 25,
  // New intents for expressions (soundboard, stickers)
  GUILD_EXPRESSIONS = 1 << 26,
}

export const PRIVILEGED_INTENTS =
  GatewayIntentBits.GUILD_MEMBERS |
  GatewayIntentBits.GUILD_PRESENCES |
  GatewayIntentBits.MESSAGE_CONTENT;

// ── Gateway Events ──
export type GatewayEvent =
  // Connection
  | "READY"
  | "RESUMED"
  // Messages
  | "MESSAGE_CREATE"
  | "MESSAGE_UPDATE"
  | "MESSAGE_DELETE"
  | "MESSAGE_DELETE_BULK"
  | "MESSAGE_REACTION_ADD"
  | "MESSAGE_REACTION_REMOVE"
  | "MESSAGE_REACTION_REMOVE_ALL"
  | "MESSAGE_REACTION_REMOVE_EMOJI"
  // Typing
  | "TYPING_START"
  // Presence
  | "PRESENCE_UPDATE"
  // Guild
  | "GUILD_CREATE"
  | "GUILD_UPDATE"
  | "GUILD_DELETE"
  | "GUILD_MEMBER_ADD"
  | "GUILD_MEMBER_UPDATE"
  | "GUILD_MEMBER_REMOVE"
  | "GUILD_MEMBERS_CHUNK"
  | "GUILD_ROLE_CREATE"
  | "GUILD_ROLE_UPDATE"
  | "GUILD_ROLE_DELETE"
  | "GUILD_BAN_ADD"
  | "GUILD_BAN_REMOVE"
  | "GUILD_EMOJIS_UPDATE"
  | "GUILD_STICKERS_UPDATE"
  // Channels
  | "CHANNEL_CREATE"
  | "CHANNEL_UPDATE"
  | "CHANNEL_DELETE"
  | "CHANNEL_PINS_UPDATE"
  // Voice
  | "VOICE_STATE_UPDATE"
  | "VOICE_SERVER_UPDATE"
  | "VOICE_CHANNEL_EFFECT_SEND"
  | "VOICE_SPATIAL_UPDATE"
  // Invites
  | "INVITE_CREATE"
  | "INVITE_DELETE"
  // Threads
  | "THREAD_CREATE"
  | "THREAD_UPDATE"
  | "THREAD_DELETE"
  | "THREAD_LIST_SYNC"
  | "THREAD_MEMBER_UPDATE"
  | "THREAD_MEMBERS_UPDATE"
  // Polls
  | "POLL_VOTE_ADD"
  | "POLL_VOTE_REMOVE"
  | "POLL_END"
  // Notifications
  | "NOTIFICATION_CREATE"
  // Moderation
  | "MODERATION_QUEUE_ADD"
  | "AUTO_MODERATION_RULE_CREATE"
  | "AUTO_MODERATION_RULE_UPDATE"
  | "AUTO_MODERATION_RULE_DELETE"
  | "AUTO_MODERATION_ACTION_EXECUTION"
  // Scheduled Events
  | "GUILD_SCHEDULED_EVENT_CREATE"
  | "GUILD_SCHEDULED_EVENT_UPDATE"
  | "GUILD_SCHEDULED_EVENT_DELETE"
  | "GUILD_SCHEDULED_EVENT_USER_ADD"
  | "GUILD_SCHEDULED_EVENT_USER_REMOVE"
  // Stage Instances
  | "STAGE_INSTANCE_CREATE"
  | "STAGE_INSTANCE_UPDATE"
  | "STAGE_INSTANCE_DELETE"
  // Interactions (Slash Commands, Buttons, etc.)
  | "INTERACTION_CREATE"
  // Integrations
  | "INTEGRATION_CREATE"
  | "INTEGRATION_UPDATE"
  | "INTEGRATION_DELETE"
  // Webhooks
  | "WEBHOOKS_UPDATE"
  // Soundboard
  | "SOUNDBOARD_SOUNDS_UPDATE"
  | "SOUNDBOARD_SOUND_PLAY";

// ── Gateway Payload ──
export interface GatewayPayload {
  op: GatewayOp;
  d: unknown;
  s?: number; // sequence number (only for DISPATCH)
  t?: GatewayEvent; // event name (only for DISPATCH)
}

// ── Client -> Server Payloads ──
export interface IdentifyPayload {
  token: string;
  intents?: number; // Bitfield of GatewayIntentBits
  properties?: {
    os?: string;
    browser?: string;
    device?: string;
  };
  compress?: boolean;
  largeThreshold?: number; // 50-250, default 50
  shard?: [shardId: number, numShards: number];
  presence?: PresenceUpdatePayload;
}

export interface RequestGuildMembersPayload {
  guildId: string;
  query?: string; // Username prefix, "" for all
  limit: number; // Max 100
  presences?: boolean;
  userIds?: string[];
  nonce?: string;
}

export interface VoiceSpatialUpdatePayload {
  guildId: string;
  channelId: string;
  position: { x: number; y: number; z: number };
}

export interface HeartbeatPayload {
  lastSequence: number | null;
}

export interface PresenceUpdatePayload {
  status: "online" | "idle" | "dnd" | "offline";
  customStatus?: { text?: string; emoji?: string } | null;
  activities?: Activity[];
  since?: number | null; // Unix time (ms) of going idle
  afk?: boolean;
}

// ── Rich Presence / Activities ──
export enum ActivityType {
  PLAYING = 0,
  STREAMING = 1,
  LISTENING = 2,
  WATCHING = 3,
  CUSTOM = 4,
  COMPETING = 5,
  HANG = 6,
}

export interface Activity {
  name: string;
  type: ActivityType;
  url?: string; // Streaming only (Twitch/YouTube)
  createdAt?: number;
  timestamps?: {
    start?: number;
    end?: number;
  };
  applicationId?: string;
  details?: string; // Line 1
  state?: string; // Line 2
  emoji?: {
    name: string;
    id?: string;
    animated?: boolean;
  };
  party?: {
    id?: string;
    size?: [current: number, max: number];
  };
  assets?: {
    largeImage?: string;
    largeText?: string;
    smallImage?: string;
    smallText?: string;
  };
  secrets?: {
    join?: string;
    spectate?: string;
    match?: string;
  };
  instance?: boolean;
  flags?: number;
  buttons?: Array<{ label: string; url: string }>;
}

export enum ActivityFlags {
  INSTANCE = 1 << 0,
  JOIN = 1 << 1,
  SPECTATE = 1 << 2,
  JOIN_REQUEST = 1 << 3,
  SYNC = 1 << 4,
  PLAY = 1 << 5,
  PARTY_PRIVACY_FRIENDS = 1 << 6,
  PARTY_PRIVACY_VOICE_CHANNEL = 1 << 7,
  EMBEDDED = 1 << 8,
}

export interface VoiceStateUpdatePayload {
  guildId: string;
  channelId: string | null; // null = disconnect
  selfMute: boolean;
  selfDeaf: boolean;
}

// ── Server -> Client Event Payloads ──
export interface HelloPayload {
  heartbeatInterval: number;
}

export interface ReadyPayload {
  user: User;
  guilds: GuildCreatePayload[];
  sessionId: string;
  readStates: ReadState[];
  relationships: Array<{
    id: string;
    type: number;
    user: User;
  }>;
  dmChannels: Array<Channel & { recipients: User[] }>;
}

export interface GuildCreatePayload extends Guild {
  channels: Channel[];
  members: Member[];
  roles: Role[];
  voiceStates: VoiceState[];
  memberCount: number;
}

export interface MessageCreatePayload extends Message {}

export interface MessageUpdatePayload {
  id: string;
  channelId: string;
  content?: string;
  editedTimestamp: string;
  pinned?: boolean;
}

export interface MessageDeletePayload {
  id: string;
  channelId: string;
  guildId?: string;
}

export interface TypingStartPayload {
  channelId: string;
  guildId?: string;
  userId: string;
  timestamp: number;
  member?: Member;
}

export interface PresenceUpdateEventPayload {
  userId: string;
  guildId?: string;
  status: "online" | "idle" | "dnd" | "offline";
  customStatus?: { text?: string; emoji?: string } | null;
  activities?: Activity[];
  clientStatus?: {
    desktop?: string;
    mobile?: string;
    web?: string;
  };
}

export interface GuildMemberAddPayload extends Member {
  guildId: string;
}

export interface GuildMemberUpdatePayload {
  guildId: string;
  userId: string;
  roles?: string[];
  nickname?: string | null;
  communicationDisabledUntil?: string | null;
}

export interface GuildMemberRemovePayload {
  guildId: string;
  user: User;
}

export interface GuildRoleCreatePayload {
  guildId: string;
  role: Role;
}

export interface GuildRoleUpdatePayload {
  guildId: string;
  role: Role;
}

export interface GuildRoleDeletePayload {
  guildId: string;
  roleId: string;
}

export interface ChannelCreatePayload extends Channel {
  guildId: string;
}

export interface VoiceStateUpdateEventPayload extends VoiceState {}

export interface MessageReactionAddPayload {
  userId: string;
  channelId: string;
  messageId: string;
  guildId?: string;
  emoji: { id: string | null; name: string };
}

export interface MessageReactionRemovePayload {
  userId: string;
  channelId: string;
  messageId: string;
  guildId?: string;
  emoji: { id: string | null; name: string };
}

export interface InviteCreatePayload {
  channelId: string;
  guildId: string;
  code: string;
  inviter?: User;
  maxAge: number;
  maxUses: number;
  temporary: boolean;
  expiresAt: string | null;
}

export interface InviteDeletePayload {
  channelId: string;
  guildId: string;
  code: string;
}

export interface GuildBanAddPayload {
  guildId: string;
  user: User;
}

export interface GuildBanRemovePayload {
  guildId: string;
  user: User;
}

export interface PollVoteAddPayload {
  pollId: string;
  optionId: string;
  userId: string;
  channelId: string;
  messageId: string;
  guildId?: string;
}

export interface PollVoteRemovePayload {
  pollId: string;
  optionId: string;
  userId: string;
  channelId: string;
  messageId: string;
  guildId?: string;
}

export interface PollEndPayload {
  pollId: string;
  channelId: string;
  messageId: string;
  guildId?: string;
  poll: Poll;
}

export interface NotificationCreatePayload extends Notification {}

// ── Thread Event Payloads ──
export interface ThreadCreatePayload extends Channel {
  guildId: string;
  newlyCreated?: boolean;
}

export interface ThreadUpdatePayload extends Channel {
  guildId: string;
}

export interface ThreadDeletePayload {
  id: string;
  guildId: string;
  parentId: string;
  type: number;
}

export interface ThreadMemberUpdatePayload {
  id: string;
  guildId: string;
  userId: string;
  joinTimestamp: string;
}

// ── Bulk Delete ──
export interface MessageDeleteBulkPayload {
  ids: string[];
  channelId: string;
  guildId?: string;
}

// ── Moderation ──
export interface ModerationQueueAddPayload extends ModerationQueueItem {}

// ── Scheduled Events ──
export interface GuildScheduledEventCreatePayload extends GuildEvent {}
export interface GuildScheduledEventUpdatePayload extends GuildEvent {}
export interface GuildScheduledEventDeletePayload {
  id: string;
  guildId: string;
}

// ── Voice Server ──
export interface VoiceServerUpdatePayload {
  guildId: string;
  channelId: string;
  endpoint: string;
  livekitToken: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// NEW EVENT PAYLOADS
// ══════════════════════════════════════════════════════════════════════════════

// ── Guild Members Chunk (lazy loading response) ──
export interface GuildMembersChunkPayload {
  guildId: string;
  members: Member[];
  chunkIndex: number;
  chunkCount: number;
  notFound?: string[];
  presences?: PresenceUpdateEventPayload[];
  nonce?: string;
}

// ── Stage Instances ──
export interface StageInstance {
  id: string;
  guildId: string;
  channelId: string;
  topic: string;
  privacyLevel: number;
  discoverableDisabled: boolean;
  guildScheduledEventId?: string;
}

export interface StageInstanceCreatePayload extends StageInstance {}
export interface StageInstanceUpdatePayload extends StageInstance {}
export interface StageInstanceDeletePayload {
  id: string;
  guildId: string;
  channelId: string;
}

// ── Interactions (Slash Commands, Buttons, etc.) ──
export interface Interaction {
  id: string;
  applicationId: string;
  type: InteractionType;
  data?: InteractionData;
  guildId?: string;
  channelId?: string;
  member?: Member;
  user?: User;
  token: string;
  version: number;
  message?: Message;
  appPermissions?: string;
  locale?: string;
  guildLocale?: string;
}

export enum InteractionType {
  PING = 1,
  APPLICATION_COMMAND = 2,
  MESSAGE_COMPONENT = 3,
  APPLICATION_COMMAND_AUTOCOMPLETE = 4,
  MODAL_SUBMIT = 5,
}

export interface InteractionData {
  id?: string;
  name?: string;
  type?: number;
  resolved?: ResolvedData;
  options?: ApplicationCommandInteractionDataOption[];
  guildId?: string;
  targetId?: string;
  customId?: string;
  componentType?: number;
  values?: string[];
  components?: MessageComponent[];
}

export interface ResolvedData {
  users?: Record<string, User>;
  members?: Record<string, Partial<Member>>;
  roles?: Record<string, Role>;
  channels?: Record<string, Partial<Channel>>;
  messages?: Record<string, Partial<Message>>;
}

export interface ApplicationCommandInteractionDataOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: ApplicationCommandInteractionDataOption[];
  focused?: boolean;
}

export interface MessageComponent {
  type: number;
  customId?: string;
  disabled?: boolean;
  style?: number;
  label?: string;
  emoji?: { id?: string; name?: string; animated?: boolean };
  url?: string;
  options?: SelectOption[];
  placeholder?: string;
  minValues?: number;
  maxValues?: number;
  components?: MessageComponent[];
  value?: string;
}

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  emoji?: { id?: string; name?: string; animated?: boolean };
  default?: boolean;
}

export interface InteractionCreatePayload extends Interaction {}

// ── Interaction Response ──
export enum InteractionResponseType {
  PONG = 1,
  CHANNEL_MESSAGE_WITH_SOURCE = 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE = 5,
  DEFERRED_UPDATE_MESSAGE = 6,
  UPDATE_MESSAGE = 7,
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT = 8,
  MODAL = 9,
  PREMIUM_REQUIRED = 10,
}

export interface InteractionResponse {
  type: InteractionResponseType;
  data?: InteractionCallbackData;
}

export interface InteractionCallbackData {
  tts?: boolean;
  content?: string;
  embeds?: any[];
  allowedMentions?: any;
  flags?: number;
  components?: MessageComponent[];
  attachments?: any[];
  choices?: ApplicationCommandOptionChoice[];
  customId?: string;
  title?: string;
}

export interface ApplicationCommandOptionChoice {
  name: string;
  nameLocalizations?: Record<string, string>;
  value: string | number;
}

// ── Soundboard ──
export interface SoundboardSound {
  id: string;
  guildId: string;
  name: string;
  volume: number;
  emojiId?: string;
  emojiName?: string;
  available: boolean;
  userId?: string;
}

export interface SoundboardSoundsUpdatePayload {
  guildId: string;
  sounds: SoundboardSound[];
}

export interface SoundboardSoundPlayPayload {
  guildId: string;
  channelId: string;
  soundId: string;
  userId: string;
  volume: number;
}

// ── Stickers ──
export interface Sticker {
  id: string;
  packId?: string;
  name: string;
  description?: string;
  tags: string;
  type: number;
  formatType: number;
  available?: boolean;
  guildId?: string;
  user?: User;
  sortValue?: number;
}

export interface GuildStickersUpdatePayload {
  guildId: string;
  stickers: Sticker[];
}

// ── AutoMod ──
export interface AutoModRule {
  id: string;
  guildId: string;
  name: string;
  creatorId: string;
  eventType: number;
  triggerType: number;
  triggerMetadata: AutoModTriggerMetadata;
  actions: AutoModAction[];
  enabled: boolean;
  exemptRoles: string[];
  exemptChannels: string[];
}

export interface AutoModTriggerMetadata {
  keywordFilter?: string[];
  regexPatterns?: string[];
  presets?: number[];
  allowList?: string[];
  mentionTotalLimit?: number;
  mentionRaidProtectionEnabled?: boolean;
}

export interface AutoModAction {
  type: number;
  metadata?: {
    channelId?: string;
    durationSeconds?: number;
    customMessage?: string;
  };
}

export interface AutoModRuleCreatePayload extends AutoModRule {}
export interface AutoModRuleUpdatePayload extends AutoModRule {}
export interface AutoModRuleDeletePayload {
  id: string;
  guildId: string;
}

export interface AutoModActionExecutionPayload {
  guildId: string;
  action: AutoModAction;
  ruleId: string;
  ruleTriggerType: number;
  userId: string;
  channelId?: string;
  messageId?: string;
  alertSystemMessageId?: string;
  content?: string;
  matchedKeyword?: string;
  matchedContent?: string;
}

// ── Voice Channel Effects ──
export interface VoiceChannelEffectSendPayload {
  channelId: string;
  guildId: string;
  userId: string;
  emoji?: { id?: string; name: string; animated?: boolean };
  animationType?: number;
  animationId?: number;
  soundId?: string;
  soundVolume?: number;
}

// ── Voice Spatial Update ──
export interface VoiceSpatialUpdateEventPayload {
  guildId: string;
  channelId: string;
  userId: string;
  position: { x: number; y: number; z: number };
}

// ── Scheduled Event Users ──
export interface GuildScheduledEventUserAddPayload {
  guildScheduledEventId: string;
  userId: string;
  guildId: string;
}

export interface GuildScheduledEventUserRemovePayload {
  guildScheduledEventId: string;
  userId: string;
  guildId: string;
}

// ── Channel Pins Update ──
export interface ChannelPinsUpdatePayload {
  guildId?: string;
  channelId: string;
  lastPinTimestamp?: string;
}

// ── Webhooks Update ──
export interface WebhooksUpdatePayload {
  guildId: string;
  channelId: string;
}

// ── Thread List Sync ──
export interface ThreadListSyncPayload {
  guildId: string;
  channelIds?: string[];
  threads: Channel[];
  members: ThreadMemberUpdatePayload[];
}

// ── Thread Members Update ──
export interface ThreadMembersUpdatePayload {
  id: string;
  guildId: string;
  memberCount: number;
  addedMembers?: Array<ThreadMemberUpdatePayload & { member?: Member }>;
  removedMemberIds?: string[];
}

// ── Guild Emojis Update ──
export interface GuildEmojisUpdatePayload {
  guildId: string;
  emojis: Array<{
    id: string;
    name: string;
    roles?: string[];
    user?: User;
    requireColons?: boolean;
    managed?: boolean;
    animated?: boolean;
    available?: boolean;
  }>;
}

// ── Message Reaction Remove Emoji ──
export interface MessageReactionRemoveEmojiPayload {
  channelId: string;
  guildId?: string;
  messageId: string;
  emoji: { id: string | null; name: string };
}
