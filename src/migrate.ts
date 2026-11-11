/** Applies db/migrations/*.sql in order (idempotent; tracked in "_c7_migrations"). */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import "dotenv/config";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

export async function migrate(url = process.env.DATABASE_URL!) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS "_c7_migrations" ("name" TEXT PRIMARY KEY, "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const done = new Set((await client.query(`SELECT name FROM "_c7_migrations"`)).rows.map((r) => r.name));
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(f)) continue;
      await client.query("BEGIN");
      await client.query(readFileSync(join(dir, f), "utf8"));
      await client.query(`INSERT INTO "_c7_migrations"(name) VALUES ($1)`, [f]);
      await client.query("COMMIT");
      console.log(`applied ${f}`);
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => console.log("migrations up to date"), (e) => (console.error(e), process.exit(1)));
}
