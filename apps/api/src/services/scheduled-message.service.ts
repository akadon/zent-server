import { eq, and, lte } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";

export async function createScheduledMessage(
  channelId: string,
  authorId: string,
  content: string,
  scheduledFor: Date
) {
  if (scheduledFor <= new Date()) {
    throw new ApiError(400, "Scheduled time must be in the future");
  }

  const id = generateSnowflake();
  await db
    .insert(schema.scheduledMessages)
    .values({
      id,
      channelId,
      authorId,
      content,
      scheduledFor,
    });

  const [msg] = await db
    .select()
    .from(schema.scheduledMessages)
    .where(eq(schema.scheduledMessages.id, id))
    .limit(1);

  return {
    ...msg!,
    scheduledFor: msg!.scheduledFor.toISOString(),
    createdAt: msg!.createdAt.toISOString(),
  };
}

export async function getScheduledMessages(channelId: string, authorId: string) {
  const messages = await db
    .select()
    .from(schema.scheduledMessages)
    .where(
      and(
        eq(schema.scheduledMessages.channelId, channelId),
        eq(schema.scheduledMessages.authorId, authorId),
        eq(schema.scheduledMessages.sent, false)
      )
    );

  return messages.map((m) => ({
    ...m,
    scheduledFor: m.scheduledFor.toISOString(),
    createdAt: m.createdAt.toISOString(),
  }));
}

export async function deleteScheduledMessage(id: string, authorId: string) {
  const [msg] = await db
    .select()
    .from(schema.scheduledMessages)
    .where(eq(schema.scheduledMessages.id, id))
    .limit(1);

  if (!msg) throw new ApiError(404, "Scheduled message not found");
  if (msg.authorId !== authorId) throw new ApiError(403, "Not your scheduled message");
  if (msg.sent) throw new ApiError(400, "Message already sent");

  await db.delete(schema.scheduledMessages).where(eq(schema.scheduledMessages.id, id));
}

export async function getDueScheduledMessages() {
  return db
    .select()
    .from(schema.scheduledMessages)
    .where(
      and(
        eq(schema.scheduledMessages.sent, false),
        lte(schema.scheduledMessages.scheduledFor, new Date())
      )
    );
}

export async function markAsSent(id: string) {
  await db
    .update(schema.scheduledMessages)
    .set({ sent: true })
    .where(eq(schema.scheduledMessages.id, id));
}
