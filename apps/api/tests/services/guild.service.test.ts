import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockGuild, createMockChannel } from '../helpers.js';

// ── Mocks ──

const mockGuildRepository = {
  findById: vi.fn(),
  findOwnerById: vi.fn(),
  findByIds: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getMemberCount: vi.fn(),
  transaction: vi.fn(),
};

const mockChannelRepository = {
  findByGuildId: vi.fn(),
  findByGuildIds: vi.fn(),
  createMany: vi.fn(),
};

const mockMemberRepository = {
  findGuildIdsByUserId: vi.fn(),
  findByGuildIds: vi.fn(),
  findByUserAndGuild: vi.fn(),
  findBan: vi.fn(),
  exists: vi.fn(),
  createInTx: vi.fn(),
};

const mockRoleRepository = {
  findByGuildId: vi.fn(),
  findByGuildIds: vi.fn(),
  createInTx: vi.fn(),
};

vi.mock('../../src/repositories/guild.repository.js', () => ({
  guildRepository: mockGuildRepository,
}));
vi.mock('../../src/repositories/channel.repository.js', () => ({
  channelRepository: mockChannelRepository,
}));
vi.mock('../../src/repositories/member.repository.js', () => ({
  memberRepository: mockMemberRepository,
}));
vi.mock('../../src/repositories/role.repository.js', () => ({
  roleRepository: mockRoleRepository,
}));
vi.mock('../../src/services/permission.service.js', () => ({
  invalidateGuildPermissions: vi.fn(),
}));
vi.mock('../../src/config/env.js', () => ({
  env: { VOICE_SERVICE_URL: '', VOICE_INTERNAL_KEY: '' },
}));
vi.mock('../../src/config/redis.js', () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
}));
vi.mock('@yxc/snowflake', () => ({
  generateSnowflake: vi.fn()
    .mockReturnValueOnce('guild-id-1')
    .mockReturnValueOnce('channel-general-1')
    .mockReturnValueOnce('channel-voice-1')
    .mockReturnValue('snowflake-default'),
}));
vi.mock('@yxc/permissions', () => ({
  DEFAULT_PERMISSIONS: BigInt(0x6546),
}));
vi.mock('@yxc/types', () => ({
  ChannelType: { GUILD_TEXT: 0, GUILD_VOICE: 2 },
}));

const guildService = await import('../../src/services/guild.service.js');

