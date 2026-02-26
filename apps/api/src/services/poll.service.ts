import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import { pollRepository } from "../repositories/poll.repository.js";

export async function createPoll(
  channelId: string,
  messageId: string,
  question: string,
  options: string[],
  opts?: { allowMultiselect?: boolean; anonymous?: boolean; duration?: number }
) {
  const pollId = generateSnowflake();
  const expiresAt = opts?.duration
    ? new Date(Date.now() + opts.duration * 1000)
    : null;

  await pollRepository.createWithOptions(
    {
      id: pollId,
      channelId,
      messageId,
      question,
      allowMultiselect: opts?.allowMultiselect ?? false,
      anonymous: opts?.anonymous ?? false,
      expiresAt,
    },
    options,
  );

  return getPoll(pollId);
}

export async function getPoll(pollId: string, userId?: string) {
  const poll = await pollRepository.findById(pollId);
  if (!poll) return null;

  const [options, votes] = await Promise.all([
    pollRepository.findOptions(pollId),
    pollRepository.findVotesByPollId(pollId),
  ]);

  const totalVotes = new Set(votes.map((v) => v.userId)).size;

  return {
    id: poll.id,
    channelId: poll.channelId,
    messageId: poll.messageId,
    question: poll.question,
    allowMultiselect: poll.allowMultiselect,
    anonymous: poll.anonymous,
    expiresAt: poll.expiresAt?.toISOString() ?? null,
    totalVotes,
    createdAt: poll.createdAt.toISOString(),
    options: options
      .sort((a, b) => a.position - b.position)
      .map((opt) => ({
        id: opt.id,
        text: opt.text,
        position: opt.position,
        votes: votes.filter((v) => v.optionId === opt.id).length,
        voted: userId ? votes.some((v) => v.optionId === opt.id && v.userId === userId) : false,
      })),
  };
}

export async function getPollByMessageId(messageId: string, userId?: string) {
  const poll = await pollRepository.findByMessageId(messageId);
  if (!poll) return null;
  return getPoll(poll.id, userId);
}

export async function getBatchPolls(
  polls: { id: string; channelId: string; messageId: string; question: string; allowMultiselect: boolean; anonymous: boolean; expiresAt: Date | null; createdAt: Date }[],
  userId?: string
): Promise<Map<string, Record<string, any>>> {
  const result = new Map<string, Record<string, any>>();
  if (polls.length === 0) return result;

  const pollIds = polls.map((p) => p.id);

  const [allOptions, allVotes] = await Promise.all([
    pollRepository.findOptionsByPollIds(pollIds),
    pollRepository.findVotesByPollIds(pollIds),
  ]);

  const optionsByPoll = new Map<string, typeof allOptions>();
  for (const opt of allOptions) {
    const list = optionsByPoll.get(opt.pollId) ?? [];
    list.push(opt);
    optionsByPoll.set(opt.pollId, list);
  }

  const votesByPoll = new Map<string, typeof allVotes>();
  for (const vote of allVotes) {
    const list = votesByPoll.get(vote.pollId) ?? [];
    list.push(vote);
    votesByPoll.set(vote.pollId, list);
  }

  for (const poll of polls) {
    const options = optionsByPoll.get(poll.id) ?? [];
    const votes = votesByPoll.get(poll.id) ?? [];
    const totalVotes = new Set(votes.map((v) => v.userId)).size;

    result.set(poll.messageId, {
      id: poll.id,
      channelId: poll.channelId,
      messageId: poll.messageId,
      question: poll.question,
      allowMultiselect: poll.allowMultiselect,
      anonymous: poll.anonymous,
      expiresAt: poll.expiresAt?.toISOString() ?? null,
      totalVotes,
      createdAt: poll.createdAt.toISOString(),
      options: options
        .sort((a, b) => a.position - b.position)
        .map((opt) => ({
          id: opt.id,
          text: opt.text,
          position: opt.position,
          votes: votes.filter((v) => v.optionId === opt.id).length,
          voted: userId ? votes.some((v) => v.optionId === opt.id && v.userId === userId) : false,
        })),
    });
  }

  return result;
}

export async function votePoll(pollId: string, optionId: string, userId: string) {
  const poll = await pollRepository.findById(pollId);
  if (!poll) throw new ApiError(404, "Poll not found");
  if (poll.expiresAt && poll.expiresAt < new Date()) {
    throw new ApiError(400, "Poll has ended");
  }

  // Check if option belongs to this poll
  const option = await pollRepository.findOption(pollId, optionId);
  if (!option) throw new ApiError(404, "Option not found");

  // If not multiselect, remove existing vote first
  if (!poll.allowMultiselect) {
    await pollRepository.deleteVotesByUser(pollId, userId);
  }

  // Check for duplicate vote on same option
  const existing = await pollRepository.findVote(pollId, optionId, userId);
  if (existing) throw new ApiError(400, "Already voted for this option");

  await pollRepository.createVote(pollId, optionId, userId);

  return { pollId, optionId, userId, channelId: poll.channelId, messageId: poll.messageId };
}

export async function removePollVote(pollId: string, optionId: string, userId: string) {
  const poll = await pollRepository.findById(pollId);
  if (!poll) throw new ApiError(404, "Poll not found");

  await pollRepository.deleteVote(pollId, optionId, userId);

  return { pollId, optionId, userId, channelId: poll.channelId, messageId: poll.messageId };
}

export async function endPoll(pollId: string, userId: string) {
  const poll = await pollRepository.findById(pollId);
  if (!poll) throw new ApiError(404, "Poll not found");

  await pollRepository.setExpired(pollId);

  return getPoll(pollId, userId);
}
