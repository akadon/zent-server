import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockMessage } from '../helpers.js';

// ── Mocks ──

const mockWebhookRepository = {
  findById: vi.fn(),
  findByChannelId: vi.fn(),
  findByGuildId: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

const mockMessageRepository = {
  create: vi.fn(),
  updateLastMessageId: vi.fn(),
};

vi.mock('../../src/repositories/webhook.repository.js', () => ({
  webhookRepository: mockWebhookRepository,
}));
vi.mock('../../src/repositories/message.repository.js', () => ({
  messageRepository: mockMessageRepository,
}));
vi.mock('../../src/config/env.js', () => ({
  env: { AUTH_SECRET: 'test-secret-that-is-at-least-32-characters!!' },
}));
vi.mock('../../src/config/redis.js', () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
}));
vi.mock('@yxc/snowflake', () => ({
  generateSnowflake: vi.fn(() => 'webhook-snowflake-1'),
}));

const webhookService = await import('../../src/services/webhook.service.js');

describe('Webhook Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── createWebhook ──

  describe('createWebhook', () => {
    it('should create a webhook with generated token', async () => {
      mockWebhookRepository.create.mockImplementation(async (data: any) => ({
        ...data,
        createdAt: new Date(),
      }));

      const result = await webhookService.createWebhook(
        'guild-1', 'channel-1', 'creator-1', 'My Hook'
      );
      expect(mockWebhookRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'webhook-snowflake-1',
          guildId: 'guild-1',
          channelId: 'channel-1',
          creatorId: 'creator-1',
          name: 'My Hook',
          type: 1,
        })
      );
      // Token should be a base64url string
      const callArg = mockWebhookRepository.create.mock.calls[0]![0];
      expect(callArg.token).toBeDefined();
      expect(typeof callArg.token).toBe('string');
      expect(callArg.token.length).toBeGreaterThan(0);
    });

    it('should use default name when empty string provided', async () => {
      mockWebhookRepository.create.mockImplementation(async (data: any) => data);

      await webhookService.createWebhook('guild-1', 'channel-1', 'creator-1', '');
      const callArg = mockWebhookRepository.create.mock.calls[0]![0];
      expect(callArg.name).toBe('Captain Hook');
    });
  });

  // ── getWebhook ──

  describe('getWebhook', () => {
    it('should return webhook when found', async () => {
      const webhook = { id: 'wh-1', name: 'Test', channelId: 'ch-1' };
      mockWebhookRepository.findById.mockResolvedValue(webhook);

      const result = await webhookService.getWebhook('wh-1');
      expect(result).toEqual(webhook);
    });

    it('should throw 404 when webhook not found', async () => {
      mockWebhookRepository.findById.mockResolvedValue(null);

      await expect(webhookService.getWebhook('nonexistent')).rejects.toThrow('Webhook not found');
    });
  });

  // ── updateWebhook ──

  describe('updateWebhook', () => {
    it('should update webhook and return updated data', async () => {
      const updated = { id: 'wh-1', name: 'Updated Name' };
      mockWebhookRepository.update.mockResolvedValue(updated);

      const result = await webhookService.updateWebhook('wh-1', { name: 'Updated Name' });
      expect(result.name).toBe('Updated Name');
    });

    it('should throw 404 when webhook not found for update', async () => {
      mockWebhookRepository.update.mockResolvedValue(null);

      await expect(
        webhookService.updateWebhook('nonexistent', { name: 'X' })
      ).rejects.toThrow('Webhook not found');
    });
  });

  // ── deleteWebhook ──

  describe('deleteWebhook', () => {
    it('should delete existing webhook', async () => {
      mockWebhookRepository.findById.mockResolvedValue({ id: 'wh-1' });

      await webhookService.deleteWebhook('wh-1');
      expect(mockWebhookRepository.delete).toHaveBeenCalledWith('wh-1');
    });

    it('should throw 404 when deleting non-existent webhook', async () => {
      mockWebhookRepository.findById.mockResolvedValue(null);

      await expect(webhookService.deleteWebhook('nonexistent')).rejects.toThrow('Webhook not found');
    });
  });

  // ── executeWebhook ──

  describe('executeWebhook', () => {
    it('should execute webhook with valid token', async () => {
      const webhook = {
        id: 'wh-1',
        channelId: 'ch-1',
        name: 'Bot Hook',
        avatar: null,
        token: 'valid-token-abc123',
      };
      const message = createMockMessage({ id: 'webhook-snowflake-1', channelId: 'ch-1' });
      mockWebhookRepository.findById.mockResolvedValue(webhook);
      mockMessageRepository.create.mockResolvedValue(message);
      mockMessageRepository.updateLastMessageId.mockResolvedValue(undefined);

      const result = await webhookService.executeWebhook('wh-1', 'valid-token-abc123', 'Hello!');
      expect(result.channelId).toBe('ch-1');
      expect(result.author.bot).toBe(true);
      expect(result.author.username).toBe('Bot Hook');
    });

    it('should throw 404 when webhook not found', async () => {
      mockWebhookRepository.findById.mockResolvedValue(null);

      await expect(
        webhookService.executeWebhook('nonexistent', 'token', 'content')
      ).rejects.toThrow('Webhook not found or invalid token');
    });

    it('should throw 404 when webhook has null token', async () => {
      mockWebhookRepository.findById.mockResolvedValue({
        id: 'wh-1',
        token: null,
      });

      await expect(
        webhookService.executeWebhook('wh-1', 'token', 'content')
      ).rejects.toThrow('Webhook not found or invalid token');
    });

    it('should throw 404 when token does not match', async () => {
      mockWebhookRepository.findById.mockResolvedValue({
        id: 'wh-1',
        channelId: 'ch-1',
        token: 'correct-token-value',
        name: 'Hook',
        avatar: null,
      });

      await expect(
        webhookService.executeWebhook('wh-1', 'wrong-token-value', 'content')
      ).rejects.toThrow('Webhook not found or invalid token');
    });

    it('should use custom username and avatarUrl from options', async () => {
      const webhook = {
        id: 'wh-1',
        channelId: 'ch-1',
        name: 'Default Name',
        avatar: 'default-avatar',
        token: 'my-token',
      };
      const message = createMockMessage({ id: 'webhook-snowflake-1' });
      mockWebhookRepository.findById.mockResolvedValue(webhook);
      mockMessageRepository.create.mockResolvedValue(message);
      mockMessageRepository.updateLastMessageId.mockResolvedValue(undefined);

      const result = await webhookService.executeWebhook(
        'wh-1', 'my-token', 'Hello!',
        { username: 'Custom Bot', avatarUrl: 'https://example.com/avatar.png' }
      );
      expect(result.author.username).toBe('Custom Bot');
      expect(result.author.avatar).toBe('https://example.com/avatar.png');
    });
  });
});
