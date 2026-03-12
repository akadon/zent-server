import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockReply } from '../helpers.js';

// ── Mocks ──

const mockRedisEval = vi.fn();

vi.mock('../../src/config/redis.js', () => ({
  redis: {
    eval: mockRedisEval,
  },
}));
vi.mock('../../src/services/auth.service.js', () => ({
  ApiError: class ApiError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
      this.name = 'ApiError';
    }
  },
}));

const { createRateLimiter, globalRateLimit } = await import('../../src/middleware/rateLimit.js');

describe('Rate Limit Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createRateLimiter', () => {
    it('should allow request when under limit', async () => {
      // Redis eval returns [allowed=1, remaining=4, oldest_time=0]
      mockRedisEval.mockResolvedValue([1, 4, 0]);

      const limiter = createRateLimiter('auth');
      const request = createMockRequest({ ip: '1.2.3.4' }) as any;
      const reply = createMockReply();

      await limiter(request, reply);
      // Should not throw
      expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Limit', 5); // auth max=5
      expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Remaining', 4);
    });

    it('should throw 429 when rate limit exceeded', async () => {
      // Redis eval returns [allowed=0, remaining=0, oldest_time=now-10000]
      const now = Date.now();
      mockRedisEval.mockResolvedValue([0, 0, now - 10000]);

      const limiter = createRateLimiter('auth');
      const request = createMockRequest({ ip: '1.2.3.4' }) as any;
      const reply = createMockReply();

      await expect(limiter(request, reply)).rejects.toThrow('You are being rate limited');
    });

    it('should set Retry-After header when rate limited', async () => {
      const now = Date.now();
      mockRedisEval.mockResolvedValue([0, 0, now - 10000]);

      const limiter = createRateLimiter('auth');
      const request = createMockRequest({ ip: '1.2.3.4' }) as any;
      const reply = createMockReply();

      try {
        await limiter(request, reply);
      } catch {
        // expected to throw
      }

      expect(reply.header).toHaveBeenCalledWith('Retry-After', expect.any(Number));
    });

    it('should use userId as identifier when available', async () => {
      mockRedisEval.mockResolvedValue([1, 49, 0]);

      const limiter = createRateLimiter('global');
      const request = createMockRequest({
        ip: '1.2.3.4',
        userId: 'user-authenticated',
      }) as any;
      const reply = createMockReply();

      await limiter(request, reply);
      // The key should contain the userId, not the IP
      const evalCall = mockRedisEval.mock.calls[0]!;
      const key = evalCall[2]; // KEYS[1]
      expect(key).toContain('user-authenticated');
    });

    it('should use IP as identifier for unauthenticated requests', async () => {
      mockRedisEval.mockResolvedValue([1, 49, 0]);

      const limiter = createRateLimiter('global');
      const request = createMockRequest({ ip: '10.20.30.40' }) as any;
      const reply = createMockReply();

      await limiter(request, reply);
      const evalCall = mockRedisEval.mock.calls[0]!;
      const key = evalCall[2]; // KEYS[1]
      expect(key).toContain('10.20.30.40');
    });

    it('should use custom identifier function when provided', async () => {
      mockRedisEval.mockResolvedValue([1, 4, 0]);

      const limiter = createRateLimiter('auth', () => 'custom-key-123');
      const request = createMockRequest({ ip: '1.2.3.4' }) as any;
      const reply = createMockReply();

      await limiter(request, reply);
      const evalCall = mockRedisEval.mock.calls[0]!;
      const key = evalCall[2];
      expect(key).toContain('custom-key-123');
    });
  });

  describe('globalRateLimit', () => {
    it('should allow request under global limit', async () => {
      mockRedisEval.mockResolvedValue([1, 49, 0]);

      const request = createMockRequest({ ip: '5.6.7.8' }) as any;
      const reply = createMockReply();

      await globalRateLimit(request, reply);
      expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Limit', 50); // global max=50
    });

    it('should throw 429 for global rate limit exceeded', async () => {
      const now = Date.now();
      mockRedisEval.mockResolvedValue([0, 0, now - 500]);

      const request = createMockRequest({ ip: '5.6.7.8' }) as any;
      const reply = createMockReply();

      await expect(globalRateLimit(request, reply)).rejects.toThrow('You are being rate limited');
    });
  });
});
