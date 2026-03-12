import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockReply, createMockUser } from '../helpers.js';

// ── Mocks ──

const mockVerifyToken = vi.fn();
const mockGetUserById = vi.fn();

vi.mock('../../src/services/auth.service.js', () => ({
  verifyToken: mockVerifyToken,
  getUserById: mockGetUserById,
  ApiError: class ApiError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
      this.name = 'ApiError';
    }
  },
}));

const { authMiddleware } = await import('../../src/middleware/auth.js');

describe('Auth Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw 401 when Authorization header is missing', async () => {
    const request = createMockRequest({ headers: {} }) as any;
    const reply = createMockReply();

    await expect(authMiddleware(request, reply)).rejects.toThrow('Missing authorization header');
  });

  it('should throw 401 when token is empty after Bearer prefix', async () => {
    const request = createMockRequest({
      headers: { authorization: 'Bearer ' },
    }) as any;
    const reply = createMockReply();

    // Empty string after "Bearer " → verifyToken gets called with ""
    // But actually the code slices "Bearer " off, getting "", which is falsy
    // Wait: "Bearer ".slice(7) = "" which is falsy → throws "Missing token"
    await expect(authMiddleware(request, reply)).rejects.toThrow('Missing token');
  });

  it('should throw 401 when token verification fails', async () => {
    const request = createMockRequest({
      headers: { authorization: 'Bearer invalid-token' },
    }) as any;
    const reply = createMockReply();
    mockVerifyToken.mockRejectedValue(new Error('jwt malformed'));

    await expect(authMiddleware(request, reply)).rejects.toThrow('Invalid token');
  });

  it('should throw 401 when user not found for valid token', async () => {
    const request = createMockRequest({
      headers: { authorization: 'Bearer valid-token' },
    }) as any;
    const reply = createMockReply();
    mockVerifyToken.mockResolvedValue({ userId: 'deleted-user' });
    mockGetUserById.mockResolvedValue(null);

    await expect(authMiddleware(request, reply)).rejects.toThrow('User not found');
  });

  it('should set request.userId when token and user are valid', async () => {
    const request = createMockRequest({
      headers: { authorization: 'Bearer valid-token' },
    }) as any;
    const reply = createMockReply();
    mockVerifyToken.mockResolvedValue({ userId: 'user-123' });
    mockGetUserById.mockResolvedValue(createMockUser({ id: 'user-123' }));

    await authMiddleware(request, reply);
    expect(request.userId).toBe('user-123');
  });

  it('should handle token without Bearer prefix', async () => {
    const request = createMockRequest({
      headers: { authorization: 'raw-token-value' },
    }) as any;
    const reply = createMockReply();
    mockVerifyToken.mockResolvedValue({ userId: 'user-456' });
    mockGetUserById.mockResolvedValue(createMockUser({ id: 'user-456' }));

    await authMiddleware(request, reply);
    // Token doesn't start with "Bearer " so it uses the full header value
    expect(mockVerifyToken).toHaveBeenCalledWith('raw-token-value');
    expect(request.userId).toBe('user-456');
  });

  it('should propagate ApiError from verifyToken as-is', async () => {
    const { ApiError } = await import('../../src/services/auth.service.js');
    const request = createMockRequest({
      headers: { authorization: 'Bearer revoked-token' },
    }) as any;
    const reply = createMockReply();
    const apiErr = new ApiError(401, 'Token has been revoked');
    mockVerifyToken.mockRejectedValue(apiErr);

    await expect(authMiddleware(request, reply)).rejects.toThrow('Token has been revoked');
  });
});
