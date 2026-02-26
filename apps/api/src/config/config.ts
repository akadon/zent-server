import { readFileSync, existsSync } from "fs";
import { env } from "./env.js";

interface S3Config {
  endpoint: string;
  port: number;
  accessKey: string;
  secretKey: string;
  bucket: string;
  useSSL: boolean;
}

interface StreamConfig {
  url: string;
  internalKey: string;
}

interface CorsConfig {
  origins: string[];
}

interface AppConfig {
  s3: S3Config;
  stream: StreamConfig;
  cors: CorsConfig;
}

function loadConfigFile(): Partial<AppConfig> {
  const configPath = process.env.CONFIG_PATH || "./config.json";
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

const file = loadConfigFile();

export const config: AppConfig = {
  s3: {
    endpoint: env.MINIO_ENDPOINT ?? file.s3?.endpoint ?? "localhost",
    port: env.MINIO_PORT ?? file.s3?.port ?? 9000,
    accessKey: env.MINIO_ACCESS_KEY ?? file.s3?.accessKey ?? "minioadmin",
    secretKey: env.MINIO_SECRET_KEY ?? file.s3?.secretKey ?? "minioadmin",
    bucket: env.MINIO_BUCKET ?? file.s3?.bucket ?? "yxc-uploads",
    useSSL: env.MINIO_USE_SSL ?? file.s3?.useSSL ?? false,
  },
  stream: {
    url: env.VOICE_SERVICE_URL ?? file.stream?.url ?? "",
    internalKey: env.VOICE_INTERNAL_KEY ?? file.stream?.internalKey ?? "",
  },
  cors: {
    origins: env.CORS_ORIGIN
      ? env.CORS_ORIGIN.split(",")
      : file.cors?.origins ?? ["http://localhost:3000"],
  },
};
