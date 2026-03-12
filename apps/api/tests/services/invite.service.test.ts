import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──

const mockInviteRepository = {
  findByCode: vi.fn(),
  findByGuildId: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  incrementUsesInTx: vi.fn(),
  transaction: vi.fn(),
};

const mockMemberRepository = {
  findByUserAndGuild: vi.fn(),
  findBan: vi.fn(),
  createInTx: vi.fn(),
};

vi.mock('../../src/repositories/invite.repository.js', () => ({
  inviteRepository: mockInviteRepository,
}));
vi.mock('../../src/repositories/member.repository.js', () => ({
  memberRepository: mockMemberRepository,
}));
vi.mock('../../src/config/env.js', () => ({
  env: { AUTH_SECRET: 'test-secret-that-is-at-least-32-characters!!' },
}));
vi.mock('../../src/config/redis.js', () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
}));

const inviteService = await import('../../src/services/invite.service.js');

function createMockInvite(overrides: Record<string, any> = {}) {
  return {
    code: 'abc123',
    guildId: 'guild-1',
    channelId: 'ch-1',
    inviterId: 'user-1',
    maxAge: 86400,
    maxUses: 0,
    uses: 0,
    temporary: false,
    expiresAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('Invite Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── createInvite ──

  describe('createInvite', () => {
    it('should create invite with generated code and default options', async () => {
      mockInviteRepository.create.mockImplementation(async (data: any) => data);

      const result = await inviteService.createInvite('guild-1', 'ch-1', 'user-1');
      expect(mockInviteRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: 'guild-1',
          channelId: 'ch-1',
          inviterId: 'user-1',
          maxAge: 86400,
          maxUses: 0,
          temporary: false,
        })
      );
      const callArg = mockInviteRepository.create.mock.calls[0]![0];
      expect(callArg.code).toBeDefined();
      expect(typeof callArg.code).toBe('string');
      expect(callArg.expiresAt).toBeInstanceOf(Date);
    });

    it('should set expiresAt to null when maxAge is 0', async () => {
      mockInviteRepository.create.mockImplementation(async (data: any) => data);

      await inviteService.createInvite('guild-1', 'ch-1', 'user-1', { maxAge: 0 });
      const callArg = mockInviteRepository.create.mock.calls[0]![0];
      expect(callArg.expiresAt).toBeNull();
    });

    it('should pass custom maxUses and temporary', async () => {
      mockInviteRepository.create.mockImplementation(async (data: any) => data);

      await inviteService.createInvite('guild-1', 'ch-1', 'user-1', {
        maxUses: 10,
        temporary: true,
      });
      const callArg = mockInviteRepository.create.mock.calls[0]![0];
      expect(callArg.maxUses).toBe(10);
      expect(callArg.temporary).toBe(true);
    });
  });

  // ── getInvite ──

  describe('getInvite', () => {
    it('should return valid invite', async () => {
      mockInviteRepository.findByCode.mockResolvedValue(createMockInvite());

      const result = await inviteService.getInvite('abc123');
      expect(result.code).toBe('abc123');
      expect(result.guildId).toBe('guild-1');
    });

    it('should throw 404 when invite not found', async () => {
      mockInviteRepository.findByCode.mockResolvedValue(null);

      await expect(inviteService.getInvite('nonexistent')).rejects.toThrow(
        'Invite not found or expired'
      );
    });

    it('should throw 404 and delete when invite is expired', async () => {
      const expired = createMockInvite({
        expiresAt: new Date('2020-01-01T00:00:00Z'),
      });
      mockInviteRepository.findByCode.mockResolvedValue(expired);

      await expect(inviteService.getInvite('abc123')).rejects.toThrow('Invite expired');
      expect(mockInviteRepository.delete).toHaveBeenCalledWith('abc123');
    });

    it('should throw 404 and delete when max uses reached', async () => {
      const maxedOut = createMockInvite({
        maxUses: 5,
        uses: 5,
      });
      mockInviteRepository.findByCode.mockResolvedValue(maxedOut);

      await expect(inviteService.getInvite('abc123')).rejects.toThrow('Invite max uses reached');
      expect(mockInviteRepository.delete).toHaveBeenCalledWith('abc123');
    });
  });

  // ── useInvite ──

  describe('useInvite', () => {
    it('should add member and increment uses for valid invite', async () => {
      mockInviteRepository.findByCode.mockResolvedValue(createMockInvite());
      mockMemberRepository.findByUserAndGuild.mockResolvedValue(null);
      mockMemberRepository.findBan.mockResolvedValue(null);
      mockInviteRepository.transaction.mockImplementation(async (cb: any) => cb({}));

      const result = await inviteService.useInvite('abc123', 'new-user');
      expect(result.guildId).toBe('guild-1');
      expect(result.alreadyMember).toBe(false);
    });

    it('should return alreadyMember=true if user is already a member', async () => {
      mockInviteRepository.findByCode.mockResolvedValue(createMockInvite());
      mockMemberRepository.findByUserAndGuild.mockResolvedValue({ userId: 'user-1', guildId: 'guild-1' });

      const result = await inviteService.useInvite('abc123', 'user-1');
      expect(result.alreadyMember).toBe(true);
    });

    it('should throw 403 when user is banned', async () => {
      mockInviteRepository.findByCode.mockResolvedValue(createMockInvite());
      mockMemberRepository.findByUserAndGuild.mockResolvedValue(null);
      mockMemberRepository.findBan.mockResolvedValue({ userId: 'banned-user', guildId: 'guild-1' });

      await expect(
        inviteService.useInvite('abc123', 'banned-user')
      ).rejects.toThrow('You are banned from this guild');
    });
  });

  // ── deleteInvite ──

  describe('deleteInvite', () => {
    it('should delete existing invite', async () => {
      mockInviteRepository.findByCode.mockResolvedValue(createMockInvite());

      await inviteService.deleteInvite('abc123');
      expect(mockInviteRepository.delete).toHaveBeenCalledWith('abc123');
    });

    it('should throw 404 when deleting non-existent invite', async () => {
      mockInviteRepository.findByCode.mockResolvedValue(null);

      await expect(inviteService.deleteInvite('nonexistent')).rejects.toThrow('Invite not found');
    });
  });
});
