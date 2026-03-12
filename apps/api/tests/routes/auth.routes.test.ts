import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createMockUser } from '../helpers.js';

// ── Mocks ──

const mockRegister = vi.fn();
const mockLogin = vi.fn();
const mockGuestLogin = vi.fn();
const mockClaimGuestAccount = vi.fn();
const mockGetUserById = vi.fn();
const mockInvalidateUserCache = vi.fn();
const mockVerifyToken = vi.fn();

vi.mock('../../src/services/auth.service.js', () => ({
  register: mockRegister,
  login: mockLogin,
  guestLogin: mockGuestLogin,
  claimGuestAccount: mockClaimGuestAccount,
  getUserById: mockGetUserById,
  invalidateUserCache: mockInvalidateUserCache,
  verifyToken: mockVerifyToken,
  ApiError: class ApiError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
      this.name = 'ApiError';
    }
  },
}));

// Mock rate limiter to be a no-op
vi.mock('../../src/middleware/rateLimit.js', () => ({
  createRateLimiter: () => async () => {},
}));

// Mock auth middleware — by default it sets userId
vi.mock('../../src/middleware/auth.js', () => ({
  authMiddleware: vi.fn(async (request: any) => {
    const header = request.headers.authorization;
    if (!header) {
      const { ApiError } = await import('../../src/services/auth.service.js');
      throw new ApiError(401, 'Missing authorization header');
    }
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (!token) {
      const { ApiError } = await import('../../src/services/auth.service.js');
      throw new ApiError(401, 'Missing token');
    }
    // Use mock verifyToken
    const payload = await mockVerifyToken(token);
    request.userId = payload.userId;
  }),
}));

// Mock drizzle/db for the PATCH /users/@me route
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));
vi.mock('../../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  },
  schema: {
    users: {
      id: 'id',
      username: 'username',
      displayName: 'displayName',
      email: 'email',
      avatar: 'avatar',
      banner: 'banner',
      bio: 'bio',
      status: 'status',
      customStatus: 'customStatus',
      mfaEnabled: 'mfaEnabled',
      verified: 'verified',
      flags: 'flags',
      premiumType: 'premiumType',
      locale: 'locale',
      createdAt: 'createdAt',
    },
  },
}));

const { authRoutes } = await import('../../src/rest/routes/auth.js');

describe('Auth Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();

    // Error handler to convert ApiError to proper HTTP responses
    app.setErrorHandler((error: any, _request, reply) => {
      if (error.statusCode) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      // Zod validation errors
      if (error.name === 'ZodError') {
        return reply.status(400).send({ error: 'Validation error', issues: error.issues });
      }
      return reply.status(500).send({ error: 'Internal server error' });
    });

    await authRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── POST /auth/register ──

  describe('POST /auth/register', () => {
    it('should return 201 with token on valid registration', async () => {
      const mockUser = createMockUser();
      mockRegister.mockResolvedValue({
        token: 'jwt-token-123',
        user: { ...mockUser, createdAt: mockUser.createdAt.toISOString() },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'new@example.com',
          username: 'newuser',
          password: 'Password123',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.token).toBe('jwt-token-123');
    });

    it('should return 400 for invalid email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'not-an-email',
          username: 'validuser',
          password: 'Password123',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for short password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          username: 'validuser',
          password: 'short',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for password without uppercase', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          username: 'validuser',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for username with special chars', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          username: 'bad user!',
          password: 'Password123',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 409 when email already exists', async () => {
      const { ApiError } = await import('../../src/services/auth.service.js');
      mockRegister.mockRejectedValue(new ApiError(409, 'Email already registered'));

      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'taken@example.com',
          username: 'newuser',
          password: 'Password123',
        },
      });

      expect(response.statusCode).toBe(409);
    });
  });

  // ── POST /auth/login ──

  describe('POST /auth/login', () => {
    it('should return 200 with token on valid login', async () => {
      mockLogin.mockResolvedValue({
        mfa: false,
        ticket: null,
        token: 'jwt-login-token',
        user: { id: 'user-1', username: 'testuser' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'Password123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.token).toBe('jwt-login-token');
      expect(body.mfa).toBe(false);
    });

    it('should return 401 for wrong password', async () => {
      const { ApiError } = await import('../../src/services/auth.service.js');
      mockLogin.mockRejectedValue(new ApiError(401, 'Invalid email or password'));

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'WrongPassword123',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return MFA ticket when MFA is enabled', async () => {
      mockLogin.mockResolvedValue({
        mfa: true,
        ticket: 'mfa-ticket-xyz',
        token: null,
        user: null,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'Password123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.mfa).toBe(true);
      expect(body.ticket).toBe('mfa-ticket-xyz');
      expect(body.token).toBeNull();
    });
  });

  // ── POST /auth/guest ──

  describe('POST /auth/guest', () => {
    it('should return 201 with guest token', async () => {
      mockGuestLogin.mockResolvedValue({
        token: 'guest-token-abc',
        user: { id: 'guest-1', username: 'Guest_abc123', isGuest: true },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/guest',
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.token).toBe('guest-token-abc');
      expect(body.user.isGuest).toBe(true);
    });
  });

  // ── POST /auth/claim ──

  describe('POST /auth/claim', () => {
    it('should convert guest account to regular', async () => {
      mockVerifyToken.mockResolvedValue({ userId: 'guest-1' });
      mockClaimGuestAccount.mockResolvedValue({
        id: 'guest-1',
        username: 'claimed_user',
        isGuest: false,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/claim',
        headers: { authorization: 'Bearer valid-guest-token' },
        payload: {
          email: 'claimed@example.com',
          username: 'claimed_user',
          password: 'Password123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.user.isGuest).toBe(false);
    });

    it('should return 401 when unauthenticated', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/claim',
        payload: {
          email: 'claimed@example.com',
          username: 'claimed_user',
          password: 'Password123',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 400 for non-guest account', async () => {
      const { ApiError } = await import('../../src/services/auth.service.js');
      mockVerifyToken.mockResolvedValue({ userId: 'regular-user' });
      mockClaimGuestAccount.mockRejectedValue(new ApiError(400, 'Not a guest account'));

      const response = await app.inject({
        method: 'POST',
        url: '/auth/claim',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          email: 'claimed@example.com',
          username: 'claimed_user',
          password: 'Password123',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for invalid claim body', async () => {
      mockVerifyToken.mockResolvedValue({ userId: 'guest-1' });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/claim',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          email: 'not-valid',
          username: 'x', // too short
          password: 'weak',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
