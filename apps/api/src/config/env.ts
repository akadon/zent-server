import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  AUTH_SECRET: z.string().min(32),
  API_PORT: z.coerce.number().default(4000),
  API_HOST: z.string().default("0.0.0.0"),

  MINIO_ENDPOINT: z.string().default("localhost"),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_ACCESS_KEY: z.string().default(""),
  MINIO_SECRET_KEY: z.string().default(""),
  MINIO_BUCKET: z.string().default("yxc-uploads"),
  MINIO_USE_SSL: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  VOICE_SERVICE_URL: z.string().optional(),
  VOICE_INTERNAL_KEY: z.string().optional(),
  RP_ID: z.string().default("localhost"),
  RP_ORIGIN: z.string().default("http://localhost:3000"),
  ENABLE_PRESENCE: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  GATEWAY_HEARTBEAT_INTERVAL: z.coerce.number().default(60000),
  WORKER_ID: z.coerce.number().default(1),
  PROCESS_ID: z.coerce.number().default(1),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
