import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations");
}

const pool = new Pool({ connectionString: databaseUrl });
const migrationsDir = path.resolve("migrations");

await pool.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`);

const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

for (const file of files) {
  const exists = await pool.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [file]);
  if (exists.rowCount) continue;

  const sql = await readFile(path.join(migrationsDir, file), "utf8");
  await pool.query("BEGIN");
  try {
    await pool.query(sql);
    await pool.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
    await pool.query("COMMIT");
    console.log(`Applied ${file}`);
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

await pool.end();
