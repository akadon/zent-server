import { eq, and, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";

export const pollRepository = {
  async findByMessageIds(messageIds: string[]) {
    if (messageIds.length === 0) return [];
    return db.select().from(schema.polls).where(inArray(schema.polls.messageId, messageIds));
  },
  async findById(id: string) {
    const [poll] = await db.select().from(schema.polls).where(eq(schema.polls.id, id)).limit(1);
    return poll ?? null;
  },
  async findByMessageId(messageId: string) {
    const [poll] = await db
      .select()
      .from(schema.polls)
      .where(eq(schema.polls.messageId, messageId))
      .limit(1);
    return poll ?? null;
  },
  async create(data: {
    id: string;
    channelId: string;
    messageId: string;
    question: string;
    allowMultiselect?: boolean;
    anonymous?: boolean;
    expiresAt?: Date | null;
  }) {
    await db.insert(schema.polls).values(data);
    return (await db.select().from(schema.polls).where(eq(schema.polls.id, data.id)).limit(1))[0]!;
  },
  async createOptions(options: { id: string; pollId: string; text: string; position?: number }[]) {
    if (options.length === 0) return;
    await db.insert(schema.pollOptions).values(options);
  },
  async findOptions(pollId: string) {
    return db.select().from(schema.pollOptions).where(eq(schema.pollOptions.pollId, pollId));
  },
  async createVote(pollId: string, optionId: string, userId: string) {
    await db.insert(schema.pollVotes).values({ pollId, optionId, userId });
  },
  async deleteVote(pollId: string, optionId: string, userId: string) {
    await db
      .delete(schema.pollVotes)
      .where(
        and(
          eq(schema.pollVotes.pollId, pollId),
          eq(schema.pollVotes.optionId, optionId),
          eq(schema.pollVotes.userId, userId),
        ),
      );
  },
  async findVotesByPollId(pollId: string) {
    return db.select().from(schema.pollVotes).where(eq(schema.pollVotes.pollId, pollId));
  },
  async findVotesByPollIds(pollIds: string[]) {
    if (pollIds.length === 0) return [];
    return db.select().from(schema.pollVotes).where(inArray(schema.pollVotes.pollId, pollIds));
  },
  async findOptionsByPollIds(pollIds: string[]) {
    if (pollIds.length === 0) return [];
    return db.select().from(schema.pollOptions).where(inArray(schema.pollOptions.pollId, pollIds));
  },
  async findOption(pollId: string, optionId: string) {
    const [option] = await db
      .select()
      .from(schema.pollOptions)
      .where(and(eq(schema.pollOptions.id, optionId), eq(schema.pollOptions.pollId, pollId)))
      .limit(1);
    return option ?? null;
  },
  async findVote(pollId: string, optionId: string, userId: string) {
    const [vote] = await db
      .select()
      .from(schema.pollVotes)
      .where(
        and(
          eq(schema.pollVotes.pollId, pollId),
          eq(schema.pollVotes.optionId, optionId),
          eq(schema.pollVotes.userId, userId),
        ),
      )
      .limit(1);
    return vote ?? null;
  },
  async deleteVotesByUser(pollId: string, userId: string) {
    await db
      .delete(schema.pollVotes)
      .where(and(eq(schema.pollVotes.pollId, pollId), eq(schema.pollVotes.userId, userId)));
  },
  async setExpired(pollId: string) {
    await db
      .update(schema.polls)
      .set({ expiresAt: new Date() })
      .where(eq(schema.polls.id, pollId));
  },
  async createWithOptions(
    data: {
      id: string;
      channelId: string;
      messageId: string;
      question: string;
      allowMultiselect?: boolean;
      anonymous?: boolean;
      expiresAt?: Date | null;
    },
    options: string[],
  ) {
    await db.transaction(async (tx) => {
      await tx.insert(schema.polls).values(data);
      for (let i = 0; i < options.length; i++) {
        await tx.insert(schema.pollOptions).values({
          id: generateSnowflake(),
          pollId: data.id,
          text: options[i]!,
          position: i,
        });
      }
    });
  },
};
