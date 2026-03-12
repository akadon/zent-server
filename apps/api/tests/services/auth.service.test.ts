import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockUser, createMockRedis } from '../helpers.js';

// ── Mocks ──

const mockRedis = createMockRedis();
vi.mock('../../src/config/redis.js', () => ({ redis: mockRedis }));

vi.mock('../../src/config/env.js', () => ({
  env: {
    AUTH_SECRET: 'a-very-secret-key-that-is-at-least-32-chars-long!!',
    DATABASE_URL: 'mysql://localhost:3306/test',
    REDIS_URL: 'redis://localhost:6379',
  },
}));

const mockUserRepository = {
  findById: vi.fn(),
  findByEmail: vi.fn(),
  findByUsername: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
};
vi.mock('../../src/repositories/user.repository.js', () => ({
  userRepository: mockUserRepository,
}));

vi.mock('@yxc/snowflake', () => ({
  generateSnowflake: vi.fn(() => '999000000000000001'),
}));

// Import after mocks
const authService = await import('../../src/services/auth.service.js');

describe('Auth Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis._store.clear();
  });

  // ── hashPassword / verifyPassword ──

  describe('hashPassword', () => {
    it('should return a bcrypt hash string', async () => {
      const hash = await authService.hashPassword('MyPassword123');
      expect(hash).toBeDefined();
      expect(hash).not.toBe('MyPassword123');
      expect(hash.startsWith('$2b$') || hash.startsWith('$2a$')).toBe(true);
    });

    it('should produce different hashes for the same input (salted)', async () => {
      const hash1 = await authService.hashPassword('MyPassword123');
      const hash2 = await authService.hashPassword('MyPassword123');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyPassword', () => {
    it('should return true for correct password', async () => {
      const hash = await authService.hashPassword('MyPassword123');
      const result = await authService.verifyPassword('MyPassword123', hash);
      expect(result).toBe(true);
    });

    it('should return false for wrong password', async () => {
      const hash = await authService.hashPassword('MyPassword123');
      const result = await authService.verifyPassword('WrongPassword', hash);
      expect(result).toBe(false);
    });
  });

  // ── generateToken / verifyToken ──

  describe('generateToken', () => {
    it('should return a JWT string', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      const token = await authService.generateToken('user123');
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should include userId and tokenVersion in payload', async () => {
      mockRedis.get.mockResolvedValueOnce('3');
      const token = await authService.generateToken('user123');

      const jwt = await import('jsonwebtoken');
      const payload = jwt.default.decode(token) as any;
      expect(payload.userId).toBe('user123');
      expect(payload.tokenVersion).toBe(3);
    });

    it('should default tokenVersion to 0 when no version stored', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      const token = await authService.generateToken('user123');

      const jwt = await import('jsonwebtoken');
      const payload = jwt.default.decode(token) as any;
      expect(payload.tokenVersion).toBe(0);
    });
  });

  describe('verifyToken', () => {
    it('should return payload for valid token', async () => {
      // Generate a valid token
      mockRedis.get.mockResolvedValueOnce(null); // for generateToken
      const token = await authService.generateToken('user456');

      // verifyToken checks: revoked token, then token version
      mockRedis.get.mockResolvedValueOnce(null); // not revoked
      mockRedis.get.mockResolvedValueOnce(null); // version matches (0)

      const payload = await authService.verifyToken(token);
      expect(payload.userId).toBe('user456');
    });

    it('should throw when token is revoked', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      const token = await authService.generateToken('user456');

      mockRedis.get.mockResolvedValueOnce('1'); // token is revoked

      await expect(authService.verifyToken(token)).rejects.toThrow('Token has been revoked');
    });

    it('should throw when token version is outdated', async () => {
      mockRedis.get.mockResolvedValueOnce('0'); // generate with version 0
      const token = await authService.generateToken('user456');

      mockRedis.get.mockResolvedValueOnce(null); // not individually revoked
      mockRedis.get.mockResolvedValueOnce('5'); // current version is 5, token has 0

      await expect(authService.verifyToken(token)).rejects.toThrow('Token has been revoked');
    });

    it('should throw for expired token', async () => {
      const jwt = await import('jsonwebtoken');
      const expiredToken = jwt.default.sign(
        { userId: 'user1', tokenVersion: 0 },
        'a-very-secret-key-that-is-at-least-32-chars-long!!',
        { expiresIn: '-1s' }
      );

      await expect(authService.verifyToken(expiredToken)).rejects.toThrow();
    });
  });

  // ── revokeToken ──

  describe('revokeToken', () => {
    it('should store revoked token in Redis with TTL', async () => {
      const jwt = await import('jsonwebtoken');
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const token = jwt.default.sign(
        { userId: 'user1', exp: futureExp },
        'a-very-secret-key-that-is-at-least-32-chars-long!!'
      );

      await authService.revokeToken(token);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `token:revoked:${token}`,
        expect.any(Number),
        '1'
      );
    });

    it('should not store if token is already expired', async () => {
      const jwt = await import('jsonwebtoken');
      const pastExp = Math.floor(Date.now() / 1000) - 3600;
      // Manually craft a token payload with past expiry (skip verify)
      const token = jwt.default.sign(
        { userId: 'user1', exp: pastExp },
        'a-very-secret-key-that-is-at-least-32-chars-long!!',
        { noTimestamp: true }
      );

      await authService.revokeToken(token);
      expect(mockRedis.setex).not.toHaveBeenCalled();
    });
  });

  // ── revokeAllUserTokens ──

  describe('revokeAllUserTokens', () => {
    it('should increment token version in Redis', async () => {
      await authService.revokeAllUserTokens('user789');
      expect(mockRedis.incr).toHaveBeenCalledWith('user:token_version:user789');
    });
  });

  // ── MFA tickets ──

  describe('generateMfaTicket', () => {
    it('should return a JWT with mfa=true', () => {
      const ticket = authService.generateMfaTicket('user100');
      const jwt = require('jsonwebtoken');
      const payload = jwt.decode(ticket);
      expect(payload.userId).toBe('user100');
      expect(payload.mfa).toBe(true);
    });
  });

  describe('verifyMfaTicket', () => {
    it('should return userId for valid MFA ticket', () => {
      const ticket = authService.generateMfaTicket('user100');
      const result = authService.verifyMfaTicket(ticket);
      expect(result.userId).toBe('user100');
    });

    it('should throw for non-MFA token', () => {
      const jwt = require('jsonwebtoken');
      const normalToken = jwt.sign(
        { userId: 'user1' },
        'a-very-secret-key-that-is-at-least-32-chars-long!!'
      );
      expect(() => authService.verifyMfaTicket(normalToken)).toThrow('Invalid MFA ticket');
    });

    it('should throw for expired MFA ticket', () => {
      const jwt = require('jsonwebtoken');
      const expiredTicket = jwt.sign(
        { userId: 'user1', mfa: true },
        'a-very-secret-key-that-is-at-least-32-chars-long!!',
        { expiresIn: '-1s' }
      );
      expect(() => authService.verifyMfaTicket(expiredTicket)).toThrow();
    });
  });

  // ── register ──

  describe('register', () => {
    it('should create user and return token', async () => {
      const mockUser = createMockUser({ id: '999000000000000001' });
      mockUserRepository.findByEmail.mockResolvedValue(null);
      mockUserRepository.findByUsername.mockResolvedValue(null);
      mockUserRepository.create.mockResolvedValue(mockUser);
      mockRedis.get.mockResolvedValueOnce(null); // for generateToken

      const result = await authService.register('test@example.com', 'testuser', 'Password123');
      expect(result.token).toBeDefined();
      expect(result.user).toBeDefined();
      expect(mockUserRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '999000000000000001',
          email: 'test@example.com',
          username: 'testuser',
        })
      );
    });

    it('should throw 409 for duplicate email', async () => {
      mockUserRepository.findByEmail.mockResolvedValue(createMockUser());

      await expect(
        authService.register('test@example.com', 'newuser', 'Password123')
      ).rejects.toThrow('Email already registered');

      try {
        await authService.register('test@example.com', 'newuser', 'Password123');
      } catch (err: any) {
        expect(err.statusCode).toBe(409);
      }
    });

    it('should throw 409 for duplicate username', async () => {
      mockUserRepository.findByEmail.mockResolvedValue(null);
      mockUserRepository.findByUsername.mockResolvedValue(createMockUser());

      await expect(
        authService.register('new@example.com', 'testuser', 'Password123')
      ).rejects.toThrow('Username taken');
    });

    it('should lowercase the email', async () => {
      mockUserRepository.findByEmail.mockResolvedValue(null);
      mockUserRepository.findByUsername.mockResolvedValue(null);
      mockUserRepository.create.mockResolvedValue(createMockUser({ id: '999000000000000001' }));
      mockRedis.get.mockResolvedValueOnce(null);

      await authService.register('TEST@EXAMPLE.COM', 'testuser', 'Password123');
      expect(mockUserRepository.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(mockUserRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'test@example.com' })
      );
    });
  });

  // ── login ──

  describe('login', () => {
    it('should return token for valid credentials', async () => {
      const hash = await authService.hashPassword('Password123');
      const mockUser = createMockUser({ passwordHash: hash, mfaEnabled: false });
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockRedis.get.mockResolvedValueOnce(null); // for generateToken

      const result = await authService.login('test@example.com', 'Password123');
      expect(result.mfa).toBe(false);
      expect(result.token).toBeDefined();
      expect(result.user).toBeDefined();
    });

    it('should throw 401 for wrong password', async () => {
      const hash = await authService.hashPassword('Password123');
      const mockUser = createMockUser({ passwordHash: hash });
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);

      await expect(
        authService.login('test@example.com', 'WrongPassword')
      ).rejects.toThrow('Invalid email or password');
    });

    it('should throw 401 for non-existent email', async () => {
      mockUserRepository.findByEmail.mockResolvedValue(null);

      await expect(
        authService.login('nobody@example.com', 'Password123')
      ).rejects.toThrow('Invalid email or password');
    });

    it('should return MFA ticket when MFA is enabled', async () => {
      const hash = await authService.hashPassword('Password123');
      const mockUser = createMockUser({ passwordHash: hash, mfaEnabled: true });
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);

      const result = await authService.login('test@example.com', 'Password123');
      expect(result.mfa).toBe(true);
      expect(result.ticket).toBeDefined();
      expect(result.token).toBeNull();
      expect(result.user).toBeNull();
    });
  });

  // ── guestLogin ──

  describe('guestLogin', () => {
    it('should create a guest user with isGuest=true', async () => {
      const guestUser = createMockUser({
        id: '999000000000000001',
        isGuest: true,
        username: 'Guest_abc123',
        email: 'guest_999000000000000001@guest.local',
        passwordHash: '',
        guestExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      mockUserRepository.create.mockResolvedValue(guestUser);
      mockRedis.get.mockResolvedValueOnce(null); // for generateToken

      const result = await authService.guestLogin();
      expect(result.token).toBeDefined();
      expect(result.user).toBeDefined();
      expect(mockUserRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          isGuest: true,
          passwordHash: '',
        })
      );
    });

    it('should set guest expiry to 7 days from now', async () => {
      const now = Date.now();
      const guestUser = createMockUser({
        id: '999000000000000001',
        isGuest: true,
        guestExpiresAt: new Date(now + 7 * 24 * 60 * 60 * 1000),
      });
      mockUserRepository.create.mockResolvedValue(guestUser);
      mockRedis.get.mockResolvedValueOnce(null);

      await authService.guestLogin();
      const createCall = mockUserRepository.create.mock.calls[0]![0];
      expect(createCall.guestExpiresAt).toBeInstanceOf(Date);
      const diff = createCall.guestExpiresAt.getTime() - now;
      // Should be approximately 7 days (within 5 seconds tolerance)
      expect(diff).toBeGreaterThan(7 * 24 * 60 * 60 * 1000 - 5000);
      expect(diff).toBeLessThan(7 * 24 * 60 * 60 * 1000 + 5000);
    });
  });

  // ── claimGuestAccount ──

  describe('claimGuestAccount', () => {
    it('should convert guest to regular user', async () => {
      const guestUser = createMockUser({
        id: 'guest1',
        isGuest: true,
        username: 'Guest_abc',
      });
      const updatedUser = createMockUser({
        id: 'guest1',
        isGuest: false,
        email: 'claimed@example.com',
        username: 'claimed_user',
        guestExpiresAt: null,
      });

      mockUserRepository.findById
        .mockResolvedValueOnce(guestUser)  // initial check
        .mockResolvedValueOnce(updatedUser); // after update
      mockUserRepository.findByEmail.mockResolvedValue(null);
      mockUserRepository.findByUsername.mockResolvedValue(null);
      mockUserRepository.update.mockResolvedValue(undefined);

      const result = await authService.claimGuestAccount(
        'guest1', 'claimed@example.com', 'claimed_user', 'Password123'
      );
      expect(result.id).toBe('guest1');
      expect(mockUserRepository.update).toHaveBeenCalledWith(
        'guest1',
        expect.objectContaining({
          isGuest: false,
          guestExpiresAt: null,
        })
      );
    });

    it('should throw 400 for non-guest account', async () => {
      const regularUser = createMockUser({ isGuest: false });
      mockUserRepository.findById.mockResolvedValue(regularUser);

      await expect(
        authService.claimGuestAccount('user1', 'a@b.com', 'newuser', 'Pass123')
      ).rejects.toThrow('Not a guest account');
    });

    it('should throw 400 when user not found', async () => {
      mockUserRepository.findById.mockResolvedValue(null);

      await expect(
        authService.claimGuestAccount('nonexistent', 'a@b.com', 'newuser', 'Pass123')
      ).rejects.toThrow('Not a guest account');
    });

    it('should throw 409 for duplicate email on claim', async () => {
      const guestUser = createMockUser({ id: 'guest1', isGuest: true });
      mockUserRepository.findById.mockResolvedValue(guestUser);
      mockUserRepository.findByEmail.mockResolvedValue(createMockUser({ id: 'other' }));

      await expect(
        authService.claimGuestAccount('guest1', 'taken@example.com', 'newuser', 'Pass123')
      ).rejects.toThrow('Email already registered');
    });

    it('should throw 409 for duplicate username on claim (different user)', async () => {
      const guestUser = createMockUser({ id: 'guest1', isGuest: true });
      mockUserRepository.findById.mockResolvedValue(guestUser);
      mockUserRepository.findByEmail.mockResolvedValue(null);
      mockUserRepository.findByUsername.mockResolvedValue(createMockUser({ id: 'other-user' }));

      await expect(
        authService.claimGuestAccount('guest1', 'new@example.com', 'takenname', 'Pass123')
      ).rejects.toThrow('Username taken');
    });
  });

  // ── ApiError ──

  describe('ApiError', () => {
    it('should have correct statusCode and message', () => {
      const err = new authService.ApiError(404, 'Not found');
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Not found');
      expect(err.name).toBe('ApiError');
      expect(err).toBeInstanceOf(Error);
    });
  });
});
