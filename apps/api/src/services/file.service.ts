import { Client as MinioClient } from "minio";
import { config } from "../config/config.js";
import { env } from "../config/env.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import crypto from "crypto";
import path from "path";

const minio = new MinioClient({
  endPoint: config.s3.endpoint,
  port: config.s3.port,
  useSSL: config.s3.useSSL,
  accessKey: config.s3.accessKey,
  secretKey: config.s3.secretKey,
});

const BUCKET = config.s3.bucket;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB — more generous than Discord's 10MB free
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "application/pdf",
  "text/plain",
  "application/zip",
  "application/json",
]);

async function ensureBucket() {
  const exists = await minio.bucketExists(BUCKET);
  if (!exists) {
    await minio.makeBucket(BUCKET);
  }
}

const MAGIC_BYTES: Record<string, number[]> = {
  "image/jpeg": [0xFF, 0xD8, 0xFF],
  "image/png": [0x89, 0x50, 0x4E, 0x47],
  "image/gif": [0x47, 0x49, 0x46],
  "image/webp": [0x52, 0x49, 0x46, 0x46], // RIFF header
};

function verifyMagicBytes(buffer: Buffer, contentType: string): boolean {
  const expected = MAGIC_BYTES[contentType];
  if (!expected) return true; // no magic bytes to check
  if (buffer.length < expected.length) return false;
  return expected.every((byte, i) => buffer[i] === byte);
}

let bucketReady = false;

export async function uploadFile(
  buffer: Buffer,
  filename: string,
  contentType: string,
  channelId: string
): Promise<{
  id: string;
  filename: string;
  size: number;
  url: string;
  proxyUrl: string;
  contentType: string;
}> {
  if (!bucketReady) {
    await ensureBucket();
    bucketReady = true;
  }

  if (buffer.length > MAX_FILE_SIZE) {
    throw new ApiError(413, `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`);
  }

  if (!ALLOWED_TYPES.has(contentType)) {
    throw new ApiError(400, "File type not allowed");
  }

  if (contentType.startsWith("image/") && !verifyMagicBytes(buffer, contentType)) {
    throw new ApiError(400, "File content does not match declared type");
  }

  const id = generateSnowflake();
  const ext = path.extname(filename) || "";
  const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  const objectKey = `attachments/${channelId}/${id}/${hash}${ext}`;

  await minio.putObject(BUCKET, objectKey, buffer, buffer.length, {
    "Content-Type": contentType,
    "x-amz-meta-original-filename": filename,
  });

  const baseUrl = `http://${env.API_HOST === "0.0.0.0" ? "localhost" : env.API_HOST}:${env.API_PORT}`;
  const url = `${baseUrl}/attachments/${channelId}/${id}/${encodeURIComponent(filename)}`;
  const proxyUrl = url;

  return {
    id,
    filename,
    size: buffer.length,
    url,
    proxyUrl,
    contentType,
  };
}

export async function getFile(objectKey: string): Promise<Buffer> {
  try {
    const stream = await minio.getObject(BUCKET, objectKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  } catch {
    throw new ApiError(404, "File not found");
  }
}

export async function getFileByPrefix(prefix: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const objects: string[] = [];
    const stream = minio.listObjects(BUCKET, prefix, false);
    stream.on("data", (obj) => {
      if (obj.name) objects.push(obj.name);
    });
    stream.on("error", () => reject(new ApiError(404, "File not found")));
    stream.on("end", async () => {
      if (objects.length === 0) {
        return reject(new ApiError(404, "File not found"));
      }
      try {
        const data = await getFile(objects[0]!);
        resolve(data);
      } catch (err) {
        reject(err);
      }
    });
  });
}

export async function deleteFile(objectKey: string): Promise<void> {
  await minio.removeObject(BUCKET, objectKey);
}
