import { eq, and, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";

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

  await db.insert(schema.polls).values({
    id: pollId,
    channelId,
    messageId,
    question,
    allowMultiselect: opts?.allowMultiselect ?? false,
    anonymous: opts?.anonymous ?? false,
    expiresAt,
  });

  for (let i = 0; i < options.length; i++) {
    await db.insert(schema.pollOptions).values({
      id: generateSnowflake(),
      pollId,
      text: options[i]!,
      position: i,
    });
  }

  return getPoll(pollId);
}

export async function getPoll(pollId: string, userId?: string) {
  const [poll] = await db
    .select()
    .from(schema.polls)
    .where(eq(schema.polls.id, pollId))
    .limit(1);

  if (!poll) return null;

  const options = await db
    .select()
    .from(schema.pollOptions)
    .where(eq(schema.pollOptions.pollId, pollId));

  const votes = await db
    .select()
    .from(schema.pollVotes)
    .where(eq(schema.pollVotes.pollId, pollId));

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
  const [poll] = await db
    .select()
    .from(schema.polls)
    .where(eq(schema.polls.messageId, messageId))
    .limit(1);

  if (!poll) return null;
  return getPoll(poll.id, userId);
}

export async function votePoll(pollId: string, optionId: string, userId: string) {
  const [poll] = await db
    .select()
    .from(schema.polls)
    .where(eq(schema.polls.id, pollId))
    .limit(1);

  if (!poll) throw new ApiError(404, "Poll not found");
  if (poll.expiresAt && poll.expiresAt < new Date()) {
    throw new ApiError(400, "Poll has ended");
  }

  // Check if option belongs to this poll
  const [option] = await db
    .select()
    .from(schema.pollOptions)
    .where(and(eq(schema.pollOptions.id, optionId), eq(schema.pollOptions.pollId, pollId)))
    .limit(1);

  if (!option) throw new ApiError(404, "Option not found");

  // If not multiselect, remove existing vote first
  if (!poll.allowMultiselect) {
    await db
      .delete(schema.pollVotes)
      .where(and(eq(schema.pollVotes.pollId, pollId), eq(schema.pollVotes.userId, userId)));
  }

  // Check for duplicate vote on same option
  const [existing] = await db
    .select()
    .from(schema.pollVotes)
    .where(
      and(
        eq(schema.pollVotes.pollId, pollId),
        eq(schema.pollVotes.optionId, optionId),
        eq(schema.pollVotes.userId, userId)
      )
    )
    .limit(1);

  if (existing) throw new ApiError(400, "Already voted for this option");

  await db.insert(schema.pollVotes).values({ pollId, optionId, userId });

  return { pollId, optionId, userId, channelId: poll.channelId, messageId: poll.messageId };
}

export async function removePollVote(pollId: string, optionId: string, userId: string) {
  const [poll] = await db
    .select()
    .from(schema.polls)
    .where(eq(schema.polls.id, pollId))
    .limit(1);

  if (!poll) throw new ApiError(404, "Poll not found");

  await db
    .delete(schema.pollVotes)
    .where(
      and(
        eq(schema.pollVotes.pollId, pollId),
        eq(schema.pollVotes.optionId, optionId),
        eq(schema.pollVotes.userId, userId)
      )
    );

  return { pollId, optionId, userId, channelId: poll.channelId, messageId: poll.messageId };
}

export async function endPoll(pollId: string, userId: string) {
  const [poll] = await db
    .select()
    .from(schema.polls)
    .where(eq(schema.polls.id, pollId))
    .limit(1);

  if (!poll) throw new ApiError(404, "Poll not found");

  await db
    .update(schema.polls)
    .set({ expiresAt: new Date() })
    .where(eq(schema.polls.id, pollId));

  return getPoll(pollId, userId);
}
