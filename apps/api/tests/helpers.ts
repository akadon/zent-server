import { vi } from 'vitest';

// ── Mock User Data ──

export function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: '100000000000000001',
    username: 'testuser',
    displayName: null,
    email: 'test@example.com',
    avatar: null,
    banner: null,
    bio: null,
    status: 'offline',
    customStatus: null,
    mfaEnabled: false,
    mfaSecret: null,
    mfaBackupCodes: null,
    verified: false,
    flags: 0,
    premiumType: 0,
    locale: 'en-US',
    isGuest: false,
    guestExpiresAt: null,
    passwordHash: '$2b$12$hashedpassword',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export interface MockUser {
  id: string;
  username: string;
  displayName: string | null;
  email: string;
  avatar: string | null;
  banner: string | null;
  bio: string | null;
  status: string;
  customStatus: string | null;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  mfaBackupCodes: string | null;
  verified: boolean;
  flags: number;
  premiumType: number;
  locale: string;
  isGuest: boolean;
  guestExpiresAt: Date | null;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── Mock Guild Data ──

export function createMockGuild(overrides: Record<string, any> = {}) {
  return {
    id: '200000000000000001',
    name: 'Test Guild',
    icon: null,
    banner: null,
    description: null,
    ownerId: '100000000000000001',
    systemChannelId: '300000000000000001',
    rulesChannelId: null,
    verificationLevel: 0,
    defaultMessageNotifications: 0,
    explicitContentFilter: 0,
    memberCount: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ── Mock Channel Data ──

export function createMockChannel(overrides: Record<string, any> = {}) {
  return {
    id: '300000000000000001',
    guildId: '200000000000000001',
    type: 0, // GUILD_TEXT
    name: 'general',
    topic: null,
    position: 0,
    nsfw: false,
    rateLimitPerUser: 0,
    parentId: null,
    lastMessageId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ── Mock Message Data ──

export function createMockMessage(overrides: Record<string, any> = {}) {
  return {
    id: '400000000000000001',
    channelId: '300000000000000001',
    authorId: '100000000000000001',
    content: 'Hello, world!',
    type: 0,
    tts: false,
    pinned: false,
    mentionEveryone: false,
    webhookId: null,
    editedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ── Mock Redis ──

export function createMockRedis() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ...args: any[]) => {
      store.set(key, value);
      return 'OK';
    }),
    setex: vi.fn(async (key: string, ttl: number, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    incr: vi.fn(async (key: string) => {
      const val = parseInt(store.get(key) ?? '0', 10) + 1;
      store.set(key, val.toString());
      return val;
    }),
    eval: vi.fn(),
    _store: store,
  };
}

// ── Mock Fastify Request/Reply ──

export function createMockRequest(overrides: Record<string, any> = {}) {
  return {
    headers: {},
    body: {},
    params: {},
    query: {},
    ip: '127.0.0.1',
    userId: undefined as string | undefined,
    ...overrides,
  };
}

export function createMockReply() {
  const reply: any = {
    statusCode: 200,
    _headers: {} as Record<string, any>,
    status: vi.fn(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    send: vi.fn(function (this: any, data: any) {
      this._data = data;
      return this;
    }),
    header: vi.fn(function (this: any, name: string, value: any) {
      this._headers[name] = value;
      return this;
    }),
  };
  return reply;
}
