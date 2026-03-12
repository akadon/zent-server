import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──

const mockPollRepository = {
  findById: vi.fn(),
  findByMessageId: vi.fn(),
  findOptions: vi.fn(),
  findOption: vi.fn(),
  findOptionsByPollIds: vi.fn(),
  findVotesByPollId: vi.fn(),
  findVotesByPollIds: vi.fn(),
  createWithOptions: vi.fn(),
  createVoteInTx: vi.fn(),
  deleteVote: vi.fn(),
  deleteVotesByUserInTx: vi.fn(),
  setExpired: vi.fn(),
};

const mockDb = {
  transaction: vi.fn(),
};

vi.mock('../../src/repositories/poll.repository.js', () => ({
  pollRepository: mockPollRepository,
}));
vi.mock('../../src/db/index.js', () => ({
  db: mockDb,
}));
vi.mock('../../src/config/env.js', () => ({
  env: { AUTH_SECRET: 'test-secret-that-is-at-least-32-characters!!' },
}));
vi.mock('../../src/config/redis.js', () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
}));
vi.mock('@yxc/snowflake', () => ({
  generateSnowflake: vi.fn(() => 'poll-snowflake-1'),
}));

const pollService = await import('../../src/services/poll.service.js');

function createMockPoll(overrides: Record<string, any> = {}) {
  return {
    id: 'poll-1',
    channelId: 'ch-1',
    messageId: 'msg-1',
    question: 'Favorite color?',
    allowMultiselect: false,
    anonymous: false,
    expiresAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('Poll Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── createPoll ──

  describe('createPoll', () => {
    it('should create a poll with options', async () => {
      mockPollRepository.createWithOptions.mockResolvedValue(undefined);
      // getPoll is called after create
      mockPollRepository.findById.mockResolvedValue(createMockPoll({ id: 'poll-snowflake-1' }));
      mockPollRepository.findOptions.mockResolvedValue([
        { id: 'opt-1', pollId: 'poll-snowflake-1', text: 'Red', position: 0 },
        { id: 'opt-2', pollId: 'poll-snowflake-1', text: 'Blue', position: 1 },
      ]);
      mockPollRepository.findVotesByPollId.mockResolvedValue([]);

      const result = await pollService.createPoll(
        'ch-1', 'msg-1', 'Favorite color?',
        ['Red', 'Blue']
      );

      expect(result).toBeDefined();
      expect(result!.question).toBe('Favorite color?');
      expect(result!.options).toHaveLength(2);
      expect(mockPollRepository.createWithOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'poll-snowflake-1',
          question: 'Favorite color?',
          allowMultiselect: false,
        }),
        ['Red', 'Blue']
      );
    });

    it('should set expiresAt when duration is provided', async () => {
      mockPollRepository.createWithOptions.mockResolvedValue(undefined);
      mockPollRepository.findById.mockResolvedValue(createMockPoll({ id: 'poll-snowflake-1' }));
      mockPollRepository.findOptions.mockResolvedValue([]);
      mockPollRepository.findVotesByPollId.mockResolvedValue([]);

      await pollService.createPoll(
        'ch-1', 'msg-1', 'Quick poll?', ['Yes', 'No'],
        { duration: 3600 }
      );

      const createCall = mockPollRepository.createWithOptions.mock.calls[0]![0];
      expect(createCall.expiresAt).toBeInstanceOf(Date);
    });

    it('should enable multiselect when option is set', async () => {
      mockPollRepository.createWithOptions.mockResolvedValue(undefined);
      mockPollRepository.findById.mockResolvedValue(createMockPoll({ id: 'poll-snowflake-1', allowMultiselect: true }));
      mockPollRepository.findOptions.mockResolvedValue([]);
      mockPollRepository.findVotesByPollId.mockResolvedValue([]);

      await pollService.createPoll(
        'ch-1', 'msg-1', 'Multi?', ['A', 'B'],
        { allowMultiselect: true }
      );

      const createCall = mockPollRepository.createWithOptions.mock.calls[0]![0];
      expect(createCall.allowMultiselect).toBe(true);
    });
  });

  // ── votePoll ──

  describe('votePoll', () => {
    it('should cast a vote on a valid poll option', async () => {
      mockPollRepository.findById.mockResolvedValue(createMockPoll());
      mockPollRepository.findOption.mockResolvedValue({ id: 'opt-1', pollId: 'poll-1', text: 'Red' });
      mockDb.transaction.mockImplementation(async (cb: any) => cb({}));
      mockPollRepository.deleteVotesByUserInTx.mockResolvedValue(undefined);
      mockPollRepository.createVoteInTx.mockResolvedValue(undefined);

      const result = await pollService.votePoll('poll-1', 'opt-1', 'user-1');
      expect(result.pollId).toBe('poll-1');
      expect(result.optionId).toBe('opt-1');
      expect(result.userId).toBe('user-1');
    });

    it('should throw 404 when poll not found', async () => {
      mockPollRepository.findById.mockResolvedValue(null);

      await expect(
        pollService.votePoll('nonexistent', 'opt-1', 'user-1')
      ).rejects.toThrow('Poll not found');
    });

    it('should throw 400 when poll has expired', async () => {
      const expiredPoll = createMockPoll({
        expiresAt: new Date('2020-01-01T00:00:00Z'),
      });
      mockPollRepository.findById.mockResolvedValue(expiredPoll);

      await expect(
        pollService.votePoll('poll-1', 'opt-1', 'user-1')
      ).rejects.toThrow('Poll has ended');
    });

    it('should throw 404 when option does not belong to poll', async () => {
      mockPollRepository.findById.mockResolvedValue(createMockPoll());
      mockPollRepository.findOption.mockResolvedValue(null);

      await expect(
        pollService.votePoll('poll-1', 'bad-opt', 'user-1')
      ).rejects.toThrow('Option not found');
    });

    it('should handle duplicate vote error for single-select', async () => {
      mockPollRepository.findById.mockResolvedValue(createMockPoll({ allowMultiselect: false }));
      mockPollRepository.findOption.mockResolvedValue({ id: 'opt-1', pollId: 'poll-1' });
      mockDb.transaction.mockImplementation(async (cb: any) => {
        await cb({});
      });
      mockPollRepository.deleteVotesByUserInTx.mockResolvedValue(undefined);
      mockPollRepository.createVoteInTx.mockRejectedValue(
        Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 })
      );

      await expect(
        pollService.votePoll('poll-1', 'opt-1', 'user-1')
      ).rejects.toThrow('Already voted for this option');
    });

    it('should not delete previous votes when multiselect is enabled', async () => {
      mockPollRepository.findById.mockResolvedValue(createMockPoll({ allowMultiselect: true }));
      mockPollRepository.findOption.mockResolvedValue({ id: 'opt-2', pollId: 'poll-1' });
      mockDb.transaction.mockImplementation(async (cb: any) => {
        await cb({});
      });
      mockPollRepository.createVoteInTx.mockResolvedValue(undefined);

      await pollService.votePoll('poll-1', 'opt-2', 'user-1');
      expect(mockPollRepository.deleteVotesByUserInTx).not.toHaveBeenCalled();
    });
  });

  // ── endPoll ──

  describe('endPoll', () => {
    it('should mark poll as expired', async () => {
      mockPollRepository.findById
        .mockResolvedValueOnce(createMockPoll()) // endPoll check
        .mockResolvedValueOnce(createMockPoll()); // getPoll after
      mockPollRepository.setExpired.mockResolvedValue(undefined);
      mockPollRepository.findOptions.mockResolvedValue([]);
      mockPollRepository.findVotesByPollId.mockResolvedValue([]);

      const result = await pollService.endPoll('poll-1', 'user-1');
      expect(mockPollRepository.setExpired).toHaveBeenCalledWith('poll-1');
      expect(result).toBeDefined();
    });

    it('should throw 404 when ending non-existent poll', async () => {
      mockPollRepository.findById.mockResolvedValue(null);

      await expect(
        pollService.endPoll('nonexistent', 'user-1')
      ).rejects.toThrow('Poll not found');
    });
  });

  // ── getPoll ──

  describe('getPoll', () => {
    it('should return null when poll not found', async () => {
      mockPollRepository.findById.mockResolvedValue(null);

      const result = await pollService.getPoll('nonexistent');
      expect(result).toBeNull();
    });

    it('should compute totalVotes from unique userId set', async () => {
      mockPollRepository.findById.mockResolvedValue(createMockPoll());
      mockPollRepository.findOptions.mockResolvedValue([
        { id: 'opt-1', pollId: 'poll-1', text: 'A', position: 0 },
      ]);
      mockPollRepository.findVotesByPollId.mockResolvedValue([
        { pollId: 'poll-1', optionId: 'opt-1', userId: 'user-1' },
        { pollId: 'poll-1', optionId: 'opt-1', userId: 'user-2' },
        { pollId: 'poll-1', optionId: 'opt-1', userId: 'user-1' }, // duplicate user
      ]);

      const result = await pollService.getPoll('poll-1');
      expect(result!.totalVotes).toBe(2); // unique users
      expect(result!.options[0]!.votes).toBe(3); // total vote rows for option
    });
  });
});
