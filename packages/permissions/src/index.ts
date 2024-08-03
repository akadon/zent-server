export const PermissionFlags = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  PRIORITY_SPEAKER: 1n << 8n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  SEND_TTS_MESSAGES: 1n << 12n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  VIEW_GUILD_INSIGHTS: 1n << 19n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  USE_VAD: 1n << 25n,
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_EMOJIS_AND_STICKERS: 1n << 30n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  REQUEST_TO_SPEAK: 1n << 32n,
  MANAGE_EVENTS: 1n << 33n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  USE_EXTERNAL_STICKERS: 1n << 37n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  USE_EMBEDDED_ACTIVITIES: 1n << 39n,
  MODERATE_MEMBERS: 1n << 40n,
  // New permissions (Discord Aug 2025+)
  VIEW_CREATOR_MONETIZATION_ANALYTICS: 1n << 41n,
  USE_SOUNDBOARD: 1n << 42n,
  CREATE_GUILD_EXPRESSIONS: 1n << 43n,
  CREATE_EVENTS: 1n << 44n,
  USE_EXTERNAL_SOUNDS: 1n << 45n,
  SEND_VOICE_MESSAGES: 1n << 46n,
  // PIN_MESSAGES separated from MANAGE_MESSAGES (Aug 2025)
  PIN_MESSAGES: 1n << 47n,
  // Stage channel permissions
  STAGE_MODERATOR: 1n << 48n,
  // AutoMod permissions
  MANAGE_AUTOMOD: 1n << 49n,
  VIEW_AUTOMOD_REPORTS: 1n << 50n,
} as const;

export type PermissionFlag = keyof typeof PermissionFlags;

const ALL_PERMISSIONS = Object.values(PermissionFlags).reduce((acc, val) => acc | val, 0n);

export class PermissionsBitfield {
  private bitfield: bigint;

  constructor(bits: bigint | string | number = 0n) {
    this.bitfield = BigInt(bits);
  }

  has(permission: bigint): boolean {
    if ((this.bitfield & PermissionFlags.ADMINISTRATOR) === PermissionFlags.ADMINISTRATOR) {
      return true;
    }
    return (this.bitfield & permission) === permission;
  }

  hasAny(...permissions: bigint[]): boolean {
    return permissions.some((p) => this.has(p));
  }

  hasAll(...permissions: bigint[]): boolean {
    return permissions.every((p) => this.has(p));
  }

  add(...permissions: bigint[]): PermissionsBitfield {
    let bits = this.bitfield;
    for (const p of permissions) bits |= p;
    return new PermissionsBitfield(bits);
  }

  remove(...permissions: bigint[]): PermissionsBitfield {
    let bits = this.bitfield;
    for (const p of permissions) bits &= ~p;
    return new PermissionsBitfield(bits);
  }

  toBigInt(): bigint {
    return this.bitfield;
  }

  toString(): string {
    return this.bitfield.toString();
  }

  toJSON(): string {
    return this.bitfield.toString();
  }

  static all(): PermissionsBitfield {
    return new PermissionsBitfield(ALL_PERMISSIONS);
  }

  static none(): PermissionsBitfield {
    return new PermissionsBitfield(0n);
  }
}

export interface PermissionOverwrite {
  id: string;
  type: 0 | 1; // 0 = role, 1 = member
  allow: bigint;
  deny: bigint;
}

export interface RolePermission {
  id: string;
  permissions: bigint;
  position: number;
}

/**
 * Compute final permissions for a member in a guild channel.
 *
 * Algorithm:
 * 1. Owner? -> ALL
 * 2. base = @everyone.permissions | OR(member role permissions)
 * 3. ADMINISTRATOR in base? -> ALL
 * 4. Apply channel overwrites:
 *    a. @everyone overwrite
 *    b. All role overwrites OR'd
 *    c. Member-specific overwrite
 * 5. If no VIEW_CHANNEL -> deny all
 */
export function computePermissions(params: {
  userId: string;
  guildOwnerId: string;
  everyoneRole: RolePermission;
  memberRoles: RolePermission[];
  channelOverwrites?: PermissionOverwrite[];
}): PermissionsBitfield {
  const { userId, guildOwnerId, everyoneRole, memberRoles, channelOverwrites } = params;

  // Owner gets everything
  if (userId === guildOwnerId) {
    return PermissionsBitfield.all();
  }

  // Base permissions: @everyone | all member roles
  let base = everyoneRole.permissions;
  for (const role of memberRoles) {
    base |= role.permissions;
  }

  // Administrator shortcut
  if ((base & PermissionFlags.ADMINISTRATOR) === PermissionFlags.ADMINISTRATOR) {
    return PermissionsBitfield.all();
  }

  // No channel overwrites? Return base
  if (!channelOverwrites || channelOverwrites.length === 0) {
    return new PermissionsBitfield(base);
  }

  // Apply @everyone channel overwrite
  const everyoneOverwrite = channelOverwrites.find((o) => o.id === everyoneRole.id);
  if (everyoneOverwrite) {
    base &= ~everyoneOverwrite.deny;
    base |= everyoneOverwrite.allow;
  }

  // Apply role overwrites (OR all together, then apply)
  const memberRoleIds = new Set(memberRoles.map((r) => r.id));
  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const overwrite of channelOverwrites) {
    if (overwrite.type === 0 && memberRoleIds.has(overwrite.id)) {
      roleAllow |= overwrite.allow;
      roleDeny |= overwrite.deny;
    }
  }
  base &= ~roleDeny;
  base |= roleAllow;

  // Apply member-specific overwrite
  const memberOverwrite = channelOverwrites.find(
    (o) => o.type === 1 && o.id === userId
  );
  if (memberOverwrite) {
    base &= ~memberOverwrite.deny;
    base |= memberOverwrite.allow;
  }

  // Implicit denial: no VIEW_CHANNEL -> no channel permissions
  if ((base & PermissionFlags.VIEW_CHANNEL) === 0n) {
    return PermissionsBitfield.none();
  }

  return new PermissionsBitfield(base);
}

