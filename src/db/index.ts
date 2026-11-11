import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { env } from "../env.js";
import type { DB } from "./types.js";

// Return INT8/NUMERIC counts as numbers.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
// TIMESTAMP(3) without time zone holds UTC wall-clock values (Prisma convention).
pg.types.setTypeParser(1114, (v) => new Date(v.replace(" ", "T") + "Z"));

export const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 10 });
// Idle clients can be terminated by the server (restarts, failovers); never crash the process for it.
pool.on("error", (err) => console.error("postgres pool error:", err.message));
export const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
export type { DB };
