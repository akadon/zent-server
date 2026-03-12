import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema.js";
import { env } from "../config/env.js";

const pool = mysql.createPool({
  uri: env.DATABASE_URL,
  waitForConnections: true,
  connectionLimit: 30,
  maxIdle: 10,
  idleTimeout: 30000,
  connectTimeout: 10000,
  queueLimit: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 30000,
});

pool.on('connection', (connection) => {
  connection.on('error', (err) => {
    console.error('[mysql] Connection error:', err.message);
  });
});

export const db = drizzle({ client: pool, schema, mode: "default" });

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
