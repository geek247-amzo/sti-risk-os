import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to import Pipedrive data");

const leadsFile = process.argv[2] || "/root/leads-29684860-6.csv";
const dealsFile = process.argv[3] || "/root/deals-29684860-7.csv";
const pool = new Pool({ connectionString: databaseUrl });

function parseCsv(text) {
  const rows = [];
  let row = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(current);
      current = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(current);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }

  if (current || row.length) {
    row.push(current);
    if (row.some((value) => value !== "")) rows.push(row);
  }

  const [headers, ...records] = rows;
  const seen = new Map();
  const uniqueHeaders = headers.map((header) => {
    const count = seen.get(header) ?? 0;
    seen.set(header, count + 1);
    return count === 0 ? header : `${header}__${count + 1}`;
  });

  return records.map((record) =>
    Object.fromEntries(uniqueHeaders.map((header, index) => [header, record[index] ?? ""])),
  );
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cents(value) {
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function timestamp(value) {
  const trimmed = text(value);
  if (!trimmed) return null;
  return trimmed.length === 10 ? `${trimmed} 00:00:00` : trimmed;
}

function dateOnly(value) {
  const trimmed = text(value);
  if (!trimmed) return null;
  return trimmed.slice(0, 10);
}

function currency(value) {
  const trimmed = text(value);
  return trimmed && /^[A-Z]{3}$/.test(trimmed) ? trimmed : "ZAR";
}

function splitName(name) {
  const cleaned = text(name) ?? "Unknown Contact";
  const [firstName, ...rest] = cleaned.split(/\s+/);
  return { firstName, lastName: rest.join(" ") };
}

function ownerEmail(name) {
  const slug = (text(name) ?? "pipedrive")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return `${slug || "pipedrive"}@stirisk.co.za`;
}

function dealStatus(row) {
  const raw = (text(row["Deal - Status"]) ?? "").toLowerCase();
  if (raw === "won" || row["Deal - Won time"]) return "won";
  if (raw === "lost" || row["Deal - Lost time"]) return "lost";
  return "open";
}

async function clearOperationalData(client) {
  await client.query(`
    TRUNCATE
      invoice_payments,
      invoice_lines,
      invoices,
      task_assignees,
      task_comments,
      task_stage_history,
      tasks,
      task_stages,
      task_boards,
      deliverables,
      projects,
      deal_stage_history,
      activities,
      communications,
      inbound_events,
      ai_recommendations,
      tool_calls,
      embedding_documents,
      webhook_idempotency_keys,
      deals,
      contacts,
      organizations,
      pipedrive_import_batches
    RESTART IDENTITY CASCADE
  `);
  await client.query(
    "DELETE FROM audit_events WHERE entity_type NOT IN ('app_user') OR action <> 'seed_admin'",
  );
}

async function ownerId(client, name) {
  const ownerName = text(name) ?? "Pipedrive Import";
  const email = ownerEmail(ownerName);
  const result = await client.query(
    `INSERT INTO app_users (email, name, role, password_hash, auth_provider)
     VALUES ($1, $2, 'staff', NULL, 'pipedrive_import')
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
     RETURNING id`,
    [email, ownerName],
  );
  return result.rows[0].id;
}

async function stageId(client, name, fallback = "Lead In") {
  const stageName = text(name) ?? fallback;
  const existing = await client.query("SELECT id FROM pipeline_stages WHERE name = $1", [
    stageName,
  ]);
  if (existing.rows[0]) return existing.rows[0].id;

  const next = await client.query(
    "SELECT COALESCE(max(position), 0)::int + 10 AS position FROM pipeline_stages",
  );
  const inserted = await client.query(
    `INSERT INTO pipeline_stages (name, position, is_terminal)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [stageName, next.rows[0].position, ["Won", "Lost"].includes(stageName)],
  );
  return inserted.rows[0].id;
}

async function ensureGlobalBoard(client) {
  const board = await client.query(
    "INSERT INTO task_boards (name, is_default) VALUES ('Operations Board', true) RETURNING id",
  );
  const stages = [
    ["Backlog", 10, false],
    ["Scheduled", 20, false],
    ["In Progress", 30, false],
    ["Review / QA", 40, false],
    ["Completed", 50, true],
  ];
  for (const [name, position, isTerminal] of stages) {
    await client.query(
      `INSERT INTO task_stages (board_id, name, position, is_terminal)
       VALUES ($1, $2, $3, $4)`,
      [board.rows[0].id, name, position, isTerminal],
    );
  }
  const stage = await client.query(
    "SELECT id FROM task_stages WHERE board_id = $1 AND name = 'Backlog'",
    [board.rows[0].id],
  );
  return { boardId: board.rows[0].id, backlogStageId: stage.rows[0].id };
}

async function organizationId(client, name, pipedriveId) {
  const orgName = text(name) ?? "Unassigned Organization";
  if (text(pipedriveId)) {
    const existing = await client.query("SELECT id FROM organizations WHERE pipedrive_id = $1", [
      text(pipedriveId),
    ]);
    if (existing.rows[0]) return existing.rows[0].id;

    const result = await client.query(
      `INSERT INTO organizations (name, pipedrive_id)
       VALUES ($1, $2)
       ON CONFLICT (name)
       DO UPDATE SET
         pipedrive_id = COALESCE(organizations.pipedrive_id, EXCLUDED.pipedrive_id),
         updated_at = now()
       RETURNING id`,
      [orgName, text(pipedriveId)],
    );
    return result.rows[0].id;
  }

  const result = await client.query(
    `INSERT INTO organizations (name)
     VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [orgName],
  );
  return result.rows[0].id;
}

async function contactId(client, name, pipedriveId, orgId, owner) {
  const contactName = text(name);
  if (!contactName) return null;
  const { firstName, lastName } = splitName(contactName);

  if (text(pipedriveId)) {
    const result = await client.query(
      `INSERT INTO contacts (organization_id, first_name, last_name, pipedrive_id, owner_id, status)
       VALUES ($1, $2, $3, $4, $5, 'Lead')
       ON CONFLICT (pipedrive_id) WHERE pipedrive_id IS NOT NULL
       DO UPDATE SET
         organization_id = EXCLUDED.organization_id,
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name,
         owner_id = EXCLUDED.owner_id,
         updated_at = now()
       RETURNING id`,
      [orgId, firstName, lastName, text(pipedriveId), owner],
    );
    return result.rows[0].id;
  }

  const result = await client.query(
    `INSERT INTO contacts (organization_id, first_name, last_name, owner_id, status)
     VALUES ($1, $2, $3, $4, 'Lead')
     RETURNING id`,
    [orgId, firstName, lastName, owner],
  );
  return result.rows[0].id;
}

function dealMetadata(row, kind) {
  return {
    source: "pipedrive_csv",
    kind,
    raw: row,
  };
}

async function addMemory(client, entityType, entityId, content, metadata) {
  await client.query(
    `INSERT INTO embedding_documents (entity_type, entity_id, content, metadata)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [entityType, entityId, content, JSON.stringify(metadata)],
  );
}

async function importDeal(client, row, board, counters) {
  const owner = await ownerId(client, row["Deal - Owner"] || row["Deal - Creator"]);
  const orgId = await organizationId(
    client,
    row["Deal - Organization"],
    row["Deal - Organization ID"],
  );
  const personId = await contactId(
    client,
    row["Deal - Contact person"] || row["Deal - Participants"],
    row["Deal - Contact person ID"],
    orgId,
    owner,
  );
  const stage = await stageId(client, row["Deal - Stage"], "Qualified");
  const valueCents = cents(row["Deal - Value"]) || cents(row["Deal - Weighted value"]);
  const importedStatus = dealStatus(row);
  const createdAt = timestamp(row["Deal - Deal created"]) ?? new Date().toISOString();
  const updatedAt = timestamp(row["Deal - Update time"]) ?? createdAt;
  const lastActivity = timestamp(row["Deal - Last activity date"]);
  const metadata = dealMetadata(row, "deal");
  const description = [
    text(row["Deal - Product name"]) && `Product: ${text(row["Deal - Product name"])}`,
    text(row["Deal - Lost reason"]) && `Lost reason: ${text(row["Deal - Lost reason"])}`,
    text(row["Deal - Status__2"]) && `Dial status: ${text(row["Deal - Status__2"])}`,
    text(row["Deal - Budget"]) && `Budget: ${text(row["Deal - Budget"])}`,
    text(row["Deal - Authority"]) && `Authority: ${text(row["Deal - Authority"])}`,
    text(row["Deal - Need"]) && `Need: ${text(row["Deal - Need"])}`,
    text(row["Deal - Timing"]) && `Timing: ${text(row["Deal - Timing"])}`,
  ]
    .filter(Boolean)
    .join("\n");

  const deal = await client.query(
    `INSERT INTO deals (
      organization_id, primary_contact_id, stage_id, title, value_cents, currency, source,
      service_interest, description, owner_id, status, last_activity_at,
      created_at, updated_at, pipedrive_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, 'pipedrive_csv', $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (pipedrive_id) WHERE pipedrive_id IS NOT NULL
     DO UPDATE SET
       organization_id = EXCLUDED.organization_id,
       primary_contact_id = EXCLUDED.primary_contact_id,
       stage_id = EXCLUDED.stage_id,
       title = EXCLUDED.title,
       value_cents = EXCLUDED.value_cents,
       currency = EXCLUDED.currency,
       service_interest = EXCLUDED.service_interest,
       description = EXCLUDED.description,
       owner_id = EXCLUDED.owner_id,
       status = EXCLUDED.status,
       last_activity_at = EXCLUDED.last_activity_at,
       updated_at = EXCLUDED.updated_at
     RETURNING id`,
    [
      orgId,
      personId,
      stage,
      text(row["Deal - Title"]) ?? `Pipedrive deal ${row["Deal - ID"]}`,
      valueCents,
      currency(row["Deal - Currency of Value"] || row["Deal - Currency of Weighted value"]),
      text(row["Deal - Product category"]) || text(row["Deal - Product type"]),
      description || null,
      owner,
      importedStatus,
      lastActivity,
      createdAt,
      updatedAt,
      text(row["Deal - ID"]),
    ],
  );

  await client.query(
    `INSERT INTO inbound_events (source, source_event_id, contact_id, organization_id, deal_id, payload, created_at)
     VALUES ('pipedrive_csv', $1, $2, $3, $4, $5::jsonb, $6)`,
    [text(row["Deal - ID"]), personId, orgId, deal.rows[0].id, JSON.stringify(metadata), createdAt],
  );

  await client.query(
    `INSERT INTO activities (
      deal_id, contact_id, organization_id, actor_id, type, title, body, due_at, completed_at, created_at
     )
     VALUES ($1, $2, $3, $4, 'pipedrive_import', $5, $6, $7, $8, $9)`,
    [
      deal.rows[0].id,
      personId,
      orgId,
      owner,
      `Imported Pipedrive ${importedStatus} deal`,
      description || `Pipeline: ${text(row["Deal - Pipeline"]) ?? "Pipedrive"}`,
      timestamp(row["Deal - Next activity date"]),
      lastActivity,
      createdAt,
    ],
  );

  if (timestamp(row["Deal - Next activity date"]) && importedStatus !== "lost") {
    await client.query(
      `INSERT INTO tasks (
        board_id, stage_id, deal_id, organization_id, owner_id, title, description, priority, due_at, source, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'medium', $8, 'pipedrive_csv', $9)`,
      [
        board.boardId,
        board.backlogStageId,
        deal.rows[0].id,
        orgId,
        owner,
        `Follow up: ${text(row["Deal - Title"]) ?? "Pipedrive deal"}`,
        `Imported next activity from Pipedrive. Stage: ${text(row["Deal - Stage"]) ?? "Unknown"}.`,
        timestamp(row["Deal - Next activity date"]),
        createdAt,
      ],
    );
  }

  await addMemory(
    client,
    "deal",
    deal.rows[0].id,
    [
      row["Deal - Title"],
      row["Deal - Organization"],
      row["Deal - Contact person"],
      row["Deal - Stage"],
      row["Deal - Lost reason"],
      description,
    ]
      .filter(Boolean)
      .join("\n"),
    metadata,
  );

  counters.deals += 1;
}

async function importLead(client, row, board, counters) {
  const owner = await ownerId(client, row["Lead - Owner"] || row["Lead - Creator"]);
  const orgId = await organizationId(
    client,
    row["Lead - Organization"] || row["Lead - Title"],
    row["Lead - Organization ID"],
  );
  const personId = await contactId(
    client,
    row["Lead - Contact person"],
    row["Lead - Contact person ID"],
    orgId,
    owner,
  );
  const stage = await stageId(client, "Lead In");
  const createdAt = timestamp(row["Lead - Lead created"]) ?? new Date().toISOString();
  const updatedAt = timestamp(row["Lead - Update time"]) ?? createdAt;
  const description = [
    text(row["Lead - Budget"]) && `Budget: ${text(row["Lead - Budget"])}`,
    text(row["Lead - Authority"]) && `Authority: ${text(row["Lead - Authority"])}`,
    text(row["Lead - Need"]) && `Need: ${text(row["Lead - Need"])}`,
    text(row["Lead - Timing"]) && `Timing: ${text(row["Lead - Timing"])}`,
  ]
    .filter(Boolean)
    .join("\n");
  const metadata = dealMetadata(row, "lead");

  const deal = await client.query(
    `INSERT INTO deals (
      organization_id, primary_contact_id, stage_id, title, value_cents, currency, source,
      service_interest, description, owner_id, status, last_activity_at,
      created_at, updated_at, pipedrive_id
     )
     VALUES ($1, $2, $3, $4, $5, 'ZAR', 'pipedrive_lead_csv', $6, $7, $8, 'open', $9, $10, $11, $12)
     ON CONFLICT (pipedrive_id) WHERE pipedrive_id IS NOT NULL
     DO UPDATE SET
       organization_id = EXCLUDED.organization_id,
       primary_contact_id = EXCLUDED.primary_contact_id,
       stage_id = EXCLUDED.stage_id,
       title = EXCLUDED.title,
       value_cents = EXCLUDED.value_cents,
       description = EXCLUDED.description,
       owner_id = EXCLUDED.owner_id,
       updated_at = EXCLUDED.updated_at
     RETURNING id`,
    [
      orgId,
      personId,
      stage,
      text(row["Lead - Title"]) ?? `Pipedrive lead ${row["Lead - ID"]}`,
      cents(row["Lead - Value"]),
      text(row["Lead - Product category"]) || text(row["Lead - Product type"]),
      description || null,
      owner,
      timestamp(row["Lead - Next activity date"]),
      createdAt,
      updatedAt,
      `lead:${text(row["Lead - ID"]) ?? crypto.randomUUID()}`,
    ],
  );

  await client.query(
    `INSERT INTO inbound_events (source, source_event_id, contact_id, organization_id, deal_id, payload, created_at)
     VALUES ('pipedrive_lead_csv', $1, $2, $3, $4, $5::jsonb, $6)`,
    [text(row["Lead - ID"]), personId, orgId, deal.rows[0].id, JSON.stringify(metadata), createdAt],
  );

  await client.query(
    `INSERT INTO tasks (
      board_id, stage_id, deal_id, organization_id, owner_id, title, description, priority, due_at, source, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'medium', $8, 'pipedrive_lead_csv', $9)`,
    [
      board.boardId,
      board.backlogStageId,
      deal.rows[0].id,
      orgId,
      owner,
      `Qualify lead: ${text(row["Lead - Title"]) ?? "Pipedrive lead"}`,
      `Imported from Pipedrive lead export. Source: ${text(row["Lead - Source"]) ?? "Unknown"}.`,
      timestamp(row["Lead - Next activity date"]),
      createdAt,
    ],
  );

  await addMemory(
    client,
    "deal",
    deal.rows[0].id,
    [row["Lead - Title"], row["Lead - Organization"], row["Lead - Contact person"], description]
      .filter(Boolean)
      .join("\n"),
    metadata,
  );

  counters.leads += 1;
}

const leads = parseCsv(await readFile(leadsFile, "utf8"));
const deals = parseCsv(await readFile(dealsFile, "utf8"));
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await clearOperationalData(client);
  const board = await ensureGlobalBoard(client);
  const counters = { leads: 0, deals: 0 };

  for (const row of deals) {
    if (text(row["Deal - ID"])) await importDeal(client, row, board, counters);
  }
  for (const row of leads) {
    if (text(row["Lead - ID"])) await importLead(client, row, board, counters);
  }

  const counts = await client.query(`
    SELECT
      (SELECT count(*)::int FROM organizations) AS organizations,
      (SELECT count(*)::int FROM contacts) AS contacts
  `);

  const batch = await client.query(
    `INSERT INTO pipedrive_import_batches (
      source, leads_file, deals_file, leads_imported, deals_imported,
      organizations_imported, contacts_imported, metadata
     )
     VALUES ('pipedrive_csv', $1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING id`,
    [
      path.resolve(leadsFile),
      path.resolve(dealsFile),
      counters.leads,
      counters.deals,
      counts.rows[0].organizations,
      counts.rows[0].contacts,
      JSON.stringify({ importedAt: new Date().toISOString() }),
    ],
  );

  await client.query(
    `INSERT INTO audit_events (actor_type, action, entity_type, entity_id, metadata)
     VALUES ('system', 'pipedrive_csv_import', 'pipedrive_import_batch', $1, $2::jsonb)`,
    [
      batch.rows[0].id,
      JSON.stringify({
        leadsImported: counters.leads,
        dealsImported: counters.deals,
        organizationsImported: counts.rows[0].organizations,
        contactsImported: counts.rows[0].contacts,
      }),
    ],
  );

  await client.query("COMMIT");
  console.log(
    `Imported ${counters.deals} deals, ${counters.leads} leads, ${counts.rows[0].organizations} organizations, ${counts.rows[0].contacts} contacts`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
