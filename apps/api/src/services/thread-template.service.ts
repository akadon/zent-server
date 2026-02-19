import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";

export async function createTemplate(
  channelId: string,
  guildId: string,
  name: string,
  content: string,
  createdBy: string
) {
  const id = generateSnowflake();
  await db
    .insert(schema.threadTemplates)
    .values({ id, channelId, guildId, name, content, createdBy });

  const [template] = await db
    .select()
    .from(schema.threadTemplates)
    .where(eq(schema.threadTemplates.id, id))
    .limit(1);

  return {
    ...template!,
    createdAt: template!.createdAt.toISOString(),
  };
}

export async function getTemplates(channelId: string) {
  const templates = await db
    .select()
    .from(schema.threadTemplates)
    .where(eq(schema.threadTemplates.channelId, channelId));
  return templates.map((t) => ({
    ...t,
    createdAt: t.createdAt.toISOString(),
  }));
}

export async function deleteTemplate(templateId: string, userId: string) {
  const [template] = await db
    .select()
    .from(schema.threadTemplates)
    .where(eq(schema.threadTemplates.id, templateId))
    .limit(1);
  if (!template) throw new ApiError(404, "Template not found");
  if (template.createdBy !== userId) throw new ApiError(403, "Not your template");
  await db.delete(schema.threadTemplates).where(eq(schema.threadTemplates.id, templateId));
}