describe('Guild Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── createGuild ──

  describe('createGuild', () => {
    it('should create guild with default channels and add owner as member', async () => {
      const guild = createMockGuild({ id: 'guild-id-1' });
      // transaction mock: execute the callback immediately
      mockGuildRepository.transaction.mockImplementation(async (cb: any) => {
        await cb({});
      });
      // After creation, getGuild is called:
      mockGuildRepository.findById.mockResolvedValue(guild);
      mockChannelRepository.findByGuildId.mockResolvedValue([createMockChannel()]);
      mockRoleRepository.findByGuildId.mockResolvedValue([]);
      mockGuildRepository.getMemberCount.mockResolvedValue(1);

      const result = await guildService.createGuild('owner-1', 'My Guild');
      expect(result).toBeDefined();
      expect(mockGuildRepository.transaction).toHaveBeenCalled();
    });

    it('should create guild with custom icon when provided', async () => {
      const guild = createMockGuild({ id: 'guild-id-1', icon: 'custom-icon.png' });
      mockGuildRepository.transaction.mockImplementation(async (cb: any) => {
        await cb({});
      });
      mockGuildRepository.findById.mockResolvedValue(guild);
      mockChannelRepository.findByGuildId.mockResolvedValue([]);
      mockRoleRepository.findByGuildId.mockResolvedValue([]);
      mockGuildRepository.getMemberCount.mockResolvedValue(1);

      const result = await guildService.createGuild('owner-1', 'My Guild', 'custom-icon.png');
      expect(result).toBeDefined();
    });
  });

  // ── getGuild ──

  describe('getGuild', () => {
    it('should return guild with channels, roles, and memberCount', async () => {
      const guild = createMockGuild();
      const channel = createMockChannel();
      mockGuildRepository.findById.mockResolvedValue(guild);
      mockChannelRepository.findByGuildId.mockResolvedValue([channel]);
      mockRoleRepository.findByGuildId.mockResolvedValue([]);
      mockGuildRepository.getMemberCount.mockResolvedValue(5);

      const result = await guildService.getGuild('200000000000000001');
      expect(result).toBeDefined();
      expect(result!.channels).toHaveLength(1);
      expect(result!.memberCount).toBe(5);
      expect(result!.createdAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('should return null when guild not found', async () => {
      mockGuildRepository.findById.mockResolvedValue(null);

      const result = await guildService.getGuild('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ── deleteGuild ──

  describe('deleteGuild', () => {
    it('should delete guild when called by owner', async () => {
      mockGuildRepository.findOwnerById.mockResolvedValue(
        createMockGuild({ ownerId: 'owner-1' })
      );

      await guildService.deleteGuild('guild-1', 'owner-1');
      expect(mockGuildRepository.delete).toHaveBeenCalledWith('guild-1');
    });

    it('should throw 403 when non-owner tries to delete', async () => {
      mockGuildRepository.findOwnerById.mockResolvedValue(
        createMockGuild({ ownerId: 'owner-1' })
      );

      await expect(
        guildService.deleteGuild('guild-1', 'not-owner')
      ).rejects.toThrow('Only the owner can delete a guild');

      try {
        await guildService.deleteGuild('guild-1', 'not-owner');
      } catch (err: any) {
        expect(err.statusCode).toBe(403);
      }
    });

    it('should throw 404 when guild not found', async () => {
      mockGuildRepository.findOwnerById.mockResolvedValue(null);

      await expect(
        guildService.deleteGuild('nonexistent', 'owner-1')
      ).rejects.toThrow('Guild not found');
    });
  });

  // ── updateGuild ──

  describe('updateGuild', () => {
    it('should update guild and return serialized result', async () => {
      const guild = createMockGuild();
      const updatedGuild = { ...guild, name: 'Updated Name' };
      mockGuildRepository.findOwnerById.mockResolvedValue(guild);
      mockGuildRepository.update.mockResolvedValue(updatedGuild);

      const result = await guildService.updateGuild('guild-1', 'owner-1', { name: 'Updated Name' });
      expect(result.name).toBe('Updated Name');
      expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('should throw 404 when guild not found for update', async () => {
      mockGuildRepository.findOwnerById.mockResolvedValue(null);

      await expect(
        guildService.updateGuild('nonexistent', 'owner-1', { name: 'X' })
      ).rejects.toThrow('Guild not found');
    });
  });

  // ── isMember ──

  describe('isMember', () => {
    it('should return true when user is a member', async () => {
      mockMemberRepository.exists.mockResolvedValue(true);
      const result = await guildService.isMember('user-1', 'guild-1');
      expect(result).toBe(true);
    });

    it('should return false when user is not a member', async () => {
      mockMemberRepository.exists.mockResolvedValue(false);
      const result = await guildService.isMember('user-1', 'guild-1');
      expect(result).toBe(false);
    });
  });

  // ── transferOwnership ──

  describe('transferOwnership', () => {
    it('should transfer ownership to new user', async () => {
      const guild = createMockGuild({ ownerId: 'owner-1' });
      const updatedGuild = { ...guild, ownerId: 'new-owner' };
      mockGuildRepository.findOwnerById.mockResolvedValue(guild);
      mockGuildRepository.update.mockResolvedValue(updatedGuild);

      const result = await guildService.transferOwnership('guild-1', 'owner-1', 'new-owner');
      expect(result.ownerId).toBe('new-owner');
    });

    it('should throw 403 when non-owner tries to transfer', async () => {
      mockGuildRepository.findOwnerById.mockResolvedValue(
        createMockGuild({ ownerId: 'owner-1' })
      );

      await expect(
        guildService.transferOwnership('guild-1', 'imposter', 'new-owner')
      ).rejects.toThrow('Only the owner can transfer ownership');
    });
  });
});
