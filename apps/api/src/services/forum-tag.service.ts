import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import { forumTagRepository } from "../repositories/forum-tag.repository.js";

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
  return forumTagRepository.findByChannelId(channelId);
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
  const existingTags = await forumTagRepository.findAllByChannelId(channelId);

  if (existingTags.length >= MAX_TAGS_PER_CHANNEL) {
    throw new ApiError(400, `Forum channels can have at most ${MAX_TAGS_PER_CHANNEL} tags`);
  }

  // Get next position
  const maxPosition = existingTags.reduce((max, t) => Math.max(max, t.position), -1);

  const id = generateSnowflake();
  const tag = await forumTagRepository.create({
    id,
    channelId,
    name: data.name,
    emojiId: data.emojiId ?? null,
    emojiName: data.emojiName ?? null,
    moderated: data.moderated ?? false,
    position: maxPosition + 1,
  });

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

  const updateData: Record<string, any> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.emojiId !== undefined) updateData.emojiId = data.emojiId;
  if (data.emojiName !== undefined) updateData.emojiName = data.emojiName;
  if (data.moderated !== undefined) updateData.moderated = data.moderated;
  if (data.position !== undefined) updateData.position = data.position;

  const tag = await forumTagRepository.update(tagId, updateData);

  if (!tag) {
    throw new ApiError(404, "Tag not found");
  }

  return tag;
}

export async function deleteTag(tagId: string): Promise<void> {
  const existing = await forumTagRepository.findById(tagId);

  if (!existing) {
    throw new ApiError(404, "Tag not found");
  }

  await forumTagRepository.delete(tagId);
}

export async function getPostTags(threadId: string): Promise<ForumTag[]> {
  const postTags = await forumTagRepository.findPostTags(threadId);
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
  const parentId = await forumTagRepository.findThreadParentId(threadId);

  if (!parentId) {
    throw new ApiError(404, "Thread not found or has no parent");
  }

  const validTags = await forumTagRepository.findAllByChannelId(parentId);

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
  await forumTagRepository.deletePostTags(threadId);

  // Add new tags
  if (tagIds.length > 0) {
    await forumTagRepository.insertPostTags(
      tagIds.map((tagId) => ({ threadId, tagId }))
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
    await forumTagRepository.updatePosition(id, channelId, position);
  }

  return getChannelTags(channelId);
}

export async function getTag(tagId: string): Promise<ForumTag | null> {
  return forumTagRepository.findById(tagId);
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
    await forumTagRepository.insertPostTag(threadId, tagId);
  } catch {
    // Tag already applied, ignore
  }
}

export async function removeTagFromPost(
  threadId: string,
  tagId: string
): Promise<void> {
  await forumTagRepository.deletePostTag(threadId, tagId);
}
