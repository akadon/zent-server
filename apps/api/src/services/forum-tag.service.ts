import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";

const MAX_TAGS_PER_CHANNEL = 20;
const MAX_TAGS_PER_POST = 5;
const MAX_TAG_NAME_LENGTH = 20;

export interface ForumTag {
  id: string;
  channelId: string;
  name: string;
  emojiId: string | null;
  emojiName: string | null;
  moderated: boolean;
  position: number;
}

export async function getChannelTags(channelId: string): Promise<ForumTag[]> {
  const tags = await db
    .select()
    .from(schema.forumTags)
    .where(eq(schema.forumTags.channelId, channelId))
    .orderBy(schema.forumTags.position);

  return tags;
}

export async function createTag(
  channelId: string,
  data: {
    name: string;
    emojiId?: string;
    emojiName?: string;
    moderated?: boolean;
  }
): Promise<ForumTag> {
  if (data.name.length > MAX_TAG_NAME_LENGTH) {
    throw new ApiError(400, `Tag name must be ${MAX_TAG_NAME_LENGTH} characters or less`);
  }

  // Check tag limit
  const existingTags = await db
    .select()
    .from(schema.forumTags)
    .where(eq(schema.forumTags.channelId, channelId));

  if (existingTags.length >= MAX_TAGS_PER_CHANNEL) {
    throw new ApiError(400, `Forum channels can have at most ${MAX_TAGS_PER_CHANNEL} tags`);
  }

  // Get next position
  const maxPosition = existingTags.reduce((max, t) => Math.max(max, t.position), -1);

  const id = generateSnowflake();
  await db
    .insert(schema.forumTags)
    .values({
      id,
      channelId,
      name: data.name,
      emojiId: data.emojiId ?? null,
      emojiName: data.emojiName ?? null,
      moderated: data.moderated ?? false,
      position: maxPosition + 1,
    });

  const [tag] = await db
    .select()
    .from(schema.forumTags)
    .where(eq(schema.forumTags.id, id))
    .limit(1);

  if (!tag) {
    throw new ApiError(500, "Failed to create tag");
  }

  return tag;
}

export async function updateTag(
  tagId: string,
  data: {
    name?: string;
    emojiId?: string | null;
    emojiName?: string | null;
    moderated?: boolean;
    position?: number;
  }
): Promise<ForumTag> {
  if (data.name && data.name.length > MAX_TAG_NAME_LENGTH) {
    throw new ApiError(400, `Tag name must be ${MAX_TAG_NAME_LENGTH} characters or less`);
  }

  await db
    .update(schema.forumTags)
    .set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.emojiId !== undefined && { emojiId: data.emojiId }),
      ...(data.emojiName !== undefined && { emojiName: data.emojiName }),
      ...(data.moderated !== undefined && { moderated: data.moderated }),
      ...(data.position !== undefined && { position: data.position }),
    })
    .where(eq(schema.forumTags.id, tagId));

  const [tag] = await db
    .select()
    .from(schema.forumTags)
    .where(eq(schema.forumTags.id, tagId))
    .limit(1);

  if (!tag) {
    throw new ApiError(404, "Tag not found");
  }

  return tag;
}

export async function deleteTag(tagId: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(schema.forumTags)
    .where(eq(schema.forumTags.id, tagId))
    .limit(1);

  if (!existing) {
    throw new ApiError(404, "Tag not found");
  }

  await db
    .delete(schema.forumTags)
    .where(eq(schema.forumTags.id, tagId));
}

export async function getPostTags(threadId: string): Promise<ForumTag[]> {
  const postTags = await db
    .select({
      tag: schema.forumTags,
    })
    .from(schema.forumPostTags)
    .innerJoin(schema.forumTags, eq(schema.forumPostTags.tagId, schema.forumTags.id))
    .where(eq(schema.forumPostTags.threadId, threadId));

  return postTags.map((pt) => pt.tag);
}

export async function setPostTags(
  threadId: string,
  tagIds: string[],
  userId: string,
  isModerator: boolean
): Promise<ForumTag[]> {
  if (tagIds.length > MAX_TAGS_PER_POST) {
    throw new ApiError(400, `Posts can have at most ${MAX_TAGS_PER_POST} tags`);
  }

  // Verify all tags exist and belong to the parent channel
  const [thread] = await db
    .select({ parentId: schema.channels.parentId })
    .from(schema.channels)
    .where(eq(schema.channels.id, threadId))
    .limit(1);

  if (!thread?.parentId) {
    throw new ApiError(404, "Thread not found or has no parent");
  }

  const validTags = await db
    .select()
    .from(schema.forumTags)
    .where(eq(schema.forumTags.channelId, thread.parentId));

  const validTagIds = new Set(validTags.map((t) => t.id));
  const moderatedTagIds = new Set(validTags.filter((t) => t.moderated).map((t) => t.id));

  for (const tagId of tagIds) {
    if (!validTagIds.has(tagId)) {
      throw new ApiError(400, `Invalid tag ID: ${tagId}`);
    }
    if (moderatedTagIds.has(tagId) && !isModerator) {
      throw new ApiError(403, "You cannot apply moderated tags");
    }
  }

  // Remove existing tags
  await db
    .delete(schema.forumPostTags)
    .where(eq(schema.forumPostTags.threadId, threadId));

  // Add new tags
  if (tagIds.length > 0) {
    await db.insert(schema.forumPostTags).values(
      tagIds.map((tagId) => ({
        threadId,
        tagId,
      }))
    );
  }

  return validTags.filter((t) => tagIds.includes(t.id));
}

export async function reorderTags(
  channelId: string,
  tagOrder: Array<{ id: string; position: number }>
): Promise<ForumTag[]> {
  // Update positions
  for (const { id, position } of tagOrder) {
    await db
      .update(schema.forumTags)
      .set({ position })
      .where(
        and(
          eq(schema.forumTags.id, id),
          eq(schema.forumTags.channelId, channelId)
        )
      );
  }

  return getChannelTags(channelId);
}

export async function getTag(tagId: string): Promise<ForumTag | null> {
  const [tag] = await db
    .select()
    .from(schema.forumTags)
    .where(eq(schema.forumTags.id, tagId))
    .limit(1);

  return tag ?? null;
}

export async function addTagToPost(
  channelId: string,
  threadId: string,
  tagId: string
): Promise<void> {
  // Verify tag belongs to channel
  const tag = await getTag(tagId);
  if (!tag || tag.channelId !== channelId) {
    throw new ApiError(400, "Tag does not belong to this channel");
  }

  // Check post tag limit
  const existingTags = await getPostTags(threadId);
  if (existingTags.length >= MAX_TAGS_PER_POST) {
    throw new ApiError(400, `Posts can have at most ${MAX_TAGS_PER_POST} tags`);
  }

  try {
    await db.insert(schema.forumPostTags).values({
      threadId,
      tagId,
    });
  } catch {
    // Tag already applied, ignore
  }
}

export async function removeTagFromPost(
  threadId: string,
  tagId: string
): Promise<void> {
  await db
    .delete(schema.forumPostTags)
    .where(
      and(
        eq(schema.forumPostTags.threadId, threadId),
        eq(schema.forumPostTags.tagId, tagId)
      )
    );
}
