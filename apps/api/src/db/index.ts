import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";
import { env } from "../config/env.js";

const { Pool } = pg;

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 15,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 10000,
});

export const db = drizzle({ client: pool, schema });

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
