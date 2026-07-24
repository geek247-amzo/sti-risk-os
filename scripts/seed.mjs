import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed data");
}

const adminEmail = process.env.INITIAL_ADMIN_EMAIL || "admin@stirisk.co.za";
const adminName = process.env.INITIAL_ADMIN_NAME || "STI Risk Super Admin";
const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;

if (process.env.NODE_ENV === "production" && !adminPassword) {
  throw new Error("INITIAL_ADMIN_PASSWORD is required to seed production admin access");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

const pool = new Pool({ connectionString: databaseUrl });

const stages = [
  ["Lead In", 10, false],
  ["Qualified", 20, false],
  ["Proposal Sent", 30, false],
  ["Negotiation", 40, false],
  ["Won", 50, true],
  ["Lost", 60, true],
];

for (const [name, position, isTerminal] of stages) {
  await pool.query(
    `INSERT INTO pipeline_stages (name, position, is_terminal)
     VALUES ($1, $2, $3)
     ON CONFLICT (name) DO UPDATE SET position = EXCLUDED.position, is_terminal = EXCLUDED.is_terminal`,
    [name, position, isTerminal],
  );
}

const taskBoard = await pool.query(
  `SELECT id FROM task_boards WHERE project_id IS NULL ORDER BY is_default DESC, created_at LIMIT 1`,
);
const taskBoardId =
  taskBoard.rows[0]?.id ??
  (
    await pool.query(
      `INSERT INTO task_boards (name, is_default)
       VALUES ('Operations Board', true)
       RETURNING id`,
    )
  ).rows[0].id;

const taskStages = [
  ["Backlog", 10, false],
  ["Scheduled", 20, false],
  ["In Progress", 30, false],
  ["Review / QA", 40, false],
  ["Completed", 50, true],
];

for (const [name, position, isTerminal] of taskStages) {
  await pool.query(
    `INSERT INTO task_stages (board_id, name, position, is_terminal)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (board_id, name) DO UPDATE SET
       position = EXCLUDED.position,
       is_terminal = EXCLUDED.is_terminal`,
    [taskBoardId, name, position, isTerminal],
  );
}

await pool.query(
  `INSERT INTO app_users (email, name, role, password_hash, auth_provider)
   VALUES ($1, $2, 'admin', $3, 'password')
   ON CONFLICT (email) DO UPDATE SET
     name = EXCLUDED.name,
     role = 'admin',
     password_hash = EXCLUDED.password_hash,
     auth_provider = 'password',
     updated_at = now()`,
  [adminEmail, adminName, hashPassword(adminPassword || "local-dev-admin-password")],
);

const admin = await pool.query("SELECT id FROM app_users WHERE email = $1", [adminEmail]);
await pool.query(
  `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, metadata)
   VALUES ('system', $1, 'seed_admin', 'app_user', $1, '{"source":"seed"}'::jsonb)`,
  [admin.rows[0]?.id ?? null],
);

console.log(`Seeded pipeline stages, task stages, and admin ${adminEmail}`);
await pool.end();