// Default permissions for @everyone in a new guild
export const DEFAULT_PERMISSIONS =
  PermissionFlags.CREATE_INSTANT_INVITE |
  PermissionFlags.ADD_REACTIONS |
  PermissionFlags.STREAM |
  PermissionFlags.VIEW_CHANNEL |
  PermissionFlags.SEND_MESSAGES |
  PermissionFlags.EMBED_LINKS |
  PermissionFlags.ATTACH_FILES |
  PermissionFlags.READ_MESSAGE_HISTORY |
  PermissionFlags.MENTION_EVERYONE |
  PermissionFlags.USE_EXTERNAL_EMOJIS |
  PermissionFlags.CONNECT |
  PermissionFlags.SPEAK |
  PermissionFlags.USE_VAD |
  PermissionFlags.CHANGE_NICKNAME |
  PermissionFlags.USE_APPLICATION_COMMANDS |
  PermissionFlags.CREATE_PUBLIC_THREADS |
  PermissionFlags.CREATE_PRIVATE_THREADS |
  PermissionFlags.USE_EXTERNAL_STICKERS |
  PermissionFlags.SEND_MESSAGES_IN_THREADS |
  PermissionFlags.USE_SOUNDBOARD |
  PermissionFlags.USE_EXTERNAL_SOUNDS |
  PermissionFlags.SEND_VOICE_MESSAGES |
  PermissionFlags.REQUEST_TO_SPEAK |
  PermissionFlags.USE_EMBEDDED_ACTIVITIES;

// Gateway Intents for selective event subscription
export const GatewayIntents = {
  GUILDS: 1 << 0,
  GUILD_MEMBERS: 1 << 1, // Privileged
  GUILD_MODERATION: 1 << 2,
  GUILD_EMOJIS_AND_STICKERS: 1 << 3,
  GUILD_INTEGRATIONS: 1 << 4,
  GUILD_WEBHOOKS: 1 << 5,
  GUILD_INVITES: 1 << 6,
  GUILD_VOICE_STATES: 1 << 7,
  GUILD_PRESENCES: 1 << 8, // Privileged
  GUILD_MESSAGES: 1 << 9,
  GUILD_MESSAGE_REACTIONS: 1 << 10,
  GUILD_MESSAGE_TYPING: 1 << 11,
  DIRECT_MESSAGES: 1 << 12,
  DIRECT_MESSAGE_REACTIONS: 1 << 13,
  DIRECT_MESSAGE_TYPING: 1 << 14,
  MESSAGE_CONTENT: 1 << 15, // Privileged
  GUILD_SCHEDULED_EVENTS: 1 << 16,
  AUTO_MODERATION_CONFIGURATION: 1 << 20,
  AUTO_MODERATION_EXECUTION: 1 << 21,
  GUILD_MESSAGE_POLLS: 1 << 24,
  DIRECT_MESSAGE_POLLS: 1 << 25,
} as const;

// All non-privileged intents
export const DEFAULT_INTENTS =
  GatewayIntents.GUILDS |
  GatewayIntents.GUILD_MODERATION |
  GatewayIntents.GUILD_EMOJIS_AND_STICKERS |
  GatewayIntents.GUILD_INTEGRATIONS |
  GatewayIntents.GUILD_WEBHOOKS |
  GatewayIntents.GUILD_INVITES |
  GatewayIntents.GUILD_VOICE_STATES |
  GatewayIntents.GUILD_MESSAGES |
  GatewayIntents.GUILD_MESSAGE_REACTIONS |
  GatewayIntents.GUILD_MESSAGE_TYPING |
  GatewayIntents.DIRECT_MESSAGES |
  GatewayIntents.DIRECT_MESSAGE_REACTIONS |
  GatewayIntents.DIRECT_MESSAGE_TYPING |
  GatewayIntents.GUILD_SCHEDULED_EVENTS |
  GatewayIntents.AUTO_MODERATION_CONFIGURATION |
  GatewayIntents.AUTO_MODERATION_EXECUTION;

// Privileged intents that require approval
export const PRIVILEGED_INTENTS =
  GatewayIntents.GUILD_MEMBERS |
  GatewayIntents.GUILD_PRESENCES |
  GatewayIntents.MESSAGE_CONTENT;
