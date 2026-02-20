import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { authMiddleware } from "../../middleware/auth.js";
import { Client as MinioClient } from "minio";
import crypto from "crypto";

const minio = new MinioClient({
  endPoint: env.MINIO_ENDPOINT,
  port: env.MINIO_PORT,
  useSSL: env.MINIO_USE_SSL,
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY,
});

const BUCKET = env.MINIO_BUCKET;

async function ensureBucket() {
  const exists = await minio.bucketExists(BUCKET);
  if (!exists) {
    await minio.makeBucket(BUCKET);
    const policy = {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: ["*"] },
          Action: ["s3:GetObject"],
          Resource: [`arn:aws:s3:::${BUCKET}/*`],
        },
      ],
    };
    await minio.setBucketPolicy(BUCKET, JSON.stringify(policy));
  }
}

let bucketReady = false;

async function ensureBucketOnce() {
  if (!bucketReady) {
    await ensureBucket();
    bucketReady = true;
  }
}

function serveObject(objectKey: string, fallbackContentType = "application/octet-stream") {
  return async (_request: any, reply: any) => {
    await ensureBucketOnce();
    try {
      const stat = await minio.statObject(BUCKET, objectKey);
      const stream = await minio.getObject(BUCKET, objectKey);
      reply.header("Content-Type", stat.metaData?.["content-type"] ?? fallbackContentType);
      reply.header("Content-Length", stat.size);
      reply.header("Cache-Control", "public, max-age=31536000, immutable");
      return reply.send(stream);
    } catch {
      return reply.status(404).send({ error: "File not found" });
    }
  };
}

/** CDN routes — public, no auth required. Serves files from MinIO. */
export async function cdnRoutes(app: FastifyInstance) {
  // Upload file (auth required)
  app.post("/upload", { preHandler: [authMiddleware] }, async (request, reply) => {
    await ensureBucketOnce();
    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ error: "No file provided" });
    }

    const ALLOWED_TYPES = new Set([
      "image/jpeg", "image/png", "image/gif", "image/webp",
      "video/mp4", "video/webm", "audio/mpeg", "audio/ogg", "audio/wav",
      "application/pdf", "text/plain", "application/zip", "application/json",
    ]);

    if (!ALLOWED_TYPES.has(file.mimetype)) {
      return reply.status(400).send({ error: "File type not allowed" });
    }

    const buffer = await file.toBuffer();

    // Validate magic bytes for image types
    const MAGIC_BYTES: Record<string, number[]> = {
      "image/jpeg": [0xFF, 0xD8, 0xFF],
      "image/png": [0x89, 0x50, 0x4E, 0x47],
      "image/gif": [0x47, 0x49, 0x46],
      "image/webp": [0x52, 0x49, 0x46, 0x46],
    };
    const expected = MAGIC_BYTES[file.mimetype];
    if (expected && (buffer.length < expected.length || !expected.every((b, i) => buffer[i] === b))) {
      return reply.status(400).send({ error: "File content does not match declared type" });
    }

    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    if (buffer.length > MAX_FILE_SIZE) {
      return reply.status(413).send({ error: "File too large (max 50MB)" });
    }

    const ext = file.filename.includes(".")
      ? file.filename.substring(file.filename.lastIndexOf("."))
      : "";
    const id = crypto.randomUUID();
    const objectName = `${id}${ext}`;

    await minio.putObject(BUCKET, objectName, buffer, buffer.length, {
      "Content-Type": file.mimetype,
    });

    return reply.send({
      id,
      filename: file.filename,
      size: buffer.length,
      contentType: file.mimetype,
      url: `/files/${objectName}`,
    });
  });

  // Serve file by name
  app.get("/files/:filename", async (request, reply) => {
    const { filename } = request.params as { filename: string };
    // Prevent path traversal
    if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      return reply.status(400).send({ error: "Invalid filename" });
    }
    return serveObject(filename)(request, reply);
  });

  // Serve message attachments
  app.get("/attachments/:channelId/:attachmentId/:filename", async (request, reply) => {
    const { channelId, attachmentId, filename } = request.params as {
      channelId: string;
      attachmentId: string;
      filename: string;
    };

    await ensureBucketOnce();
    const prefix = `attachments/${channelId}/${attachmentId}/`;

    try {
      const objects: string[] = [];
      const stream = minio.listObjects(BUCKET, prefix, false);
      for await (const obj of stream) {
        if (obj.name) objects.push(obj.name);
      }

      if (objects.length === 0) {
        return reply.status(404).send({ error: "Attachment not found" });
      }

      const objectKey = objects[0]!;
      const stat = await minio.statObject(BUCKET, objectKey);
      const fileStream = await minio.getObject(BUCKET, objectKey);

      reply.header("Content-Type", stat.metaData?.["content-type"] ?? "application/octet-stream");
      reply.header("Content-Length", stat.size);
      reply.header("Cache-Control", "public, max-age=31536000, immutable");
      reply.header("Content-Disposition", `inline; filename="${encodeURIComponent(filename)}"`);

      return reply.send(fileStream);
    } catch {
      return reply.status(404).send({ error: "Attachment not found" });
    }
  });

  // Serve avatars
  app.get("/avatars/:userId/:filename", async (request, reply) => {
    const { userId, filename } = request.params as { userId: string; filename: string };
    return serveObject(`avatars/${userId}/${filename}`, "image/png")(request, reply);
  });

  // Serve banners
  app.get("/banners/:userId/:filename", async (request, reply) => {
    const { userId, filename } = request.params as { userId: string; filename: string };
    return serveObject(`banners/${userId}/${filename}`, "image/png")(request, reply);
  });

  // Serve guild icons
  app.get("/icons/:guildId/:filename", async (request, reply) => {
    const { guildId, filename } = request.params as { guildId: string; filename: string };
    return serveObject(`icons/${guildId}/${filename}`, "image/png")(request, reply);
  });

  // Serve emojis
  app.get("/emojis/:filename", async (request, reply) => {
    const { filename } = request.params as { filename: string };
    return serveObject(`emojis/${filename}`, "image/png")(request, reply);
  });
}
