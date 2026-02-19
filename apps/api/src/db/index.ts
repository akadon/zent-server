import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema.js";
import { env } from "../config/env.js";

const pool = mysql.createPool({
  uri: env.DATABASE_URL,
  connectionLimit: 30,
  idleTimeout: 30000,
  connectTimeout: 10000,
});

export const db = drizzle(pool, { schema, mode: "default" });

export type Database = typeof db;
export { schema };

// Re-export types from schema
export type {
  SerializedGuild,
  WelcomeChannel,
  OnboardingPrompt,
  UserActivity,
  ApplicationCommandOption,
  SelectMenuOption,
} from "./schema.js";
