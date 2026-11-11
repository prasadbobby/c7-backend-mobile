/**
 * Creates a NEW database on the Postgres server in DATABASE_URL, loads the full
 * FitForge schema + C7 mobile tables, and (with --seed) adds starter content.
 *
 *   DATABASE_URL=postgres://USER:PASS@HOST:5432/c7_mobile npm run db:setup -- --seed
 *
 * Safety: refuses to touch any database listed in PROTECTED_DATABASES
 * (default "fit-forge"), so the existing production database is never modified.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import "dotenv/config";
import { migrate } from "../src/migrate.js";
import { seed } from "./seed.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  url.searchParams.delete("schema"); // Prisma-only parameter
  if (!dbName) throw new Error("DATABASE_URL must include the NEW database name, e.g. .../c7_mobile");
  const protectedDbs = (process.env.PROTECTED_DATABASES ?? "fit-forge").split(",").map((s) => s.trim());
  if (protectedDbs.includes(dbName)) throw new Error(`Refusing to modify protected database "${dbName}". Point DATABASE_URL at a new database name.`);
  if (!/^[a-zA-Z0-9_-]+$/.test(dbName)) throw new Error("Database name may only contain letters, digits, _ and -");

  // If the database already exists (e.g. created in CyberPanel / by a DBA), use it as-is.
  const probe = new pg.Client({ connectionString: url.toString() });
  const exists = await probe.connect().then(() => true, () => false);
  await probe.end().catch(() => {});
  if (exists) console.log(`database "${dbName}" already exists`);
  else {
    const adminUrl = new URL(url.toString());
    adminUrl.pathname = "/postgres";
    const admin = new pg.Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    await admin.end();
    console.log(`created database "${dbName}"`);
  }

  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  const hasSchema = await client.query(`SELECT to_regclass('"UserInfo"') AS t`);
  if (!hasSchema.rows[0].t) {
    await client.query(readFileSync(join(root, "db", "fitforge-schema.sql"), "utf8"));
    console.log("loaded FitForge schema");
  } else console.log("FitForge schema already present");
  await client.end();

  await migrate(url.toString());
  if (process.argv.includes("--seed")) await seed(url.toString());
  console.log(`\nDone. Use this in c7-backend/.env and FitForge staging .env:\nDATABASE_URL=${url.protocol}//${url.username}:****@${url.host}/${dbName}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
