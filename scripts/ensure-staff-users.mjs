import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to ensure staff users");
}

const users = [
  {
    name: "Mellissa",
    email: "mellissa@stirisk.co.za",
    role: "staff",
    passwordEnv: "MELLISSA_PASSWORD",
    aliases: ["Mellissa"],
  },
  {
    name: "Vusi",
    email: "vusi@stirisk.co.za",
    role: "staff",
    passwordEnv: "VUSI_PASSWORD",
    aliases: ["Vusi"],
  },
  {
    name: "George",
    email: "george@stirisk.co.za",
    role: "staff",
    passwordEnv: "GEORGE_PASSWORD",
    aliases: ["George"],
  },
  {
    name: "Kiril",
    email: "kiril@stirisk.co.za",
    role: "admin",
    passwordEnv: "KIRIL_PASSWORD",
    aliases: ["Kiril"],
  },
  {
    name: "Steve",
    email: "steve@stirisk.co.za",
    role: "admin",
    passwordEnv: "STEVE_PASSWORD",
    aliases: ["Steve"],
    agent: true,
  },
];

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function temporaryPassword() {
  return crypto.randomBytes(18).toString("base64url");
}

async function upsertUser(client, user, password) {
  if (user.agent && !password) {
    const result = await client.query(
      `INSERT INTO app_users (email, name, role, password_hash, auth_provider)
       VALUES ($1, $2, $3, NULL, 'agent')
       ON CONFLICT (email) DO UPDATE SET
         role = EXCLUDED.role,
         auth_provider = CASE
           WHEN app_users.auth_provider = 'microsoft' THEN app_users.auth_provider
           ELSE 'agent'
         END,
         updated_at = now()
       RETURNING id, email, name, role`,
      [user.email, user.name, user.role],
    );
    return result.rows[0];
  }

  const result = await client.query(
    `INSERT INTO app_users (email, name, role, password_hash, auth_provider)
     VALUES ($1, $2, $3, $4, 'password')
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name,
       role = EXCLUDED.role,
       password_hash = EXCLUDED.password_hash,
       auth_provider = CASE
         WHEN app_users.auth_provider = 'microsoft' THEN app_users.auth_provider
         ELSE 'password'
       END,
       updated_at = now()
     RETURNING id, email, name, role`,
    [user.email, user.name, user.role, hashPassword(password)],
  );
  return result.rows[0];
}

async function canonicalUserId(client, user) {
  const result = await client.query("SELECT id FROM app_users WHERE email = $1", [user.email]);
  return result.rows[0]?.id;
}

async function repairAssignments(client, user, userId) {
  await client.query(
    `UPDATE deals
     SET owner_id = $1, updated_at = now()
     WHERE owner_id IN (
       SELECT id FROM app_users
       WHERE lower(name) = ANY($2::text[]) OR lower(email) = $3
     )`,
    [userId, user.aliases.map((alias) => alias.toLowerCase()), user.email],
  );
  await client.query(
    `UPDATE tasks
     SET owner_id = $1, updated_at = now()
     WHERE owner_id IN (
       SELECT id FROM app_users
       WHERE lower(name) = ANY($2::text[]) OR lower(email) = $3
     )`,
    [userId, user.aliases.map((alias) => alias.toLowerCase()), user.email],
  );
  await client.query(
    `UPDATE contacts
     SET owner_id = $1, updated_at = now()
     WHERE owner_id IN (
       SELECT id FROM app_users
       WHERE lower(name) = ANY($2::text[]) OR lower(email) = $3
     )`,
    [userId, user.aliases.map((alias) => alias.toLowerCase()), user.email],
  );
}

const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();
const credentials = [];
const revealPasswords =
  process.env.NODE_ENV !== "production" || process.env.PRINT_GENERATED_PASSWORDS === "true";

try {
  await client.query("BEGIN");

  for (const user of users) {
    const providedPassword = process.env[user.passwordEnv];
    const password = providedPassword || (user.agent ? null : temporaryPassword());
    const row = await upsertUser(client, user, password);
    const userId = await canonicalUserId(client, user);
    await repairAssignments(client, user, userId);
    if (user.agent) {
      await client.query(
        `INSERT INTO agent_profiles (
          user_id, agent_key, display_name, persona, authority_model, default_context
         )
         VALUES (
          $1,
          'steve',
          'Steve',
          'Entrepreneurial STI Risk operations agent accountable to Kiril. Steve manages sales, delivery, delegations, KPIs, process adherence, recommendations, and escalations.',
          $2::jsonb,
          $3::jsonb
         )
         ON CONFLICT (agent_key) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           display_name = EXCLUDED.display_name,
           persona = EXCLUDED.persona,
           authority_model = EXCLUDED.authority_model,
           default_context = EXCLUDED.default_context,
           active = true,
           updated_at = now()`,
        [
          userId,
          JSON.stringify({
            finalEscalation: "kiril@stirisk.co.za",
            recommendationFirst: true,
            defaultDelegation: {
              lead_processing: "mellissa@stirisk.co.za",
              technical_sales_quotes_delivery: "vusi@stirisk.co.za",
              nextgrid_energy_operations: "george@stirisk.co.za",
              complex_deals_finance_executive: "kiril@stirisk.co.za",
            },
          }),
          JSON.stringify({
            doctrineEntityType: "operating_doctrine",
            doctrineSource: "STI_Risk_CloudMonkey_Onboarding_Discovery_Questionnaire (1) copy.pdf",
          }),
        ],
      );
    }
    credentials.push({
      name: row.name,
      email: row.email,
      role: row.role,
      password,
      generated: !providedPassword,
    });
  }

  await client.query(
    `INSERT INTO audit_events (actor_type, action, entity_type, metadata)
     VALUES ('system', 'ensure_staff_users', 'app_user', $1::jsonb)`,
    [
      JSON.stringify({
        users: credentials.map(({ name, email, role, generated }) => ({
          name,
          email,
          role,
          generatedPassword: generated,
        })),
      }),
    ],
  );

  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}

console.log("Ensured staff users:");
for (const credential of credentials) {
  const passwordSummary = credential.generated
    ? revealPasswords
      ? `${credential.password} (generated)`
      : "generated; set PRINT_GENERATED_PASSWORDS=true to print outside production"
    : "from env";
  console.log(
    credential.password
      ? `${credential.name} <${credential.email}> role=${credential.role} password=${passwordSummary}`
      : `${credential.name} <${credential.email}> role=${credential.role} auth=agent`,
  );
}
