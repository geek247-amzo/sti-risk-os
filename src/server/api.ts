import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { PDFParse } from "pdf-parse";

const { Pool } = pg;

type User = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "staff" | "agent" | "viewer";
};

type LeadPayload = {
  source?: string;
  organizationName?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  roleTitle?: string;
  serviceInterest?: string;
  message?: string;
  estimatedValue?: number;
  referralPartner?: string;
};

type SignedWebhookVerification =
  | { ok: true; source: string; idempotencyKey: string }
  | { ok: false; response: Response };

type WhatsAppInboundPayload = {
  instanceId?: string;
  messageId?: string;
  chatId?: string;
  from?: string;
  to?: string;
  pushName?: string;
  timestamp?: string | number;
  type?: string;
  text?: string;
  raw?: unknown;
};

type WhatsAppPermissionTier = "agent" | "staff" | "admin";

type WhatsAppApprovedUser = {
  approvalId: string;
  phoneE164: string;
  status: "active" | "revoked";
  permissionTier: WhatsAppPermissionTier;
  allowedActions: string[];
  user: User;
};

let pool: pg.Pool | undefined;
let microsoftDiscoveryPromise: Promise<MicrosoftDiscovery> | undefined;

type MicrosoftDiscovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
};

type JwtHeader = {
  alg: string;
  kid: string;
};

type MicrosoftIdTokenClaims = {
  aud: string;
  exp: number;
  iat?: number;
  iss: string;
  nbf?: number;
  nonce?: string;
  oid?: string;
  sub: string;
  tid?: string;
  name?: string;
  email?: string;
  preferred_username?: string;
  upn?: string;
};

const microsoftGraphScopes = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.ReadWrite",
  "Files.ReadWrite.All",
  "Calendars.ReadWrite",
  "Contacts.ReadWrite",
] as const;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not configured");
    pool = new Pool({ connectionString });
  }
  return pool;
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function responseFromError(error: unknown) {
  if (
    error instanceof Error &&
    "status" in error &&
    Number.isFinite(Number((error as { status?: unknown }).status))
  ) {
    return json(
      { error: error.message },
      { status: Number((error as { status?: unknown }).status) || 400 },
    );
  }
  return null;
}

function redirect(location: string | URL, cookies: string[] = []) {
  const headers = new Headers({ location: String(location) });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

async function readJson(request: Request) {
  const text = await request.text();
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function unauthorized() {
  return json({ error: "Authentication required" }, { status: 401 });
}

function forbidden() {
  return json({ error: "Insufficient permissions" }, { status: 403 });
}

function parseCookies(request: Request) {
  const header = request.headers.get("cookie") ?? "";
  const cookies = new Map<string, string>();
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name) cookies.set(name, decodeURIComponent(value.join("=")));
  }
  return cookies;
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function sessionCookie(token: string, expires: Date) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `sti_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}; Expires=${expires.toUTCString()}`;
}

function clearSessionCookie() {
  return "sti_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

function oauthStateCookie(state: string, expires: Date) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `sti_ms_oauth_state=${encodeURIComponent(state)}; Path=/api/auth/microsoft; HttpOnly; SameSite=Lax${secure}; Expires=${expires.toUTCString()}`;
}

function clearOauthStateCookie() {
  return "sti_ms_oauth_state=; Path=/api/auth/microsoft; HttpOnly; SameSite=Lax; Max-Age=0";
}

function constantTimeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyPassword(password: string, encoded: string | null) {
  if (!encoded) return false;
  const [scheme, salt, expected] = encoded.split(":");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), actual);
}

function base64Url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function sha256Base64Url(input: string) {
  return base64Url(crypto.createHash("sha256").update(input).digest());
}

function tokenEncryptionKey() {
  const source = process.env.MICROSOFT_TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!source) throw new Error("MICROSOFT_TOKEN_ENCRYPTION_KEY or SESSION_SECRET is required");
  return crypto.createHash("sha256").update(source).digest();
}

function encryptToken(value: string | null | undefined) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", tokenEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptToken(value: string | null | undefined) {
  if (!value) return null;
  const [version, iv, tag, encrypted] = value.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Invalid token cipher");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    tokenEncryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function getPublicBaseUrl(request: Request) {
  return process.env.PUBLIC_BASE_URL || new URL(request.url).origin;
}

function getStaffEmailDomain() {
  return (process.env.STAFF_EMAIL_DOMAIN || "stirisk.co.za").toLowerCase();
}

function getMicrosoftTenantId() {
  return (process.env.MICROSOFT_TENANT_ID || "").trim();
}

function getMicrosoftRedirectUri(request: Request) {
  return (
    process.env.MICROSOFT_REDIRECT_URI || `${getPublicBaseUrl(request)}/api/auth/microsoft/callback`
  );
}

function requireMicrosoftConfig() {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const tenantId = getMicrosoftTenantId();
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Microsoft SSO is not configured");
  }
  if (!isMicrosoftTenantGuid(tenantId)) {
    throw new Error("Microsoft SSO must be configured with a single-tenant Entra tenant ID");
  }
  return { clientId, clientSecret, tenantId };
}

function isMicrosoftTenantGuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getMicrosoftStatus() {
  const tenantId = getMicrosoftTenantId();
  const clientId = process.env.MICROSOFT_CLIENT_ID || "";
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || "";
  const singleTenant = isMicrosoftTenantGuid(tenantId);
  const configured = Boolean(singleTenant && clientId && clientSecret);
  const missing = [
    tenantId ? null : "MICROSOFT_TENANT_ID",
    clientId ? null : "MICROSOFT_CLIENT_ID",
    clientSecret ? null : "MICROSOFT_CLIENT_SECRET",
  ].filter(Boolean);

  return {
    configured,
    mode: singleTenant ? "single_tenant" : "not_configured",
    tenantConfigured: Boolean(tenantId),
    tenantId: singleTenant ? tenantId : null,
    clientIdConfigured: Boolean(clientId),
    clientSecretConfigured: Boolean(clientSecret),
    redirectUri: process.env.MICROSOFT_REDIRECT_URI || null,
    staffEmailDomain: getStaffEmailDomain(),
    missing,
    message: configured
      ? "Microsoft SSO is configured for a single Entra tenant"
      : tenantId && !singleTenant
        ? "Set MICROSOFT_TENANT_ID to the Entra tenant GUID, not common, organizations, or consumers"
        : "Microsoft SSO is not configured",
  };
}

function decodeJwtPart<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

async function getMicrosoftDiscovery() {
  if (!microsoftDiscoveryPromise) {
    microsoftDiscoveryPromise = fetch(
      `https://login.microsoftonline.com/${getMicrosoftTenantId()}/v2.0/.well-known/openid-configuration`,
    ).then(async (response) => {
      if (!response.ok) throw new Error("Unable to load Microsoft OpenID configuration");
      return (await response.json()) as MicrosoftDiscovery;
    });
  }
  return microsoftDiscoveryPromise;
}

async function verifyMicrosoftIdToken(idToken: string, expectedNonce: string) {
  const { clientId, tenantId } = requireMicrosoftConfig();
  const [encodedHeader, encodedPayload, encodedSignature] = idToken.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("Invalid Microsoft identity token");
  }

  const header = decodeJwtPart<JwtHeader>(encodedHeader);
  const claims = decodeJwtPart<MicrosoftIdTokenClaims>(encodedPayload);
  if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported identity token");
  if (claims.aud !== clientId) throw new Error("Identity token audience mismatch");
  if (claims.nonce !== expectedNonce) throw new Error("Identity token nonce mismatch");

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now || (claims.nbf && claims.nbf > now)) {
    throw new Error("Identity token is expired or not yet valid");
  }

  if (tenantId !== "common" && tenantId !== "organizations" && tenantId !== "consumers") {
    const expectedIssuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
    if (claims.iss !== expectedIssuer) throw new Error("Identity token issuer mismatch");
  } else if (!/^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]+\/v2\.0$/.test(claims.iss)) {
    throw new Error("Identity token issuer mismatch");
  }

  const discovery = await getMicrosoftDiscovery();
  const jwks = await fetch(discovery.jwks_uri).then(async (response) => {
    if (!response.ok) throw new Error("Unable to load Microsoft signing keys");
    return (await response.json()) as { keys: JsonWebKey[] };
  });
  const jwk = jwks.keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("Microsoft signing key not found");

  const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const verified = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    key,
    Buffer.from(encodedSignature, "base64url"),
  );
  if (!verified) throw new Error("Identity token signature mismatch");

  return claims;
}

async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
  await getPool().query(
    "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [userId, hashToken(token), expires],
  );
  return { token, expires };
}

function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/staff";
  return value;
}

function getInitialAdminEmail() {
  return (process.env.INITIAL_ADMIN_EMAIL || "admin@stirisk.co.za").toLowerCase();
}

async function getSessionUser(request: Request): Promise<User | null> {
  const token = parseCookies(request).get("sti_session");
  if (!token) return null;

  const result = await getPool().query(
    `UPDATE sessions s
     SET last_seen_at = now()
     FROM app_users u
     WHERE s.user_id = u.id
       AND s.token_hash = $1
       AND s.expires_at > now()
     RETURNING u.id, u.email, u.name, u.role`,
    [hashToken(token)],
  );

  return (result.rows[0] as User | undefined) ?? null;
}

async function requireUser(
  request: Request,
  roles: User["role"][] = ["admin", "staff", "agent", "viewer"],
) {
  const user = await getSessionUser(request);
  if (!user) return { response: unauthorized() };
  if (!roles.includes(user.role)) return { response: forbidden() };
  return { user };
}

function requireText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const subcontractorChannels = ["whatsapp", "email"] as const;

type SubcontractorRateCard = {
  default_rate_cents: number | null;
  by_work_type: Record<string, number>;
};

function normalizeSubcontractorRateCard(value: unknown): SubcontractorRateCard {
  const record = asRecord(value);
  const defaultRateCents = optionalNumber(
    record.default_rate_cents ??
      record.defaultRateCents ??
      record.default_rate ??
      record.defaultRate,
  );
  const byWorkTypeSource = asRecord(
    record.by_work_type ?? record.byWorkType ?? record.work_types ?? record.workTypes,
  );
  const byWorkType: Record<string, number> = {};
  for (const [workType, amount] of Object.entries(byWorkTypeSource)) {
    const text = workType.trim();
    const cents = optionalNumber(amount);
    if (!text || cents === null) continue;
    byWorkType[text] = Math.max(0, Math.round(cents));
  }
  return {
    default_rate_cents:
      defaultRateCents === null ? null : Math.max(0, Math.round(defaultRateCents)),
    by_work_type: byWorkType,
  };
}

function requireOneOf<T extends string>(value: unknown, label: string, options: readonly T[]) {
  const text = requireText(value, label);
  if (!options.includes(text as T)) {
    throw new Error(`${label} is invalid`);
  }
  return text as T;
}

function splitName(payload: LeadPayload) {
  if (payload.firstName) {
    return {
      firstName: requireText(payload.firstName, "First name"),
      lastName: optionalText(payload.lastName) ?? "",
    };
  }
  const name = requireText((payload as { name?: string }).name, "Name");
  const [firstName, ...rest] = name.split(/\s+/);
  return { firstName, lastName: rest.join(" ") };
}

function centsFromValue(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

async function ensureTaskBoard(
  client: pg.Pool | pg.PoolClient,
  name = "Operations Board",
  projectId: string | null = null,
) {
  const existing = await client.query(
    projectId
      ? "SELECT id FROM task_boards WHERE project_id = $1 ORDER BY created_at LIMIT 1"
      : "SELECT id FROM task_boards WHERE project_id IS NULL ORDER BY is_default DESC, created_at LIMIT 1",
    projectId ? [projectId] : [],
  );

  let boardId = existing.rows[0]?.id as string | undefined;
  if (!boardId) {
    const inserted = await client.query(
      "INSERT INTO task_boards (project_id, name, is_default) VALUES ($1, $2, $3) RETURNING id",
      [projectId, name, projectId === null],
    );
    boardId = inserted.rows[0].id;
  }

  const stages = [
    ["Backlog", 10, false],
    ["Scheduled", 20, false],
    ["In Progress", 30, false],
    ["Review / QA", 40, false],
    ["Completed", 50, true],
  ] as const;

  for (const [stageName, position, isTerminal] of stages) {
    await client.query(
      `INSERT INTO task_stages (board_id, name, position, is_terminal)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (board_id, name) DO UPDATE SET
         position = EXCLUDED.position,
         is_terminal = EXCLUDED.is_terminal`,
      [boardId, stageName, position, isTerminal],
    );
  }

  const stageRows = await client.query(
    "SELECT id, name, position, is_terminal FROM task_stages WHERE board_id = $1 ORDER BY position",
    [boardId],
  );

  return { boardId, stages: stageRows.rows };
}

async function audit(
  client: pg.Pool | pg.PoolClient,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
  actor: User | null = null,
) {
  await client.query(
    `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      actor ? "user" : "system",
      actor?.id ?? null,
      action,
      entityType,
      entityId,
      JSON.stringify(metadata),
    ],
  );
}

async function getSteveProfile(client: pg.Pool | pg.PoolClient = getPool()) {
  const result = await client.query(
    `SELECT
      ap.id AS profile_id,
      ap.agent_key,
      ap.display_name,
      ap.persona,
      ap.authority_model,
      ap.default_context,
      u.id AS user_id,
      u.email,
      u.name,
      u.role
     FROM agent_profiles ap
     JOIN app_users u ON u.id = ap.user_id
     WHERE ap.agent_key = 'steve' AND ap.active = true
     LIMIT 1`,
  );
  const row = result.rows[0];
  if (!row) throw new Error("Steve agent profile is not configured");
  return {
    profileId: row.profile_id as string,
    agentKey: row.agent_key as string,
    displayName: row.display_name as string,
    persona: row.persona as string,
    authorityModel: row.authority_model as Record<string, unknown>,
    defaultContext: row.default_context as Record<string, unknown>,
    user: {
      id: row.user_id as string,
      email: row.email as string,
      name: row.name as string,
      role: row.role as User["role"],
    },
  };
}

async function logSteveTool(
  client: pg.Pool | pg.PoolClient,
  toolName: string,
  request: Record<string, unknown>,
) {
  const result = await client.query(
    `INSERT INTO tool_calls (source, tool_name, request, status)
     VALUES ('steve', $1, $2::jsonb, 'received')
     RETURNING id`,
    [toolName, JSON.stringify(request)],
  );
  return result.rows[0].id as string;
}

async function completeSteveTool(
  client: pg.Pool | pg.PoolClient,
  toolCallId: string,
  response: Record<string, unknown>,
  status = "completed",
) {
  await client.query("UPDATE tool_calls SET response = $1::jsonb, status = $2 WHERE id = $3", [
    JSON.stringify(response),
    status,
    toolCallId,
  ]);
}

function steveDelegationForText(text: string) {
  const value = text.toLowerCase();
  if (/\b(nextgrid|renewable|solar|energy|battery|inverter|pv)\b/.test(value)) {
    return {
      email: "george@stirisk.co.za",
      reason: "Nextgrid or energy-related operations support",
    };
  }
  if (
    /\b(quote|quotation|site visit|technical|onboarding|project|service|delivery|commission|handover|overrun|variation)\b/.test(
      value,
    )
  ) {
    return {
      email: "vusi@stirisk.co.za",
      reason: "Operations, technical sales, quoting, onboarding, or delivery ownership",
    };
  }
  if (
    /\b(complex|finance|payment|invoice|deposit|contract|ceo|revision|approval|unhappy|escalat)\b/.test(
      value,
    )
  ) {
    return {
      email: "kiril@stirisk.co.za",
      reason: "CEO escalation, finance, complex revision, or executive decision",
    };
  }
  return {
    email: "mellissa@stirisk.co.za",
    reason: "Default lead processing, BANT collection, warm lead follow-up, or lead admin",
  };
}

async function resolveSteveOwner(
  client: pg.Pool | pg.PoolClient,
  text: string,
  ownerEmail?: string,
) {
  const delegated = ownerEmail
    ? { email: ownerEmail, reason: "Explicit owner requested" }
    : steveDelegationForText(text);
  const owner = await client.query(
    "SELECT id, name, email FROM app_users WHERE lower(email) = lower($1) AND role IN ('admin', 'staff') LIMIT 1",
    [delegated.email],
  );
  return {
    ownerId: (owner.rows[0]?.id as string | undefined) ?? null,
    ownerName: (owner.rows[0]?.name as string | undefined) ?? null,
    ownerEmail: (owner.rows[0]?.email as string | undefined) ?? delegated.email,
    reason: delegated.reason,
  };
}

// Code is the enforced source of truth; the doctrine table is Steve's reasoning context only.
const approvalGatedSteveActions = new Set([
  "move_major_deal_stage",
  "mark_won_lost",
  "change_invoice_or_payment",
  "send_external_message",
  "expose_finance_to_partners",
  "staff_performance_decision",
  "delete_field",
  "delete_record",
  "terminal_stage_transition",
  "send_external_email",
  "send_external_whatsapp",
  "drop_table",
  "alter_table",
]);

const steveAdminEmailAllowlist = new Set(
  (process.env.STEVE_ADMIN_EMAILS ?? "admin@stirisk.co.za,kiril@stirisk.co.za")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

function isSteveAdminUser(user: User) {
  return user.role === "admin" && steveAdminEmailAllowlist.has(user.email.toLowerCase());
}

const quoteStatuses = [
  "draft",
  "pending_technical_review",
  "approved_internal",
  "sent_to_client",
  "accepted",
  "rejected",
] as const;

type QuoteStatus = (typeof quoteStatuses)[number];

const allowedQuoteTransitions: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ["pending_technical_review", "rejected"],
  pending_technical_review: ["draft", "approved_internal", "rejected"],
  approved_internal: ["sent_to_client", "rejected"],
  sent_to_client: ["accepted", "rejected"],
  accepted: [],
  rejected: ["draft"],
};

const knownQuoteFamilies = ["apollo", "ziton", "ctec", "advanced", "morley", "kentec"] as const;

type QuoteLineInput = {
  partId?: unknown;
  partCode?: unknown;
  lineType?: unknown;
  description?: unknown;
  quantity?: unknown;
  unitCost?: unknown;
  unitPrice?: unknown;
};

type QuoteTemplateRow = {
  id: string;
  name: string;
  description: string | null;
  organization_id: string | null;
  organization_name: string | null;
  site_id: string | null;
  site_name: string | null;
  source_quote_id: string | null;
  created_by_name: string | null;
  active: boolean;
  template_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

const quoteLineTypes = ["technology", "labor_travel_accommodation", "sla"] as const;

type QuoteLineType = (typeof quoteLineTypes)[number];

function normalizeQuoteLineType(line: QuoteLineInput) {
  const provided = optionalText(line.lineType);
  if (provided && quoteLineTypes.includes(provided as QuoteLineType)) {
    return provided as QuoteLineType;
  }
  if (optionalText(line.partId) || optionalText(line.partCode)) return "technology";
  return null;
}

function quantityFromValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.round(parsed * 100) / 100;
}

function quoteFamilyFromText(value: unknown) {
  const text = String(value ?? "").toLowerCase();
  return knownQuoteFamilies.find((family) => text.includes(family)) ?? null;
}

function quoteAttention(status: QuoteStatus, validationStatus?: string | null) {
  if (status === "draft") return "vusi_drafting";
  if (status === "pending_technical_review" && validationStatus !== "green")
    return "vusi_technical_review";
  if (status === "pending_technical_review" && validationStatus === "green")
    return "executive_approval";
  if (status === "approved_internal") return "ready_to_send";
  return "monitor";
}

async function quoteStructureIssue(client: pg.Pool | pg.PoolClient, quoteId: string) {
  const result = await client.query(
    `SELECT
       count(*) FILTER (WHERE line_type = 'technology')::int AS technology_count,
       count(*) FILTER (WHERE line_type = 'labor_travel_accommodation')::int AS labor_count,
       count(*) FILTER (WHERE line_type = 'sla')::int AS sla_count,
       count(*) FILTER (WHERE line_type IS NULL)::int AS untyped_count
     FROM quote_line_items
     WHERE quote_id = $1`,
    [quoteId],
  );
  const row = result.rows[0] as
    | {
        technology_count: number;
        labor_count: number;
        sla_count: number;
        untyped_count: number;
      }
    | undefined;
  if (!row) return "Quote needs line items before it can be sent";
  if (row.untyped_count > 0) return "Quote needs all line items classified before it can be sent";
  if (row.technology_count < 1) return "Quote needs a technology line before it can be sent";
  if (row.labor_count !== 1)
    return "Quote needs one labor/travel/accommodation line before it can be sent";
  if (row.sla_count !== 1) return "Quote needs one SLA line before it can be sent";
  return null;
}

function quoteNumber() {
  const date = new Date();
  const stamp = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
  return `Q-${stamp}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function lineTotals(line: QuoteLineInput, fallback?: Record<string, unknown>) {
  const quantity = quantityFromValue(line.quantity);
  const unitCostCents =
    centsFromValue(line.unitCost) || Number(fallback?.default_unit_cost_cents ?? 0);
  const unitPriceCents =
    centsFromValue(line.unitPrice) || Number(fallback?.default_unit_price_cents ?? 0);
  const totalCostCents = Math.round(unitCostCents * quantity);
  const totalPriceCents = Math.round(unitPriceCents * quantity);
  const markupPercent =
    unitCostCents > 0
      ? Math.round(((unitPriceCents - unitCostCents) / unitCostCents) * 10000) / 100
      : 0;
  return {
    quantity,
    unitCostCents,
    unitPriceCents,
    totalCostCents,
    totalPriceCents,
    markupPercent,
  };
}

async function createQuoteDraftRecord(
  client: pg.Pool | pg.PoolClient,
  actorId: string,
  body: Record<string, unknown>,
) {
  const organizationId = requireText(body.organizationId, "Organization");
  let siteId = optionalText(body.siteId);
  const siteName = optionalText(body.siteName);

  const org = await client.query("SELECT id, name FROM organizations WHERE id = $1", [
    organizationId,
  ]);
  if (!org.rows[0]) throw Object.assign(new Error("Organization not found"), { status: 404 });

  if (!siteId && siteName) {
    const site = await client.query(
      `INSERT INTO sites (organization_id, name)
       VALUES ($1, $2)
       ON CONFLICT (organization_id, name) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [organizationId, siteName],
    );
    siteId = site.rows[0].id;
  }
  if (!siteId) throw Object.assign(new Error("Site is required"), { status: 400 });

  const site = await client.query("SELECT id FROM sites WHERE id = $1 AND organization_id = $2", [
    siteId,
    organizationId,
  ]);
  if (!site.rows[0])
    throw Object.assign(new Error("Site not found for organization"), { status: 404 });

  const siteAssetFamily = optionalText(body.siteAssetFamily);
  const siteAssetManufacturer = optionalText(body.siteAssetManufacturer) ?? siteAssetFamily;
  const siteAssetModel = optionalText(body.siteAssetModel);
  const siteAssetNotes = optionalText(body.siteAssetNotes);
  if (siteAssetFamily || siteAssetManufacturer || siteAssetModel || siteAssetNotes) {
    await client.query(
      `INSERT INTO site_assets (site_id, asset_type, manufacturer, model, system_family, notes)
       VALUES ($1, 'fire_panel', $2, $3, $4, $5)`,
      [
        siteId,
        siteAssetManufacturer,
        siteAssetModel,
        siteAssetFamily?.toLowerCase() ?? quoteFamilyFromText(siteAssetManufacturer),
        siteAssetNotes,
      ],
    );
  }

  const inserted = await client.query(
    `INSERT INTO quotes (
      quote_number, organization_id, site_id, created_by, valid_until, client_reference, notes
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, quote_number`,
    [
      quoteNumber(),
      organizationId,
      siteId,
      actorId,
      optionalText(body.validUntil),
      optionalText(body.clientReference),
      optionalText(body.notes),
    ],
  );
  const quoteId = inserted.rows[0].id as string;
  await replaceQuoteLines(client, quoteId, body.lines);
  return {
    quoteId,
    quoteNumber: inserted.rows[0].quote_number as string,
    organizationId,
    siteId,
    organizationName: org.rows[0].name as string,
  };
}

async function createProjectDraftRecord(
  client: pg.Pool | pg.PoolClient,
  actorId: string,
  body: Record<string, unknown>,
) {
  const dealId = optionalText(body.dealId);
  const linkedDeal = dealId
    ? await client.query(
        `SELECT id, organization_id, owner_id, title, value_cents, currency, description
         FROM deals
         WHERE id = $1`,
        [dealId],
      )
    : null;
  if (dealId && !linkedDeal?.rows[0]) {
    throw Object.assign(new Error("Linked deal not found"), { status: 404 });
  }
  const deal = linkedDeal?.rows[0] ?? null;
  const name = optionalText(body.name) ?? deal?.title;
  if (!name) throw Object.assign(new Error("Project name is required"), { status: 400 });
  const budgetCents = centsFromValue(body.budget) || Number(deal?.value_cents ?? 0);
  const result = await client.query(
    `INSERT INTO projects (
      organization_id, deal_id, owner_id, name, status, priority, budget_cents, currency, description, due_on
     )
     VALUES ($1, $2, $3, $4, COALESCE($5, 'active'), COALESCE($6, 'medium'), $7, COALESCE($8, 'ZAR'), $9, $10)
     RETURNING id`,
    [
      body.organizationId ?? deal?.organization_id ?? null,
      dealId,
      deal?.owner_id ?? actorId,
      name,
      optionalText(body.status),
      optionalText(body.priority),
      budgetCents,
      deal?.currency ?? null,
      optionalText(body.description) ?? deal?.description ?? null,
      optionalText(body.dueOn),
    ],
  );
  if (dealId) {
    await client.query("UPDATE deals SET project_id = $1, updated_at = now() WHERE id = $2", [
      result.rows[0].id,
      dealId,
    ]);
  }
  await refreshProjectEmbedding(client, result.rows[0].id);
  return {
    projectId: result.rows[0].id as string,
    dealId,
  };
}

async function quoteTemplateSourceFromQuote(client: pg.Pool | pg.PoolClient, quoteId: string) {
  const quote = await client.query(
    `SELECT q.id, q.quote_number, q.organization_id, q.site_id, q.valid_until,
      q.client_reference, q.notes, q.currency, q.total_value_cents, q.total_cost_cents,
      q.margin_cents, q.margin_percent, q.status,
      o.name AS organization_name, s.name AS site_name, s.address AS site_address
     FROM quotes q
     JOIN organizations o ON o.id = q.organization_id
     JOIN sites s ON s.id = q.site_id
     WHERE q.id = $1`,
    [quoteId],
  );
  const row = quote.rows[0];
  if (!row) throw Object.assign(new Error("Quote not found"), { status: 404 });

  const lines = await client.query(
    `SELECT qli.part_id, qli.part_code, qli.line_type, qli.description, qli.quantity,
      qli.unit_cost_cents, qli.unit_price_cents, qli.total_cost_cents, qli.total_price_cents,
      qli.markup_percent, qli.position
     FROM quote_line_items qli
     WHERE qli.quote_id = $1
     ORDER BY qli.position, qli.created_at`,
    [quoteId],
  );

  return {
    organizationId: row.organization_id as string,
    organizationName: row.organization_name as string,
    siteId: row.site_id as string,
    siteName: row.site_name as string,
    siteAddress: row.site_address as string | null,
    validUntil: row.valid_until as string | null,
    clientReference: row.client_reference as string | null,
    notes: row.notes as string | null,
    currency: row.currency as string,
    sourceQuoteId: row.id as string,
    sourceQuoteNumber: row.quote_number as string,
    sourceQuoteStatus: row.status as string,
    totalValueCents: Number(row.total_value_cents ?? 0),
    totalCostCents: Number(row.total_cost_cents ?? 0),
    marginCents: Number(row.margin_cents ?? 0),
    marginPercent: Number(row.margin_percent ?? 0),
    lines: lines.rows,
  };
}

function quoteTemplateDataFromBody(
  body: Record<string, unknown>,
  source?: Record<string, unknown>,
) {
  const snapshot = source ?? body;
  const lines = Array.isArray(snapshot.lines)
    ? snapshot.lines
    : Array.isArray(body.lines)
      ? body.lines
      : [];
  return {
    organizationId: optionalText(snapshot.organizationId) ?? optionalText(body.organizationId),
    organizationName:
      optionalText(snapshot.organizationName) ?? optionalText(body.organizationName),
    siteId: optionalText(snapshot.siteId) ?? optionalText(body.siteId),
    siteName: optionalText(snapshot.siteName) ?? optionalText(body.siteName),
    siteAddress: optionalText(snapshot.siteAddress) ?? optionalText(body.siteAddress),
    siteAssetFamily: optionalText(snapshot.siteAssetFamily) ?? optionalText(body.siteAssetFamily),
    siteAssetManufacturer:
      optionalText(snapshot.siteAssetManufacturer) ?? optionalText(body.siteAssetManufacturer),
    siteAssetModel: optionalText(snapshot.siteAssetModel) ?? optionalText(body.siteAssetModel),
    siteAssetNotes: optionalText(snapshot.siteAssetNotes) ?? optionalText(body.siteAssetNotes),
    validUntil: optionalText(snapshot.validUntil) ?? optionalText(body.validUntil),
    clientReference: optionalText(snapshot.clientReference) ?? optionalText(body.clientReference),
    notes: optionalText(snapshot.notes) ?? optionalText(body.notes),
    currency: optionalText(snapshot.currency) ?? optionalText(body.currency) ?? "ZAR",
    sourceQuoteId: optionalText(snapshot.sourceQuoteId) ?? optionalText(body.sourceQuoteId),
    sourceQuoteNumber:
      optionalText(snapshot.sourceQuoteNumber) ?? optionalText(body.sourceQuoteNumber),
    sourceQuoteStatus:
      optionalText(snapshot.sourceQuoteStatus) ?? optionalText(body.sourceQuoteStatus),
    totalValueCents:
      optionalNumber(snapshot.totalValueCents) ?? optionalNumber(body.totalValueCents),
    totalCostCents: optionalNumber(snapshot.totalCostCents) ?? optionalNumber(body.totalCostCents),
    marginCents: optionalNumber(snapshot.marginCents) ?? optionalNumber(body.marginCents),
    marginPercent: optionalNumber(snapshot.marginPercent) ?? optionalNumber(body.marginPercent),
    lines,
  };
}

async function listQuoteTemplates(client: pg.Pool | pg.PoolClient) {
  return client.query(
    `SELECT qt.id, qt.name, qt.description, qt.organization_id,
      o.name AS organization_name, qt.site_id, s.name AS site_name,
      qt.source_quote_id, creator.name AS created_by_name,
      qt.active, qt.template_data, qt.created_at, qt.updated_at
     FROM quote_templates qt
     LEFT JOIN organizations o ON o.id = qt.organization_id
     LEFT JOIN sites s ON s.id = qt.site_id
     LEFT JOIN app_users creator ON creator.id = qt.created_by
     WHERE qt.active = true
     ORDER BY qt.updated_at DESC, qt.created_at DESC
     LIMIT 50`,
  );
}

async function createQuoteTemplateRecord(
  client: pg.Pool | pg.PoolClient,
  actorId: string,
  body: Record<string, unknown>,
) {
  const sourceQuoteId = optionalText(body.sourceQuoteId);
  const source = sourceQuoteId ? await quoteTemplateSourceFromQuote(client, sourceQuoteId) : null;
  const templateData = quoteTemplateDataFromBody(body, source ?? undefined);
  const lines = Array.isArray(templateData.lines) ? templateData.lines : [];
  if (!lines.length) throw new Error("At least one quote line item is required");

  const templateName =
    optionalText(body.name) ??
    optionalText(body.templateName) ??
    optionalText(source?.sourceQuoteNumber) ??
    optionalText(templateData.sourceQuoteNumber) ??
    "Quotation template";
  const description =
    optionalText(body.description) ??
    optionalText(templateData.notes) ??
    optionalText(source?.notes) ??
    null;

  const result = await client.query(
    `INSERT INTO quote_templates (
      name, description, organization_id, site_id, source_quote_id,
      created_by, updated_by, template_data, active
     )
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7::jsonb, true)
     RETURNING id, name`,
    [
      templateName,
      description,
      templateData.organizationId ?? source?.organizationId ?? null,
      templateData.siteId ?? source?.siteId ?? null,
      sourceQuoteId,
      actorId,
      JSON.stringify({
        ...templateData,
        name: templateName,
      }),
    ],
  );

  return {
    templateId: result.rows[0].id as string,
    templateName: result.rows[0].name as string,
  };
}

async function recalculateQuoteTotals(client: pg.Pool | pg.PoolClient, quoteId: string) {
  const totals = await client.query(
    `SELECT
       COALESCE(sum(total_cost_cents), 0)::int AS total_cost_cents,
       COALESCE(sum(total_price_cents), 0)::int AS total_value_cents
     FROM quote_line_items
     WHERE quote_id = $1`,
    [quoteId],
  );
  const totalCostCents = Number(totals.rows[0]?.total_cost_cents ?? 0);
  const totalValueCents = Number(totals.rows[0]?.total_value_cents ?? 0);
  const marginCents = totalValueCents - totalCostCents;
  const marginPercent =
    totalValueCents > 0 ? Math.round((marginCents / totalValueCents) * 10000) / 100 : 0;
  await client.query(
    `UPDATE quotes
     SET subtotal_cents = $2,
       total_cost_cents = $3,
       total_value_cents = $2,
       margin_cents = $4,
       margin_percent = $5,
       updated_at = now()
     WHERE id = $1`,
    [quoteId, totalValueCents, totalCostCents, marginCents, marginPercent],
  );
}

function centsToMoney(cents: unknown, currency = "ZAR") {
  const value = Number(cents ?? 0);
  if (!Number.isFinite(value)) return `${currency} 0.00`;
  return `${currency} ${(value / 100).toFixed(2)}`;
}

function formatEmbeddingRecord(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) {
    const items = value.map((item) => formatEmbeddingRecord(item)).filter(Boolean);
    return items.length ? items.join(", ") : null;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function replaceEmbeddingDocument(
  client: pg.Pool | pg.PoolClient,
  entityType: string,
  entityId: string,
  content: string,
  metadata: Record<string, unknown>,
  ownerAgentId: string | null = null,
) {
  await client.query("DELETE FROM embedding_documents WHERE entity_type = $1 AND entity_id = $2", [
    entityType,
    entityId,
  ]);
  await client.query(
    `INSERT INTO embedding_documents (entity_type, entity_id, owner_agent_id, content, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [entityType, entityId, ownerAgentId, content, JSON.stringify(metadata)],
  );
}

async function refreshQuoteEmbedding(client: pg.Pool | pg.PoolClient, quoteId: string) {
  const quote = await client.query(
    `SELECT q.id, q.quote_number, q.organization_id, q.site_id, q.status, q.currency, q.valid_until, q.client_reference,
      q.notes, q.subtotal_cents, q.total_cost_cents, q.total_value_cents, q.margin_cents,
      q.margin_percent, q.created_at, q.updated_at,
      o.name AS organization_name, s.name AS site_name, s.address AS site_address,
      creator.name AS created_by_name
     FROM quotes q
     JOIN organizations o ON o.id = q.organization_id
     JOIN sites s ON s.id = q.site_id
     LEFT JOIN app_users creator ON creator.id = q.created_by
     WHERE q.id = $1`,
    [quoteId],
  );
  const row = quote.rows[0];
  if (!row) throw new Error("Quote not found");

  const lines = await client.query(
    `SELECT qli.position, qli.part_code, qli.description, qli.quantity,
      qli.unit_cost_cents, qli.unit_price_cents, qli.total_cost_cents, qli.total_price_cents,
      p.manufacturer, p.system_family, p.category
     FROM quote_line_items qli
     LEFT JOIN parts p ON p.id = qli.part_id
     WHERE qli.quote_id = $1
     ORDER BY qli.position, qli.created_at`,
    [quoteId],
  );

  const lineText = lines.rows
    .map((line, index) =>
      [
        `Line ${index + 1}: ${optionalText(line.part_code) ?? "Manual line"}`,
        optionalText(line.description),
        optionalText(line.manufacturer) ? `Manufacturer: ${optionalText(line.manufacturer)}` : null,
        optionalText(line.system_family) ? `Family: ${optionalText(line.system_family)}` : null,
        optionalText(line.category) ? `Category: ${optionalText(line.category)}` : null,
        `Qty: ${Number(line.quantity ?? 0)}`,
        `Cost: ${centsToMoney(line.unit_cost_cents, row.currency)}`,
        `Price: ${centsToMoney(line.unit_price_cents, row.currency)}`,
        `Line total: ${centsToMoney(line.total_price_cents, row.currency)}`,
      ]
        .filter(Boolean)
        .join(" | "),
    )
    .join("\n");

  const content = [
    `Quote ${row.quote_number}`,
    `Organization: ${row.organization_name}`,
    `Site: ${row.site_name}`,
    row.site_address ? `Site address: ${row.site_address}` : null,
    `Status: ${row.status}`,
    row.valid_until ? `Valid until: ${row.valid_until}` : null,
    row.client_reference ? `Client reference: ${row.client_reference}` : null,
    row.notes ? `Notes: ${row.notes}` : null,
    `Subtotal: ${centsToMoney(row.subtotal_cents, row.currency)}`,
    `Total cost: ${centsToMoney(row.total_cost_cents, row.currency)}`,
    `Total value: ${centsToMoney(row.total_value_cents, row.currency)}`,
    `Margin: ${centsToMoney(row.margin_cents, row.currency)}`,
    row.margin_percent !== null && row.margin_percent !== undefined
      ? `Margin percent: ${row.margin_percent}%`
      : null,
    row.created_by_name ? `Created by: ${row.created_by_name}` : null,
    "",
    "Line items:",
    lineText || "No line items recorded",
  ]
    .filter(Boolean)
    .join("\n");

  await replaceEmbeddingDocument(client, "quote", quoteId, content, {
    quoteId,
    quoteNumber: row.quote_number,
    organizationId: row.organization_id,
    siteId: row.site_id,
    organizationName: row.organization_name,
    siteName: row.site_name,
    status: row.status,
  });
}

async function refreshProjectEmbedding(client: pg.Pool | pg.PoolClient, projectId: string) {
  const project = await client.query(
    `SELECT p.id, p.organization_id, p.deal_id, p.name, p.status, p.priority, p.budget_cents, p.currency, p.starts_on,
      p.due_on, p.description, p.created_at, p.updated_at,
      o.name AS organization_name, d.title AS deal_title, owner.name AS owner_name
     FROM projects p
     LEFT JOIN organizations o ON o.id = p.organization_id
     LEFT JOIN deals d ON d.id = p.deal_id
     LEFT JOIN app_users owner ON owner.id = p.owner_id
     WHERE p.id = $1`,
    [projectId],
  );
  const row = project.rows[0];
  if (!row) throw new Error("Project not found");

  const content = [
    `Project ${row.name}`,
    row.organization_name ? `Organization: ${row.organization_name}` : null,
    row.deal_title ? `Deal: ${row.deal_title}` : null,
    `Status: ${row.status}`,
    `Priority: ${row.priority}`,
    `Budget: ${centsToMoney(row.budget_cents, row.currency)}`,
    row.starts_on ? `Starts on: ${row.starts_on}` : null,
    row.due_on ? `Due on: ${row.due_on}` : null,
    row.description ? `Description: ${row.description}` : null,
    row.owner_name ? `Owner: ${row.owner_name}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  await replaceEmbeddingDocument(client, "project", projectId, content, {
    projectId,
    organizationId: row.organization_id,
    dealId: row.deal_id,
    organizationName: row.organization_name,
    dealTitle: row.deal_title,
    status: row.status,
    priority: row.priority,
  });
}

async function refreshFieldSubmissionEmbedding(
  client: pg.Pool | pg.PoolClient,
  fieldSubmissionId: string,
) {
  const submission = await client.query(
    `SELECT fs.id, fs.work_item_id, fs.job_link_id, fs.subcontractor_id, fs.status, fs.submitted_by_name, fs.checklist, fs.fault_notes,
      fs.recommendations, fs.quote_line_suggestions, fs.submitted_at, fs.reviewed_at,
      wi.title AS work_item_title, wi.status AS work_item_status, wi.scope AS work_item_scope,
      wi.work_type, sc.name AS subcontractor_name, sc.region AS subcontractor_region
     FROM field_submissions fs
     LEFT JOIN work_items wi ON wi.id = fs.work_item_id
     LEFT JOIN job_links jl ON jl.id = fs.job_link_id
     LEFT JOIN subcontractors sc ON sc.id = fs.subcontractor_id
     WHERE fs.id = $1`,
    [fieldSubmissionId],
  );
  const row = submission.rows[0];
  if (!row) throw new Error("Field submission not found");

  const checklistEntries = asRecord(row.checklist);
  const checklistText = Object.entries(checklistEntries)
    .map(([key, value]) => `- ${key}: ${formatEmbeddingRecord(value) ?? "n/a"}`)
    .join("\n");
  const suggestionText = Array.isArray(row.quote_line_suggestions)
    ? row.quote_line_suggestions
        .map((item: unknown, index: number) => {
          const entry = asRecord(item);
          const summary = [
            optionalText(entry.partCode) ? `Part ${optionalText(entry.partCode)}` : null,
            optionalText(entry.description),
            formatEmbeddingRecord(entry.quantity)
              ? `Qty ${formatEmbeddingRecord(entry.quantity)}`
              : null,
            optionalText(entry.note) ? `Note ${optionalText(entry.note)}` : null,
          ]
            .filter(Boolean)
            .join(" | ");
          return summary ? `${index + 1}. ${summary}` : null;
        })
        .filter(Boolean)
        .join("\n")
    : "";

  const content = [
    `Field submission ${fieldSubmissionId}`,
    row.work_item_title ? `Work item: ${row.work_item_title}` : null,
    row.work_type ? `Work type: ${row.work_type}` : null,
    row.work_item_status ? `Work item status: ${row.work_item_status}` : null,
    row.work_item_scope ? `Scope: ${row.work_item_scope}` : null,
    row.job_link_id ? `Job link id: ${row.job_link_id}` : null,
    row.subcontractor_name ? `Subcontractor: ${row.subcontractor_name}` : null,
    row.subcontractor_region ? `Subcontractor region: ${row.subcontractor_region}` : null,
    row.submitted_by_name ? `Submitted by: ${row.submitted_by_name}` : null,
    `Submission status: ${row.status}`,
    row.fault_notes ? `Fault notes: ${row.fault_notes}` : null,
    row.recommendations ? `Recommendations: ${row.recommendations}` : null,
    checklistText ? "Checklist:\n" + checklistText : null,
    suggestionText ? "Quote line suggestions:\n" + suggestionText : null,
  ]
    .filter(Boolean)
    .join("\n");

  await replaceEmbeddingDocument(client, "field_submission", fieldSubmissionId, content, {
    fieldSubmissionId,
    workItemId: row.work_item_id ?? null,
    jobLinkId: row.job_link_id ?? null,
    subcontractorId: row.subcontractor_id ?? null,
    status: row.status,
  });
}

async function refreshTaskEmbedding(client: pg.Pool | pg.PoolClient, taskId: string) {
  const task = await client.query(
    `SELECT t.id, t.board_id, t.stage_id, t.project_id, t.deliverable_id, t.deal_id,
      t.organization_id, t.owner_id, t.title, t.description, t.priority, t.status,
      t.due_at, t.completed_at, t.source, t.created_at, t.updated_at,
      ts.name AS stage_name, ts.is_terminal AS stage_is_terminal,
      u.name AS owner_name, u.email AS owner_email,
      o.name AS organization_name,
      d.title AS deal_title,
      p.name AS project_name,
      dl.title AS deliverable_title
     FROM tasks t
     LEFT JOIN task_stages ts ON ts.id = t.stage_id
     LEFT JOIN app_users u ON u.id = t.owner_id
     LEFT JOIN organizations o ON o.id = t.organization_id
     LEFT JOIN deals d ON d.id = t.deal_id
     LEFT JOIN projects p ON p.id = t.project_id
     LEFT JOIN deliverables dl ON dl.id = t.deliverable_id
     WHERE t.id = $1`,
    [taskId],
  );
  const row = task.rows[0];
  if (!row) throw new Error("Task not found");

  const comments = await client.query(
    `SELECT tc.body, tc.created_at, u.name AS author_name
     FROM task_comments tc
     LEFT JOIN app_users u ON u.id = tc.author_id
     WHERE tc.task_id = $1
     ORDER BY tc.created_at DESC
     LIMIT 5`,
    [taskId],
  );
  const history = await client.query(
    `SELECT h.created_at, actor.name AS actor_name,
      from_stage.name AS from_stage_name,
      to_stage.name AS to_stage_name
     FROM task_stage_history h
     LEFT JOIN app_users actor ON actor.id = h.actor_id
     LEFT JOIN task_stages from_stage ON from_stage.id = h.from_stage_id
     LEFT JOIN task_stages to_stage ON to_stage.id = h.to_stage_id
     WHERE h.task_id = $1
     ORDER BY h.created_at DESC
     LIMIT 10`,
    [taskId],
  );

  const content = [
    `Task ${row.title}`,
    row.description ? `Description: ${row.description}` : null,
    row.status ? `Status: ${row.status}` : null,
    row.priority ? `Priority: ${row.priority}` : null,
    row.stage_name ? `Stage: ${row.stage_name}` : null,
    row.stage_is_terminal ? `Stage terminal: yes` : null,
    row.organization_name ? `Organization: ${row.organization_name}` : null,
    row.project_name ? `Project: ${row.project_name}` : null,
    row.deal_title ? `Deal: ${row.deal_title}` : null,
    row.deliverable_title ? `Deliverable: ${row.deliverable_title}` : null,
    row.owner_name ? `Owner: ${row.owner_name}` : null,
    row.due_at ? `Due at: ${row.due_at}` : null,
    row.completed_at ? `Completed at: ${row.completed_at}` : null,
    row.source ? `Source: ${row.source}` : null,
    "",
    comments.rows.length
      ? [
          "Recent comments:",
          ...comments.rows.map((comment, index) =>
            [
              `${index + 1}.`,
              comment.created_at ? `[${comment.created_at}]` : null,
              comment.author_name ? `${comment.author_name}:` : null,
              comment.body,
            ]
              .filter(Boolean)
              .join(" "),
          ),
        ].join("\n")
      : null,
    history.rows.length
      ? [
          "Stage history:",
          ...history.rows.map((entry, index) =>
            [
              `${index + 1}.`,
              entry.created_at ? `[${entry.created_at}]` : null,
              entry.actor_name ? `${entry.actor_name}:` : null,
              [entry.from_stage_name, entry.to_stage_name].filter(Boolean).join(" -> "),
            ]
              .filter(Boolean)
              .join(" "),
          ),
        ].join("\n")
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  await replaceEmbeddingDocument(client, "task", taskId, content, {
    taskId,
    boardId: row.board_id ?? null,
    projectId: row.project_id ?? null,
    dealId: row.deal_id ?? null,
    organizationId: row.organization_id ?? null,
    stageId: row.stage_id ?? null,
    status: row.status,
    priority: row.priority,
    source: row.source,
  });
}

async function refreshServiceReportEmbedding(
  client: pg.Pool | pg.PoolClient,
  reportId: string,
  payload: Record<string, unknown>,
) {
  const organization = asRecord(payload.organization);
  const site = asRecord(payload.site);
  const workItem = asRecord(payload.workItem);
  const evidenceByPhase = asRecord(payload.evidenceByPhase);
  const findings = Array.isArray(payload.structuredFindings) ? payload.structuredFindings : [];
  const evidenceLines = ["before", "during", "after", "unclassified"]
    .flatMap((phase) => {
      const entries = Array.isArray(evidenceByPhase[phase]) ? evidenceByPhase[phase] : [];
      return entries.map((rawEntry, index) => {
        const entry = asRecord(rawEntry);
        return `${phase} evidence ${index + 1}: ${
          optionalText(entry.fileName) ?? optionalText(entry.evidenceType) ?? "file"
        }${optionalText(entry.notes) ? ` — ${optionalText(entry.notes)}` : ""}`;
      });
    });
  const findingLines = findings.map((rawFinding, index) => {
    const finding = asRecord(rawFinding);
    return [
      `${index + 1}. ${optionalText(finding.noteType) ?? "Fault Found"}`,
      optionalText(finding.location),
      optionalText(finding.issueDescription),
      optionalText(finding.remediationAction)
        ? `Remediation: ${optionalText(finding.remediationAction)}`
        : null,
    ]
      .filter(Boolean)
      .join(" | ");
  });
  const content = [
    `Service report ${reportId}`,
    organization.name ? `Organization: ${organization.name}` : null,
    site.name ? `Site: ${site.name}` : null,
    workItem.title ? `Work item: ${workItem.title}` : null,
    payload.stage ? `Stage: ${formatEmbeddingRecord(payload.stage)}` : null,
    payload.siteVisit ? `Site visit: ${formatEmbeddingRecord(payload.siteVisit)}` : null,
    evidenceLines.length ? `Evidence:\n${evidenceLines.join("\n")}` : null,
    findingLines.length ? `Structured findings:\n${findingLines.join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  await replaceEmbeddingDocument(client, "service_report", reportId, content, {
    reportId,
    organizationId: organization.id ?? null,
    siteId: site.id ?? null,
    workItemId: workItem.id ?? payload.workItemId ?? null,
    reportType: payload.reportType ?? null,
    pricingVisibility: "coordinator_only",
  });
}

async function replaceQuoteLines(client: pg.Pool | pg.PoolClient, quoteId: string, lines: unknown) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("At least one quote line item is required");
  }
  if (lines.length > 80) throw new Error("Quote line items are limited to 80 rows");

  await client.query("DELETE FROM quote_line_items WHERE quote_id = $1", [quoteId]);
  for (const [index, rawLine] of lines.entries()) {
    const line = asRecord(rawLine) as QuoteLineInput;
    const partId = optionalText(line.partId);
    const partCode = optionalText(line.partCode);
    const part = partId
      ? await client.query(
          "SELECT id, part_code, description, default_unit_cost_cents, default_unit_price_cents FROM parts WHERE id = $1 AND active = true",
          [partId],
        )
      : partCode
        ? await client.query(
            "SELECT id, part_code, description, default_unit_cost_cents, default_unit_price_cents FROM parts WHERE lower(part_code) = lower($1) AND active = true",
            [partCode],
          )
        : { rows: [] };
    const fallback = part.rows[0] as Record<string, unknown> | undefined;
    const description = optionalText(line.description) ?? optionalText(fallback?.description);
    if (!description) throw new Error(`Line ${index + 1} description is required`);
    const totals = lineTotals(line, fallback);
    const lineType = normalizeQuoteLineType(line);
    await client.query(
      `INSERT INTO quote_line_items (
        quote_id, part_id, part_code, line_type, description, quantity, unit_cost_cents,
        unit_price_cents, total_cost_cents, total_price_cents, markup_percent, position
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        quoteId,
        fallback?.id ?? null,
        optionalText(fallback?.part_code) ?? partCode,
        lineType,
        description,
        totals.quantity,
        totals.unitCostCents,
        totals.unitPriceCents,
        totals.totalCostCents,
        totals.totalPriceCents,
        totals.markupPercent,
        index + 1,
      ],
    );
  }
  await recalculateQuoteTotals(client, quoteId);
  await refreshQuoteEmbedding(client, quoteId);
}

async function createLead(payload: LeadPayload, actor: User | null = null) {
  const organizationName = requireText(payload.organizationName, "Organization name");
  const { firstName, lastName } = splitName(payload);
  const email = optionalText(payload.email);
  const phone = optionalText(payload.phone);
  const serviceInterest = optionalText(payload.serviceInterest) ?? "Industrial risk consultation";
  const message = optionalText(payload.message) ?? "";
  const source = optionalText(payload.source) ?? "public_form";
  const roleTitle = optionalText(payload.roleTitle);
  const referralPartner = optionalText(payload.referralPartner);
  const valueCents = centsFromValue(payload.estimatedValue);

  if (!email && !phone) throw new Error("Email or phone is required");

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const org = await client.query(
      `INSERT INTO organizations (name)
       VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET updated_at = now()
       RETURNING id, name`,
      [organizationName],
    );

    const owner = await client.query(
      "SELECT id FROM app_users WHERE role IN ('admin', 'staff') ORDER BY created_at LIMIT 1",
    );
    const ownerId = owner.rows[0]?.id ?? null;

    const contact = email
      ? await client.query(
          `INSERT INTO contacts (organization_id, first_name, last_name, email, phone, role_title, owner_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (email) DO UPDATE SET
             organization_id = EXCLUDED.organization_id,
             first_name = EXCLUDED.first_name,
             last_name = EXCLUDED.last_name,
             phone = COALESCE(EXCLUDED.phone, contacts.phone),
             role_title = COALESCE(EXCLUDED.role_title, contacts.role_title),
             updated_at = now()
           RETURNING id, first_name, last_name, email`,
          [org.rows[0].id, firstName, lastName, email, phone, roleTitle, ownerId],
        )
      : await client.query(
          `INSERT INTO contacts (organization_id, first_name, last_name, phone, role_title, owner_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, first_name, last_name, email`,
          [org.rows[0].id, firstName, lastName, phone, roleTitle, ownerId],
        );

    const leadStage = await client.query(
      "SELECT id FROM pipeline_stages WHERE name = 'Lead In' LIMIT 1",
    );
    if (!leadStage.rows[0]) throw new Error("Lead In pipeline stage is missing");

    const title = `${organizationName} - ${serviceInterest}`;
    const deal = await client.query(
      `INSERT INTO deals (
        organization_id, primary_contact_id, stage_id, title, value_cents, source,
        service_interest, description, owner_id, last_activity_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       RETURNING id, title`,
      [
        org.rows[0].id,
        contact.rows[0].id,
        leadStage.rows[0].id,
        title,
        valueCents,
        source,
        serviceInterest,
        message,
        ownerId,
      ],
    );

    await client.query(
      `INSERT INTO communications (deal_id, contact_id, organization_id, direction, channel, subject, body, summary)
       VALUES ($1, $2, $3, 'inbound', $4, $5, $6, $7)`,
      [
        deal.rows[0].id,
        contact.rows[0].id,
        org.rows[0].id,
        source.includes("referral") ? "referral_form" : "web_form",
        title,
        message,
        message.slice(0, 240),
      ],
    );

    const inbound = await client.query(
      `INSERT INTO inbound_events (source, source_event_id, contact_id, organization_id, deal_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id`,
      [
        source,
        crypto.randomUUID(),
        contact.rows[0].id,
        org.rows[0].id,
        deal.rows[0].id,
        JSON.stringify(payload),
      ],
    );

    await client.query(
      `INSERT INTO activities (deal_id, contact_id, organization_id, actor_id, type, title, body)
       VALUES ($1, $2, $3, $4, 'lead_capture', $5, $6)`,
      [
        deal.rows[0].id,
        contact.rows[0].id,
        org.rows[0].id,
        actor?.id ?? ownerId,
        "New lead captured",
        referralPartner ? `Referred by ${referralPartner}. ${message}` : message,
      ],
    );

    const recommendation = await client.query(
      `INSERT INTO ai_recommendations (
        deal_id, contact_id, organization_id, recommendation_type, title, body, payload
       )
       VALUES ($1, $2, $3, 'next_action', $4, $5, $6::jsonb)
       RETURNING id`,
      [
        deal.rows[0].id,
        contact.rows[0].id,
        org.rows[0].id,
        "Draft first response and qualification steps",
        `Prepare a first response for ${firstName} and qualify urgency, site type, assets at risk, and desired inspection date before proposing next steps.`,
        JSON.stringify({ source, serviceInterest, requiresHumanApproval: true }),
      ],
    );

    const board = await ensureTaskBoard(client);
    const backlog = board.stages.find((stage) => stage.name === "Backlog") ?? board.stages[0];
    const task = await client.query(
      `INSERT INTO tasks (
        board_id, stage_id, deal_id, organization_id, owner_id, title, description, priority, due_at, source
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'high', now() + interval '2 days', $8)
       RETURNING id`,
      [
        board.boardId,
        backlog.id,
        deal.rows[0].id,
        org.rows[0].id,
        ownerId,
        `Qualify ${organizationName}`,
        `Follow up with ${firstName} about ${serviceInterest}. ${message}`.trim(),
        source,
      ],
    );

    await client.query(
      `INSERT INTO embedding_documents (entity_type, entity_id, content, metadata)
       VALUES ('deal', $1, $2, $3::jsonb)`,
      [
        deal.rows[0].id,
        [organizationName, firstName, lastName, serviceInterest, message]
          .filter(Boolean)
          .join("\n"),
        JSON.stringify({ source, organizationName, serviceInterest }),
      ],
    );

    await audit(
      client,
      "lead_capture",
      "deal",
      deal.rows[0].id,
      { source, inboundEventId: inbound.rows[0].id, taskId: task.rows[0].id },
      actor,
    );
    await client.query("COMMIT");

    return {
      organization: org.rows[0],
      contact: contact.rows[0],
      deal: deal.rows[0],
      inboundEventId: inbound.rows[0].id,
      recommendationId: recommendation.rows[0].id,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function startMicrosoftLogin(request: Request) {
  let config: ReturnType<typeof requireMicrosoftConfig>;
  try {
    config = requireMicrosoftConfig();
  } catch {
    return redirect(new URL("/staff/login?error=sso_config", request.url), [
      clearOauthStateCookie(),
    ]);
  }
  const { clientId } = config;
  const discovery = await getMicrosoftDiscovery();
  const url = new URL(request.url);
  const state = crypto.randomBytes(32).toString("base64url");
  const nonce = crypto.randomBytes(32).toString("base64url");
  const codeVerifier = crypto.randomBytes(64).toString("base64url");
  const expires = new Date(Date.now() + 1000 * 60 * 10);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));

  await getPool().query("DELETE FROM oauth_states WHERE expires_at < now()");
  await getPool().query(
    `INSERT INTO oauth_states (state, code_verifier, nonce, return_to, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [state, codeVerifier, nonce, returnTo, expires],
  );

  const authorizationUrl = new URL(discovery.authorization_endpoint);
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("redirect_uri", getMicrosoftRedirectUri(request));
  authorizationUrl.searchParams.set("response_mode", "query");
  authorizationUrl.searchParams.set("scope", microsoftGraphScopes.join(" "));
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("nonce", nonce);
  authorizationUrl.searchParams.set("code_challenge", sha256Base64Url(codeVerifier));
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("prompt", "select_account");

  return redirect(authorizationUrl, [oauthStateCookie(state, expires)]);
}

async function microsoftAuthStatus(request: Request) {
  const status = getMicrosoftStatus();
  return json({
    ...status,
    redirectUri: status.redirectUri || `${getPublicBaseUrl(request)}/api/auth/microsoft/callback`,
  });
}

async function microsoftHealth(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  const status = getMicrosoftStatus();
  if (!status.configured) {
    return json({
      ...status,
      discoveryReachable: false,
    });
  }

  try {
    const discovery = await getMicrosoftDiscovery();
    return json({
      ...status,
      discoveryReachable: true,
      authorizationEndpoint: discovery.authorization_endpoint,
    });
  } catch (error) {
    return json({
      ...status,
      configured: true,
      discoveryReachable: false,
      error: error instanceof Error ? error.message : "Microsoft discovery failed",
    });
  }
}

async function getMicrosoftAccessToken(user: User) {
  const result = await getPool().query(
    `SELECT scopes, access_token_cipher, refresh_token_cipher, expires_at
     FROM microsoft_user_tokens
     WHERE user_id = $1`,
    [user.id],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Microsoft Graph is not connected for this user");
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  const currentAccessToken = decryptToken(row.access_token_cipher);
  if (currentAccessToken && expiresAt > Date.now() + 120_000) return currentAccessToken;

  const refreshToken = decryptToken(row.refresh_token_cipher);
  if (!refreshToken) throw new Error("Microsoft refresh token is missing; sign in again");

  const { clientId, clientSecret } = requireMicrosoftConfig();
  const discovery = await getMicrosoftDiscovery();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: microsoftGraphScopes.join(" "),
  });
  const response = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokenBody = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error_description?: string;
  };
  if (!response.ok || !tokenBody.access_token) {
    throw new Error(tokenBody.error_description ?? "Microsoft token refresh failed");
  }
  const expires = new Date(Date.now() + Math.max(60, tokenBody.expires_in ?? 3600) * 1000);
  await getPool().query(
    `UPDATE microsoft_user_tokens
     SET access_token_cipher = $1,
         refresh_token_cipher = COALESCE($2, refresh_token_cipher),
         scopes = $3,
         expires_at = $4,
         updated_at = now()
     WHERE user_id = $5`,
    [
      encryptToken(tokenBody.access_token),
      encryptToken(tokenBody.refresh_token),
      (tokenBody.scope ?? microsoftGraphScopes.join(" ")).split(/\s+/).filter(Boolean),
      expires,
      user.id,
    ],
  );
  return tokenBody.access_token;
}

async function microsoftGraphRequest<T>(
  user: User,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getMicrosoftAccessToken(user);
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
      authorization: `Bearer ${token}`,
    },
  });
  const text = await response.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text };
    }
  }
  if (!response.ok) {
    const record = asRecord(body);
    const error = asRecord(record.error);
    throw new Error(
      optionalText(error.message) ?? optionalText(record.error) ?? "Microsoft Graph request failed",
    );
  }
  return body as T;
}

async function microsoftGraphStatus(request: Request) {
  const auth = await requireUser(request, ["admin", "staff", "agent"]);
  if (auth.response) return auth.response;
  const result = await getPool().query(
    "SELECT scopes, expires_at, updated_at FROM microsoft_user_tokens WHERE user_id = $1",
    [auth.user.id],
  );
  const row = result.rows[0];
  return json({
    connected: Boolean(row),
    scopes: row?.scopes ?? [],
    expiresAt: row?.expires_at ?? null,
    updatedAt: row?.updated_at ?? null,
  });
}

async function microsoftEmails(request: Request) {
  const auth = await requireUser(request, ["admin", "staff", "agent"]);
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const top = Math.min(25, Math.max(5, Number(url.searchParams.get("top") ?? 12)));
  const data = await microsoftGraphRequest<{ value?: Record<string, unknown>[] }>(
    auth.user,
    `/me/mailFolders/inbox/messages?$top=${top}&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,bodyPreview,isRead,webLink,importance`,
  );
  return json({ emails: data.value ?? [] });
}

async function microsoftEmailDetail(request: Request, messageId: string) {
  const auth = await requireUser(request, ["admin", "staff", "agent"]);
  if (auth.response) return auth.response;
  const encodedId = encodeURIComponent(messageId);
  const email = await microsoftGraphRequest<Record<string, unknown>>(
    auth.user,
    `/me/messages/${encodedId}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,body,bodyPreview,isRead,webLink,importance,hasAttachments`,
  );
  return json({ email });
}

async function microsoftDocs(request: Request) {
  const auth = await requireUser(request, ["admin", "staff", "agent"]);
  if (auth.response) return auth.response;
  const data = await microsoftGraphRequest<{ value?: Record<string, unknown>[] }>(
    auth.user,
    "/me/drive/recent?$top=25",
  );
  return json({ docs: data.value ?? [] });
}

function oneDrivePathSegment(value: string) {
  return value
    .replace(/[<>:"\\|?*]/g, " ")
    .split("")
    .filter((char) => char.charCodeAt(0) >= 32)
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function oneDriveUploadPath(folderPath: string | undefined, filename: string) {
  const folderSegments = (folderPath || "STI Risk OS Chat Uploads")
    .split("/")
    .map(oneDrivePathSegment)
    .filter(Boolean);
  const cleanFilename = oneDrivePathSegment(filename) || `upload-${Date.now()}`;
  return [...folderSegments, cleanFilename].map(encodeURIComponent).join("/");
}

async function uploadBufferToOneDrive(
  user: User,
  buffer: Buffer,
  filename: string,
  folderPath?: string,
  mimeType?: string,
) {
  const uploadPath = oneDriveUploadPath(folderPath, filename);
  return microsoftGraphRequest<Record<string, unknown>>(
    user,
    `/me/drive/root:/${uploadPath}:/content`,
    {
      method: "PUT",
      headers: mimeType ? { "content-type": mimeType } : undefined,
      body: buffer,
    },
  );
}

async function microsoftDraftEmail(request: Request) {
  const auth = await requireUser(request, ["admin", "staff", "agent"]);
  if (auth.response) return auth.response;
  const body = asRecord(await readJson(request));
  const draft = await createMicrosoftEmailDraft(auth.user, body);
  return json({ draft }, { status: 201 });
}

async function createMicrosoftEmailDraft(user: User, body: Record<string, unknown>) {
  const to = Array.isArray(body.to) ? body.to : [body.to].filter(Boolean);
  const recipients = to
    .map((value) => optionalText(value))
    .filter((value): value is string => Boolean(value))
    .map((address) => ({ emailAddress: { address } }));
  if (!recipients.length) throw new Error("At least one recipient is required");
  const subject = requireText(body.subject, "Subject");
  const content = requireText(body.body, "Body");
  const draft = await microsoftGraphRequest<Record<string, unknown>>(user, "/me/messages", {
    method: "POST",
    body: JSON.stringify({
      subject,
      body: { contentType: "HTML", content },
      toRecipients: recipients,
    }),
  });
  await audit(
    getPool(),
    "microsoft_email_draft_created",
    "app_user",
    user.id,
    { subject, recipientCount: recipients.length, graphMessageId: draft.id ?? null },
    user,
  );
  return draft;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function textToHtml(value: string) {
  return escapeHtml(value)
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

function inferRecipientName(recipients: string[]) {
  const first = recipients[0]?.split("@")[0]?.split(/[._-]/)[0];
  if (!first) return "";
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}`;
}

function localSteveEmailDraft({
  user,
  recipients,
  desiredSubject,
  prompt,
  tone,
  agentContent,
}: {
  user: User;
  recipients: string[];
  desiredSubject?: string;
  prompt: string;
  tone?: string;
  agentContent?: string;
}) {
  if (agentContent?.trim() && agentContent.trim().length > 80) {
    return {
      subject: desiredSubject ?? "Following up from STI Risk",
      bodyText: agentContent.trim(),
      bodyHtml: textToHtml(agentContent.trim()),
    };
  }

  const recipientName = inferRecipientName(recipients);
  const greeting = recipientName ? `Hi ${recipientName},` : "Hi,";
  const selectedTone = (tone || "professional").toLowerCase();
  const subject =
    desiredSubject ||
    (prompt.toLowerCase().includes("introduction")
      ? "Introducing STI Risk"
      : "A quick note from STI Risk");
  const toneLine =
    selectedTone === "warm"
      ? "I hope you are well."
      : selectedTone === "direct"
        ? "I wanted to introduce STI Risk briefly."
        : "I hope you are doing well.";

  const bodyText = [
    greeting,
    "",
    toneLine,
    "",
    "STI Risk helps organisations strengthen operational resilience through practical, engineering-led risk solutions across fire safety, security, power continuity, sensing, and digital monitoring. The focus is not just supplying equipment, but helping clients understand their risk exposure, implement the right controls, and keep critical sites operating with fewer surprises.",
    "",
    "Where we usually add value is in bringing technical site understanding, lifecycle support, and clear execution together. That can include assessments, compliance-driven recommendations, system upgrades, project delivery, maintenance planning, and support for teams that need reliable information before making operational decisions.",
    "",
    "I thought it would be useful to introduce STI Risk and explore whether there is a practical way we could support you or your team, either now or when a relevant requirement comes up.",
    "",
    "If it would be useful, I would be happy to set up a short conversation and understand where your current priorities are.",
    "",
    "Regards,",
    user.name,
  ].join("\n");

  const bodyHtml = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>${escapeHtml(toneLine)}</p>`,
    "<p>STI Risk helps organisations strengthen operational resilience through practical, engineering-led risk solutions across <strong>fire safety, security, power continuity, sensing, and digital monitoring</strong>. The focus is not just supplying equipment, but helping clients understand their risk exposure, implement the right controls, and keep critical sites operating with fewer surprises.</p>",
    "<p>Where we usually add value is in bringing technical site understanding, lifecycle support, and clear execution together. That can include assessments, compliance-driven recommendations, system upgrades, project delivery, maintenance planning, and support for teams that need reliable information before making operational decisions.</p>",
    "<p>I thought it would be useful to introduce STI Risk and explore whether there is a practical way we could support you or your team, either now or when a relevant requirement comes up.</p>",
    "<p>If it would be useful, I would be happy to set up a short conversation and understand where your current priorities are.</p>",
    `<p>Regards,<br />${escapeHtml(user.name)}</p>`,
  ].join("\n");

  return { subject, bodyText, bodyHtml };
}

function extractJsonObject(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? trimmed;
  try {
    return asRecord(JSON.parse(candidate));
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return asRecord(JSON.parse(candidate.slice(start, end + 1)));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function generateEmailDraftWithSteve(
  user: User,
  input: Record<string, unknown>,
  mode: "create" | "edit",
) {
  const to = Array.isArray(input.to) ? input.to : [input.to].filter(Boolean);
  const recipients = to
    .map((value) => optionalText(value))
    .filter((value): value is string => Boolean(value));
  const desiredSubject = optionalText(input.subject);
  const prompt = requireText(input.prompt ?? input.instructions, "Instructions");
  const sourceEmailId = optionalText(input.sourceEmailId);
  let sourceEmail: Record<string, unknown> | null = null;

  if (sourceEmailId) {
    try {
      sourceEmail = await microsoftGraphRequest<Record<string, unknown>>(
        user,
        `/me/messages/${encodeURIComponent(sourceEmailId)}?$select=id,subject,from,toRecipients,receivedDateTime,body,bodyPreview`,
      );
    } catch (error) {
      sourceEmail = {
        error: error instanceof Error ? error.message : "Unable to load source email",
      };
    }
  }

  const systemInstructions = [
    "You are Steve, drafting an Outlook email for the signed-in STI Risk staff user.",
    "Return only JSON with keys: to, subject, bodyHtml, bodyText, summary.",
    "bodyHtml must be clean email-safe HTML using paragraphs, lists, and bold text where useful.",
    "Do not claim the email was sent. The user will review and approve before it becomes an Outlook draft.",
  ].join("\n");

  let agentError: string | null = null;
  let agentContent = "";
  try {
    const agent = await staffAgentRequest<{
      message?: { role?: string; content?: string };
      draft?: Record<string, unknown>;
      emailDraft?: Record<string, unknown>;
    }>(
      {
        task: "microsoft_email_draft",
        mode,
        user,
        systemInstructions,
        prompt,
        requested: {
          to: recipients,
          subject: desiredSubject,
          tone: optionalText(input.tone),
          sourceEmailId,
          sourceEmail,
          currentDraft: asRecord(input.currentDraft),
        },
      },
      user,
    );
    const structured = asRecord(agent.draft ?? agent.emailDraft);
    if (Object.keys(structured).length) {
      return {
        to: Array.isArray(structured.to) ? structured.to.map(String) : recipients,
        subject: optionalText(structured.subject) ?? desiredSubject ?? "Draft email",
        bodyHtml:
          optionalText(structured.bodyHtml) ??
          textToHtml(
            optionalText(structured.bodyText) ?? optionalText(agent.message?.content) ?? "",
          ),
        bodyText:
          optionalText(structured.bodyText) ??
          optionalText(structured.bodyHtml)?.replace(/<[^>]+>/g, " ") ??
          optionalText(agent.message?.content) ??
          "",
        summary: optionalText(structured.summary),
        metadata: { source: "n8n_steve_agent", raw: structured },
      };
    }
    agentContent = optionalText(agent.message?.content) ?? "";
    const parsed = agentContent ? extractJsonObject(agentContent) : null;
    if (parsed) {
      return {
        to: Array.isArray(parsed.to) ? parsed.to.map(String) : recipients,
        subject: optionalText(parsed.subject) ?? desiredSubject ?? "Draft email",
        bodyHtml:
          optionalText(parsed.bodyHtml) ??
          textToHtml(optionalText(parsed.bodyText) ?? agentContent.replace(/```[\s\S]*?```/g, "")),
        bodyText:
          optionalText(parsed.bodyText) ??
          optionalText(parsed.bodyHtml)?.replace(/<[^>]+>/g, " ") ??
          agentContent,
        summary: optionalText(parsed.summary),
        metadata: { source: "n8n_steve_agent", raw: parsed },
      };
    }
  } catch (error) {
    agentError = error instanceof Error ? error.message : "Steve email draft failed";
  }

  const fallback = localSteveEmailDraft({
    user,
    recipients,
    desiredSubject,
    prompt,
    tone: optionalText(input.tone),
    agentContent,
  });

  return {
    to: recipients,
    subject: fallback.subject,
    bodyHtml: fallback.bodyHtml,
    bodyText: fallback.bodyText,
    summary: agentError
      ? `Polished local draft created because Steve/n8n was unavailable: ${agentError}`
      : "Polished local draft created because Steve/n8n did not return a structured email.",
    metadata: { source: "local_steve_fallback", agentError },
  };
}

async function microsoftAiEmailDrafts(request: Request) {
  const auth = await requireUser(request, ["admin", "staff", "agent"]);
  if (auth.response) return auth.response;

  if (request.method === "GET") {
    const rows = await getPool().query(
      `SELECT id, to_recipients, subject, body_html, body_text, status, source_email_id,
        outlook_message_id, prompt, edit_instructions, metadata, created_at, updated_at, approved_at
       FROM microsoft_email_drafts
       WHERE user_id = $1 AND status <> 'archived'
       ORDER BY updated_at DESC
       LIMIT 100`,
      [auth.user.id],
    );
    return json({ drafts: rows.rows });
  }

  const body = asRecord(await readJson(request));
  const generated = await generateEmailDraftWithSteve(auth.user, body, "create");
  const result = await getPool().query(
    `INSERT INTO microsoft_email_drafts (
      user_id, to_recipients, subject, body_html, body_text, status, source_email_id, prompt, metadata
     )
     VALUES ($1, $2, $3, $4, $5, 'ai_draft', $6, $7, $8::jsonb)
     RETURNING id, to_recipients, subject, body_html, body_text, status, source_email_id,
       outlook_message_id, prompt, edit_instructions, metadata, created_at, updated_at, approved_at`,
    [
      auth.user.id,
      generated.to,
      generated.subject,
      generated.bodyHtml,
      generated.bodyText,
      optionalText(body.sourceEmailId),
      requireText(body.prompt ?? body.instructions, "Instructions"),
      JSON.stringify({ ...generated.metadata, summary: generated.summary }),
    ],
  );
  await audit(
    getPool(),
    "microsoft_ai_email_draft_created",
    "microsoft_email_draft",
    result.rows[0].id,
    { source: result.rows[0].metadata?.source ?? null },
    auth.user,
  );
  return json({ draft: result.rows[0] }, { status: 201 });
}

async function microsoftAiEmailDraftDetail(request: Request, draftId: string) {
  const auth = await requireUser(request, ["admin", "staff", "agent"]);
  if (auth.response) return auth.response;

  if (request.method === "PATCH") {
    const body = asRecord(await readJson(request));
    const current = await getPool().query(
      `SELECT id, to_recipients, subject, body_html, body_text, source_email_id, prompt, metadata
       FROM microsoft_email_drafts
       WHERE id = $1 AND user_id = $2 AND status <> 'archived'`,
      [draftId, auth.user.id],
    );
    if (!current.rows[0]) return json({ error: "Draft not found" }, { status: 404 });
    const instructions = requireText(body.instructions, "Edit instructions");
    const generated = await generateEmailDraftWithSteve(
      auth.user,
      {
        ...body,
        to: current.rows[0].to_recipients,
        subject: current.rows[0].subject,
        prompt: instructions,
        sourceEmailId: current.rows[0].source_email_id,
        currentDraft: {
          subject: current.rows[0].subject,
          bodyHtml: current.rows[0].body_html,
          bodyText: current.rows[0].body_text,
        },
      },
      "edit",
    );
    const updated = await getPool().query(
      `UPDATE microsoft_email_drafts
       SET to_recipients = $1,
           subject = $2,
           body_html = $3,
           body_text = $4,
           status = 'needs_edits',
           edit_instructions = $5,
           metadata = metadata || $6::jsonb,
           updated_at = now()
       WHERE id = $7 AND user_id = $8
       RETURNING id, to_recipients, subject, body_html, body_text, status, source_email_id,
         outlook_message_id, prompt, edit_instructions, metadata, created_at, updated_at, approved_at`,
      [
        generated.to.length ? generated.to : current.rows[0].to_recipients,
        generated.subject,
        generated.bodyHtml,
        generated.bodyText,
        instructions,
        JSON.stringify({ lastEdit: generated.metadata, lastEditSummary: generated.summary }),
        draftId,
        auth.user.id,
      ],
    );
    await audit(
      getPool(),
      "microsoft_ai_email_draft_edited",
      "microsoft_email_draft",
      draftId,
      {},
      auth.user,
    );
    return json({ draft: updated.rows[0] });
  }

  if (request.method === "DELETE") {
    await getPool().query(
      "UPDATE microsoft_email_drafts SET status = 'archived', updated_at = now() WHERE id = $1 AND user_id = $2",
      [draftId, auth.user.id],
    );
    return json({ ok: true });
  }

  return json({ error: "Not found" }, { status: 404 });
}

async function microsoftAiEmailDraftApprove(request: Request, draftId: string) {
  const auth = await requireUser(request, ["admin", "staff", "agent"]);
  if (auth.response) return auth.response;
  const result = await getPool().query(
    `SELECT id, to_recipients, subject, body_html
     FROM microsoft_email_drafts
     WHERE id = $1 AND user_id = $2 AND status <> 'archived'`,
    [draftId, auth.user.id],
  );
  const row = result.rows[0];
  if (!row) return json({ error: "Draft not found" }, { status: 404 });
  const draft = await createMicrosoftEmailDraft(auth.user, {
    to: row.to_recipients,
    subject: row.subject,
    body: row.body_html,
  });
  const updated = await getPool().query(
    `UPDATE microsoft_email_drafts
     SET status = 'outlook_created',
         outlook_message_id = $1,
         approved_at = now(),
         updated_at = now(),
         metadata = metadata || $2::jsonb
     WHERE id = $3 AND user_id = $4
     RETURNING id, to_recipients, subject, body_html, body_text, status, source_email_id,
       outlook_message_id, prompt, edit_instructions, metadata, created_at, updated_at, approved_at`,
    [optionalText(draft.id), JSON.stringify({ outlookDraft: draft }), draftId, auth.user.id],
  );
  await audit(
    getPool(),
    "microsoft_ai_email_draft_approved",
    "microsoft_email_draft",
    draftId,
    { graphMessageId: draft.id ?? null },
    auth.user,
  );
  return json({ draft: updated.rows[0], outlookDraft: draft });
}

type MicrosoftAgentMemory = {
  connected: boolean;
  scopes: string[];
  expiresAt: string | null;
  updatedAt: string | null;
  capabilities: string[];
  recentEmails: Record<string, unknown>[];
  recentDocs: Record<string, unknown>[];
  error?: string;
};

async function microsoftAgentMemory(user: User): Promise<MicrosoftAgentMemory> {
  const result = await getPool().query(
    "SELECT scopes, expires_at, updated_at FROM microsoft_user_tokens WHERE user_id = $1",
    [user.id],
  );
  const row = result.rows[0];
  const base: MicrosoftAgentMemory = {
    connected: Boolean(row),
    scopes: row?.scopes ?? [],
    expiresAt: row?.expires_at ?? null,
    updatedAt: row?.updated_at ?? null,
    capabilities: row
      ? [
          "read_recent_outlook_email",
          "search_outlook_email_from_available_graph_context",
          "create_outlook_email_draft",
          "read_recent_onedrive_documents",
          "link_onedrive_documents_to_chat_context",
        ]
      : [],
    recentEmails: [],
    recentDocs: [],
  };

  if (!row) return base;

  const [emails, docs] = await Promise.allSettled([
    microsoftGraphRequest<{ value?: Record<string, unknown>[] }>(
      user,
      "/me/mailFolders/inbox/messages?$top=6&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,bodyPreview,isRead,webLink,importance",
    ),
    microsoftGraphRequest<{ value?: Record<string, unknown>[] }>(user, "/me/drive/recent?$top=6"),
  ]);

  if (emails.status === "fulfilled") base.recentEmails = emails.value.value ?? [];
  if (docs.status === "fulfilled") base.recentDocs = docs.value.value ?? [];
  const errors = [emails, docs]
    .filter((item): item is PromiseRejectedResult => item.status === "rejected")
    .map((item) => (item.reason instanceof Error ? item.reason.message : "Microsoft Graph failed"));
  if (errors.length) base.error = errors.join("; ");
  return base;
}

async function handleMicrosoftCallback(request: Request) {
  const { clientId, clientSecret } = requireMicrosoftConfig();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = parseCookies(request).get("sti_ms_oauth_state");
  if (!code || !state || state !== cookieState) {
    return redirect(new URL("/staff/login?error=sso_state", request.url), [
      clearOauthStateCookie(),
    ]);
  }

  const stateRow = await getPool().query(
    "DELETE FROM oauth_states WHERE state = $1 AND expires_at > now() RETURNING code_verifier, nonce, return_to",
    [state],
  );
  if (!stateRow.rows[0]) {
    return redirect(new URL("/staff/login?error=sso_expired", request.url), [
      clearOauthStateCookie(),
    ]);
  }

  const discovery = await getMicrosoftDiscovery();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: getMicrosoftRedirectUri(request),
    grant_type: "authorization_code",
    code_verifier: stateRow.rows[0].code_verifier,
    scope: microsoftGraphScopes.join(" "),
  });

  const tokenResponse = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokenBody = (await tokenResponse.json()) as {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error_description?: string;
  };
  if (!tokenResponse.ok || !tokenBody.id_token) {
    console.error(tokenBody.error_description ?? tokenBody);
    return redirect(new URL("/staff/login?error=sso_token", request.url), [
      clearOauthStateCookie(),
    ]);
  }

  const claims = await verifyMicrosoftIdToken(tokenBody.id_token, stateRow.rows[0].nonce);
  const email = (claims.email || claims.preferred_username || claims.upn || "").toLowerCase();
  const domain = email.split("@")[1];
  if (!email || domain !== getStaffEmailDomain()) {
    await audit(getPool(), "microsoft_sso_rejected", "app_user", null, {
      email: email || null,
      allowedDomain: getStaffEmailDomain(),
      tenantId: claims.tid ?? null,
    });
    return redirect(new URL("/staff/login?error=domain", request.url), [clearOauthStateCookie()]);
  }

  const subject = `${claims.tid ?? "unknown"}:${claims.oid ?? claims.sub}`;
  const name = claims.name || email.split("@")[0];
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT id, role FROM app_users WHERE microsoft_subject = $1 OR email = $2 ORDER BY created_at LIMIT 1",
      [subject, email],
    );

    let userId: string;
    if (existing.rows[0]) {
      userId = existing.rows[0].id;
      await client.query(
        `UPDATE app_users
         SET email = $1,
             name = $2,
             auth_provider = 'microsoft',
             microsoft_subject = $3,
             microsoft_tenant_id = $4,
             last_login_at = now(),
             updated_at = now()
         WHERE id = $5`,
        [email, name, subject, claims.tid ?? null, userId],
      );
    } else {
      const inserted = await client.query(
        `INSERT INTO app_users (
          email, name, role, password_hash, auth_provider, microsoft_subject, microsoft_tenant_id, last_login_at
        )
        VALUES ($1, $2, 'staff', NULL, 'microsoft', $3, $4, now())
        RETURNING id`,
        [email, name, subject, claims.tid ?? null],
      );
      userId = inserted.rows[0].id;
    }

    await audit(client, "microsoft_sso_login", "app_user", userId, {
      email,
      tenantId: claims.tid ?? null,
    });
    if (tokenBody.access_token || tokenBody.refresh_token) {
      const expiresAt = new Date(Date.now() + Math.max(60, tokenBody.expires_in ?? 3600) * 1000);
      const scopes = (tokenBody.scope ?? microsoftGraphScopes.join(" "))
        .split(/\s+/)
        .filter(Boolean);
      await client.query(
        `INSERT INTO microsoft_user_tokens (
          user_id, tenant_id, scopes, access_token_cipher, refresh_token_cipher, expires_at
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id) DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id,
           scopes = EXCLUDED.scopes,
           access_token_cipher = COALESCE(EXCLUDED.access_token_cipher, microsoft_user_tokens.access_token_cipher),
           refresh_token_cipher = COALESCE(EXCLUDED.refresh_token_cipher, microsoft_user_tokens.refresh_token_cipher),
           expires_at = EXCLUDED.expires_at,
           updated_at = now()`,
        [
          userId,
          claims.tid ?? null,
          scopes,
          encryptToken(tokenBody.access_token),
          encryptToken(tokenBody.refresh_token),
          expiresAt,
        ],
      );
    }
    await client.query("COMMIT");

    const session = await createSession(userId);
    const redirectTo = new URL(stateRow.rows[0].return_to, getPublicBaseUrl(request));
    return redirect(redirectTo, [
      sessionCookie(session.token, session.expires),
      clearOauthStateCookie(),
    ]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function handlePasswordLogin(request: Request) {
  const body = await readJson(request);
  const email = requireText(body.email, "Email").toLowerCase();
  const password = requireText(body.password, "Password");

  const result = await getPool().query(
    "SELECT id, email, name, role, password_hash FROM app_users WHERE email = $1 AND role IN ('admin', 'staff')",
    [email],
  );
  const user = result.rows[0];

  if (!user || !verifyPassword(password, user.password_hash)) {
    return json({ error: "Invalid email or password" }, { status: 401 });
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_STAFF_PASSWORD_LOGIN !== "true" &&
    user.role !== "admin"
  ) {
    await audit(getPool(), "password_login_blocked", "app_user", user.id, {
      email,
      role: user.role,
      reason: "password_login_reserved_for_admin_break_glass",
    });
    return json({ error: "Use Microsoft SSO for staff access" }, { status: 403 });
  }

  await getPool().query(
    "UPDATE app_users SET last_login_at = now(), updated_at = now() WHERE id = $1",
    [user.id],
  );
  await audit(getPool(), "password_login", "app_user", user.id, { email, role: user.role });

  const session = await createSession(user.id);
  return json(
    {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    },
    { headers: { "set-cookie": sessionCookie(session.token, session.expires) } },
  );
}

async function handleLogout(request: Request) {
  const token = parseCookies(request).get("sti_session");
  if (token) {
    await getPool().query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
  }
  return json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
}

async function dashboard(request: Request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  const result = await getPool().query(`
    WITH open_deals AS (
      SELECT d.* FROM deals d
      JOIN pipeline_stages s ON s.id = d.stage_id
      WHERE s.name NOT IN ('Won', 'Lost')
    ),
    recent_contacts AS (
      SELECT count(*)::int AS count FROM contacts WHERE created_at >= now() - interval '30 days'
    ),
    pending_recommendations AS (
      SELECT count(*)::int AS count FROM ai_recommendations WHERE status = 'pending'
    )
    SELECT
      COALESCE((SELECT sum(value_cents)::int FROM open_deals), 0) AS open_value_cents,
      (SELECT count(*)::int FROM open_deals) AS active_deals,
      (SELECT count FROM recent_contacts) AS new_contacts_30d,
      (SELECT count FROM pending_recommendations) AS pending_recommendations
  `);

  const activity = await getPool().query(`
    SELECT action, entity_type, metadata, created_at
    FROM audit_events
    ORDER BY created_at DESC
    LIMIT 8
  `);

  const recommendations = await getPool().query(`
    SELECT r.id, r.title, r.body, r.created_at, d.title AS deal_title
    FROM ai_recommendations r
    LEFT JOIN deals d ON d.id = r.deal_id
    WHERE r.status = 'pending'
    ORDER BY r.created_at DESC
    LIMIT 5
  `);

  return json({
    kpis: result.rows[0],
    activity: activity.rows,
    recommendations: recommendations.rows,
  });
}

async function pipeline(request: Request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  const rows = await getPool().query(`
    SELECT
      s.id AS stage_id, s.name AS stage_name, s.position, s.is_terminal,
      d.id AS deal_id, d.title, d.value_cents, d.currency, d.service_interest,
      d.created_at, d.updated_at, d.last_activity_at,
      o.name AS organization_name,
      c.first_name || CASE WHEN c.last_name <> '' THEN ' ' || c.last_name ELSE '' END AS contact_name,
      u.name AS owner_name
    FROM pipeline_stages s
    LEFT JOIN deals d ON d.stage_id = s.id
    LEFT JOIN organizations o ON o.id = d.organization_id
    LEFT JOIN contacts c ON c.id = d.primary_contact_id
    LEFT JOIN app_users u ON u.id = d.owner_id
    ORDER BY s.position, d.updated_at DESC NULLS LAST
  `);

  const stages = new Map<string, Record<string, unknown> & { deals: unknown[] }>();
  for (const row of rows.rows) {
    if (!stages.has(row.stage_id)) {
      stages.set(row.stage_id, {
        id: row.stage_id,
        name: row.stage_name,
        position: row.position,
        isTerminal: row.is_terminal,
        deals: [],
      });
    }
    if (row.deal_id) {
      stages.get(row.stage_id)?.deals.push({
        id: row.deal_id,
        title: row.title,
        valueCents: row.value_cents,
        currency: row.currency,
        serviceInterest: row.service_interest,
        organizationName: row.organization_name,
        contactName: row.contact_name,
        ownerName: row.owner_name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastActivityAt: row.last_activity_at,
      });
    }
  }

  return json({ stages: [...stages.values()] });
}

async function contacts(request: Request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  const rows = await getPool().query(`
    SELECT
      c.id, c.first_name, c.last_name, c.email, c.phone, c.role_title, c.status,
      c.lifecycle_stage, c.consent_status, c.consent_basis, c.do_not_contact,
      c.bounce_status, c.last_contacted_at, c.last_meaningful_activity_at, c.next_follow_up_at,
      o.name AS organization_name,
      u.name AS owner_name,
      max(ll.status) FILTER (WHERE ll.status IS NOT NULL) AS campaign_status,
      count(DISTINCT cs.id) FILTER (WHERE cs.active = true)::int AS active_suppressions,
      count(DISTINCT d.id)::int AS deals,
      COALESCE(sum(DISTINCT d.value_cents)::int, 0) AS value_cents
    FROM contacts c
    LEFT JOIN organizations o ON o.id = c.organization_id
    LEFT JOIN app_users u ON u.id = c.owner_id
    LEFT JOIN deals d ON d.primary_contact_id = c.id
    LEFT JOIN lemlist_lead_links ll ON ll.contact_id = c.id
    LEFT JOIN crm_suppressions cs ON cs.contact_id = c.id OR cs.value = c.email
    GROUP BY c.id, o.name, u.name
    ORDER BY c.updated_at DESC
    LIMIT 1000
  `);

  return json({ contacts: rows.rows });
}

async function createStaffContact(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  try {
    const body = await readJson(request);
    const lead = await createLead(
      { ...body, source: optionalText(body.source) ?? "staff_crm_manual" },
      auth.user,
    );
    return json({ ok: true, lead }, { status: 201 });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Unable to create lead" },
      { status: 400 },
    );
  }
}

function leadText(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = optionalText(source[key]);
    if (value) return value;
  }
  return null;
}

function leadNumber(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = optionalNumber(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function n8nLeadPayload(body: unknown, fileName: string): LeadPayload {
  const root = asRecord(body);
  const nested =
    asRecord(root.lead).organizationName || asRecord(root.lead).email || asRecord(root.lead).phone
      ? asRecord(root.lead)
      : asRecord(root.contact).organizationName ||
          asRecord(root.contact).email ||
          asRecord(root.contact).phone
        ? asRecord(root.contact)
        : asRecord(root.data).organizationName ||
            asRecord(root.data).email ||
            asRecord(root.data).phone
          ? asRecord(root.data)
          : root;

  const organizationName =
    leadText(nested, ["organizationName", "organization", "company", "companyName", "business"]) ??
    "Image intake lead";
  const firstName = leadText(nested, ["firstName", "first_name"]);
  const lastName = leadText(nested, ["lastName", "last_name", "surname"]);
  const name = leadText(nested, ["name", "contactName", "fullName"]);
  const email = leadText(nested, ["email", "emailAddress"]);
  const phone = leadText(nested, ["phone", "phoneNumber", "mobile", "cell"]);
  const roleTitle = leadText(nested, ["roleTitle", "title", "jobTitle", "position"]);
  const serviceInterest =
    leadText(nested, ["serviceInterest", "interest", "service", "need"]) ?? "Image intake";
  const summary = leadText(nested, ["message", "summary", "notes", "description"]);
  const estimatedValue = leadNumber(nested, ["estimatedValue", "value", "dealValue"]);

  return {
    organizationName,
    firstName: firstName ?? (name ? undefined : "Image"),
    lastName: lastName ?? (name ? undefined : "Lead"),
    name: name ?? undefined,
    email: email ?? undefined,
    phone: phone ?? undefined,
    roleTitle: roleTitle ?? undefined,
    serviceInterest,
    estimatedValue: estimatedValue ?? undefined,
    message: [`Imported from image: ${fileName}`, summary].filter(Boolean).join("\n\n"),
    source: "staff_crm_image_intake",
  };
}

async function createStaffContactFromImage(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  const form = await request.formData();
  const file = form.get("image");
  if (!(file instanceof File)) return json({ error: "Image file is required" }, { status: 400 });
  if (!file.type.startsWith("image/")) {
    return json({ error: "Upload an image file" }, { status: 400 });
  }
  if (file.size > 15 * 1024 * 1024) {
    return json({ error: `${file.name} exceeds the 15MB limit` }, { status: 400 });
  }

  const webhookUrl =
    process.env.N8N_LEAD_IMAGE_WEBHOOK_URL ||
    process.env.N8N_CONTACT_IMAGE_WEBHOOK_URL ||
    "http://n8n:5678/webhook/sti-risk/contact-image-intake";
  const token = process.env.N8N_AGENT_TOKEN || "";
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "X-STI-Agent-Token": token } : {}),
      },
      body: JSON.stringify({
        type: "contact_image_intake",
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        imageBase64: buffer.toString("base64"),
        staffUser: { id: auth.user.id, email: auth.user.email, name: auth.user.name },
        expectedOutput:
          "Return JSON fields for organizationName, firstName/name, lastName, email, phone, roleTitle, serviceInterest, estimatedValue, and message.",
      }),
    });
    const text = await response.text();
    let body: unknown = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { message: text };
      }
    }
    if (!response.ok) {
      const errorBody = asRecord(body);
      throw new Error(
        optionalText(errorBody.error) ??
          optionalText(errorBody.message) ??
          `n8n image intake failed with ${response.status}`,
      );
    }

    const payload = n8nLeadPayload(body, file.name);
    if (!payload.email && !payload.phone) {
      return json(
        {
          error: "n8n processed the image but did not return an email or phone number",
          extracted: payload,
        },
        { status: 422 },
      );
    }

    const lead = await createLead(payload, auth.user);
    return json({ ok: true, lead, extracted: payload }, { status: 201 });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "Unable to process contact image",
        webhookUrlConfigured: Boolean(
          process.env.N8N_LEAD_IMAGE_WEBHOOK_URL || process.env.N8N_CONTACT_IMAGE_WEBHOOK_URL,
        ),
      },
      { status: 502 },
    );
  }
}

async function contactDetail(request: Request, contactId: string) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  const contact = await getPool().query(
    `
    SELECT c.*, o.name AS organization_name, o.account_type, o.account_status,
      owner.name AS owner_name
    FROM contacts c
    LEFT JOIN organizations o ON o.id = c.organization_id
    LEFT JOIN app_users owner ON owner.id = c.owner_id
    WHERE c.id = $1
  `,
    [contactId],
  );
  if (!contact.rows[0]) return json({ error: "Contact not found" }, { status: 404 });

  const deals = await getPool().query(
    `
    SELECT d.id, d.title, d.value_cents, d.currency, d.status, d.campaign_source,
      d.next_activity_at, s.name AS stage_name
    FROM deals d
    LEFT JOIN pipeline_stages s ON s.id = d.stage_id
    WHERE d.primary_contact_id = $1
    ORDER BY d.updated_at DESC
    LIMIT 50
  `,
    [contactId],
  );
  const campaigns = await getPool().query(
    `
    SELECT ll.*, lc.name AS campaign_name, lc.lemlist_campaign_id, lc.status AS campaign_status
    FROM lemlist_lead_links ll
    JOIN lemlist_campaigns lc ON lc.id = ll.campaign_id
    WHERE ll.contact_id = $1 OR ll.email = $2::citext
    ORDER BY ll.updated_at DESC
    LIMIT 100
  `,
    [contactId, contact.rows[0].email],
  );
  const suppressions = await getPool().query(
    `
    SELECT *
    FROM crm_suppressions
    WHERE contact_id = $1 OR value = $2::citext OR value = $3::citext
    ORDER BY active DESC, updated_at DESC
  `,
    [
      contactId,
      contact.rows[0].email,
      contact.rows[0].email ? emailDomain(contact.rows[0].email) : null,
    ],
  );
  const tasks = await getPool().query(
    `
    SELECT t.id, t.title, t.description, t.priority, t.status, t.due_at, ts.name AS stage_name
    FROM tasks t
    LEFT JOIN task_stages ts ON ts.id = t.stage_id
    WHERE t.contact_id = $1
       OR t.deal_id IN (SELECT id FROM deals WHERE primary_contact_id = $1)
    ORDER BY t.status, t.due_at ASC NULLS LAST, t.created_at DESC
    LIMIT 50
  `,
    [contactId],
  );
  const communications = await getPool().query(
    `
    SELECT id, direction, channel, subject, summary, created_at
    FROM communications
    WHERE contact_id = $1
    ORDER BY created_at DESC
    LIMIT 50
  `,
    [contactId],
  );
  const activities = await getPool().query(
    `
    SELECT id, type, title, body, created_at, lemlist_campaign_id
    FROM activities
    WHERE contact_id = $1
    ORDER BY created_at DESC
    LIMIT 50
  `,
    [contactId],
  );
  const recommendations = await getPool().query(
    `
    SELECT id, recommendation_type, title, body, status, payload, created_at
    FROM ai_recommendations
    WHERE contact_id = $1 AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 20
  `,
    [contactId],
  );

  return json({
    contact: contact.rows[0],
    deals: deals.rows,
    campaigns: campaigns.rows,
    suppressions: suppressions.rows,
    tasks: tasks.rows,
    communications: communications.rows,
    activities: activities.rows,
    recommendations: recommendations.rows,
  });
}

const outreachBasisOptions = [
  "legitimate_interest",
  "existing_customer",
  "partner_relationship",
  "inbound_request",
  "manual_review",
] as const;

async function updateContactOutreachBasis(request: Request, contactId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = await readJson(request);
  const basis = requireOneOf(
    body.consentBasis ?? body.basis,
    "Outreach basis",
    outreachBasisOptions,
  );
  const status = optionalText(body.consentStatus) ?? "reviewed";
  const note = optionalText(body.note);
  const result = await getPool().query(
    `UPDATE contacts
     SET consent_status = $1,
         consent_basis = $2,
         consent_recorded_at = now(),
         updated_at = now()
     WHERE id = $3
     RETURNING *`,
    [status, basis, contactId],
  );
  if (!result.rows[0]) return json({ error: "Contact not found" }, { status: 404 });
  await audit(
    getPool(),
    "contact_outreach_basis_recorded",
    "contact",
    contactId,
    { basis, status, note },
    auth.user,
  );
  return json({ ok: true, contact: result.rows[0] });
}

async function createContactSuppression(request: Request, contactId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = await readJson(request);
  const reason = requireOneOf(body.reason ?? "manual_block", "Suppression reason", [
    "unsubscribe",
    "hard_bounce",
    "do_not_contact",
    "complaint",
    "manual_block",
  ] as const);
  const suppressionType = requireOneOf(body.suppressionType ?? "email", "Suppression type", [
    "email",
    "domain",
    "contact",
  ] as const);
  const contact = await getPool().query("SELECT id, email FROM contacts WHERE id = $1", [
    contactId,
  ]);
  if (!contact.rows[0]) return json({ error: "Contact not found" }, { status: 404 });
  const value =
    optionalText(body.value) ??
    (suppressionType === "domain" && contact.rows[0].email
      ? emailDomain(contact.rows[0].email)
      : contact.rows[0].email);
  if (!value) return json({ error: "Suppression value is required" }, { status: 400 });
  const result = await getPool().query(
    `INSERT INTO crm_suppressions (suppression_type, value, reason, contact_id, source, metadata)
     VALUES ($1, $2, $3, $4, 'manual', $5::jsonb)
     ON CONFLICT (suppression_type, value, reason) DO UPDATE SET
       active = true,
       contact_id = COALESCE(crm_suppressions.contact_id, EXCLUDED.contact_id),
       metadata = EXCLUDED.metadata,
       updated_at = now()
     RETURNING *`,
    [
      suppressionType,
      value,
      reason,
      contactId,
      JSON.stringify({ note: optionalText(body.note), actorId: auth.user.id }),
    ],
  );
  if (["do_not_contact", "unsubscribe", "complaint"].includes(reason)) {
    await getPool().query(
      "UPDATE contacts SET do_not_contact = true, updated_at = now() WHERE id = $1",
      [contactId],
    );
  }
  if (reason === "hard_bounce") {
    await getPool().query(
      "UPDATE contacts SET bounce_status = 'hard_bounce', updated_at = now() WHERE id = $1",
      [contactId],
    );
  }
  await audit(
    getPool(),
    "contact_suppression_created",
    "contact",
    contactId,
    { suppressionId: result.rows[0].id, reason },
    auth.user,
  );
  return json({ ok: true, suppression: result.rows[0] }, { status: 201 });
}

async function updateSuppression(request: Request, suppressionId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = await readJson(request);
  const active = Boolean(body.active);
  const result = await getPool().query(
    "UPDATE crm_suppressions SET active = $1, updated_at = now() WHERE id = $2 RETURNING *",
    [active, suppressionId],
  );
  if (!result.rows[0]) return json({ error: "Suppression not found" }, { status: 404 });
  await audit(
    getPool(),
    active ? "suppression_reactivated" : "suppression_deactivated",
    "contact",
    result.rows[0].contact_id,
    { suppressionId },
    auth.user,
  );
  return json({ ok: true, suppression: result.rows[0] });
}

async function createContactTask(request: Request, contactId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = await readJson(request);
  const title = requireText(body.title, "Task title");
  const description = optionalText(body.description);
  const priority = requireOneOf(body.priority ?? "medium", "Priority", [
    "low",
    "medium",
    "high",
    "critical",
  ] as const);
  const dueAt = optionalText(body.dueAt);
  const contact = await getPool().query(
    `SELECT c.id, c.organization_id, c.owner_id,
      (SELECT id FROM deals WHERE primary_contact_id = c.id ORDER BY updated_at DESC LIMIT 1) AS deal_id
     FROM contacts c
     WHERE c.id = $1`,
    [contactId],
  );
  if (!contact.rows[0]) return json({ error: "Contact not found" }, { status: 404 });
  const board = await ensureTaskBoard(getPool());
  const backlog = board.stages.find((stage) => stage.name === "Backlog") ?? board.stages[0];
  const task = await getPool().query(
    `INSERT INTO tasks (
      board_id, stage_id, contact_id, deal_id, organization_id, owner_id,
      title, description, priority, due_at, source
     )
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::uuid, $7::uuid), $8, $9, $10, COALESCE($11::timestamptz, now() + interval '1 day'), 'staff')
     RETURNING *`,
    [
      board.boardId,
      backlog.id,
      contactId,
      contact.rows[0].deal_id,
      contact.rows[0].organization_id,
      contact.rows[0].owner_id,
      auth.user.id,
      title,
      description,
      priority,
      dueAt,
    ],
  );
  await audit(
    getPool(),
    "contact_task_created",
    "contact",
    contactId,
    { taskId: task.rows[0].id },
    auth.user,
  );
  return json({ ok: true, task: task.rows[0] }, { status: 201 });
}

async function dealDetail(request: Request, dealId: string) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  const deal = await getPool().query(
    `
    SELECT d.id, d.title, d.value_cents, d.currency, d.source, d.service_interest,
      d.description, d.status, d.created_at, d.updated_at, d.last_activity_at,
      d.project_id, d.campaign_source, d.probability, d.expected_close_date, d.next_activity_at,
      s.name AS stage_name, s.id AS stage_id,
      o.id AS organization_id, o.name AS organization_name,
      c.id AS contact_id, c.first_name, c.last_name, c.email, c.phone,
      c.consent_status, c.do_not_contact, c.bounce_status,
      u.name AS owner_name,
      count(ll.id)::int AS campaign_links,
      max(ll.last_event_type) AS last_campaign_event,
      max(ll.last_event_at) AS last_campaign_event_at
    FROM deals d
    LEFT JOIN pipeline_stages s ON s.id = d.stage_id
    LEFT JOIN organizations o ON o.id = d.organization_id
    LEFT JOIN contacts c ON c.id = d.primary_contact_id
    LEFT JOIN app_users u ON u.id = d.owner_id
    LEFT JOIN lemlist_lead_links ll ON ll.deal_id = d.id OR ll.contact_id = c.id
    WHERE d.id = $1
    GROUP BY d.id, s.name, s.id, o.id, o.name, c.id, u.name
  `,
    [dealId],
  );

  if (!deal.rows[0]) return json({ error: "Deal not found" }, { status: 404 });

  const activities = await getPool().query(
    `
    SELECT id, type, title, body, due_at, completed_at, created_at
    FROM activities
    WHERE deal_id = $1
    ORDER BY created_at DESC
    LIMIT 50
  `,
    [dealId],
  );

  const tasks = await getPool().query(
    `
    SELECT t.id, t.title, t.description, t.priority, t.status, t.due_at, ts.name AS stage_name
    FROM tasks t
    LEFT JOIN task_stages ts ON ts.id = t.stage_id
    WHERE t.deal_id = $1
    ORDER BY t.due_at ASC NULLS LAST, t.created_at DESC
  `,
    [dealId],
  );

  const communications = await getPool().query(
    `
    SELECT id, direction, channel, subject, body, summary, created_at
    FROM communications
    WHERE deal_id = $1
    ORDER BY created_at DESC
    LIMIT 50
  `,
    [dealId],
  );

  const memory = await getPool().query(
    `
    SELECT id, entity_type, content, metadata, created_at
    FROM embedding_documents
    WHERE entity_type = 'deal' AND entity_id = $1
    ORDER BY created_at DESC
    LIMIT 10
  `,
    [dealId],
  );

  return json({
    deal: deal.rows[0],
    activities: activities.rows,
    tasks: tasks.rows,
    communications: communications.rows,
    memory: memory.rows,
  });
}

async function moveDealStage(request: Request, dealId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  const body = await readJson(request);
  const stageId = requireText(body.stageId, "Stage id");
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT stage_id FROM deals WHERE id = $1 FOR UPDATE", [
      dealId,
    ]);
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return json({ error: "Deal not found" }, { status: 404 });
    }

    const stage = await client.query("SELECT id, name FROM pipeline_stages WHERE id = $1", [
      stageId,
    ]);
    if (!stage.rows[0]) {
      await client.query("ROLLBACK");
      return json({ error: "Stage not found" }, { status: 404 });
    }

    await client.query(
      "UPDATE deals SET stage_id = $1, updated_at = now(), last_activity_at = now() WHERE id = $2",
      [stageId, dealId],
    );
    await client.query(
      "INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, actor_id) VALUES ($1, $2, $3, $4)",
      [dealId, current.rows[0].stage_id, stageId, auth.user.id],
    );
    await client.query(
      `INSERT INTO activities (deal_id, actor_id, type, title, body)
       VALUES ($1, $2, 'stage_change', $3, $4)`,
      [
        dealId,
        auth.user.id,
        `Moved deal to ${stage.rows[0].name}`,
        `Stage changed by ${auth.user.name}`,
      ],
    );
    await audit(
      client,
      "move_deal_stage",
      "deal",
      dealId,
      { toStageId: stageId, toStage: stage.rows[0].name },
      auth.user,
    );
    await client.query("COMMIT");
    return json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function opsOverview(request: Request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  const kpis = await getPool().query(`
    WITH open_deals AS (
      SELECT d.* FROM deals d
      JOIN pipeline_stages s ON s.id = d.stage_id
      WHERE s.name NOT IN ('Won', 'Lost')
    ),
    overdue_deliverables AS (
      SELECT count(*)::int AS count
      FROM deliverables
      WHERE status NOT IN ('done', 'cancelled') AND due_on < current_date
    ),
    active_tasks AS (
      SELECT count(*)::int AS count FROM tasks WHERE status IN ('open', 'blocked')
    ),
    billing AS (
      SELECT
        COALESCE(sum(total_cents) FILTER (WHERE status IN ('sent', 'overdue')), 0)::int AS outstanding_cents,
        count(*) FILTER (WHERE status = 'overdue')::int AS overdue_invoices
      FROM invoices
    ),
    pending_recommendations AS (
      SELECT count(*)::int AS count FROM ai_recommendations WHERE status = 'pending'
    )
    SELECT
      COALESCE((SELECT sum(value_cents)::int FROM open_deals), 0) AS open_value_cents,
      (SELECT count(*)::int FROM open_deals) AS active_deals,
      (SELECT count FROM overdue_deliverables) AS overdue_deliverables,
      (SELECT count FROM active_tasks) AS active_tasks,
      (SELECT outstanding_cents FROM billing) AS outstanding_invoice_cents,
      (SELECT overdue_invoices FROM billing) AS overdue_invoices,
      (SELECT count FROM pending_recommendations) AS pending_recommendations
  `);

  const pipeline = await getPool().query(`
    SELECT s.name, count(d.id)::int AS deals, COALESCE(sum(d.value_cents)::int, 0) AS value_cents
    FROM pipeline_stages s
    LEFT JOIN deals d ON d.stage_id = s.id
    GROUP BY s.id
    ORDER BY s.position
  `);

  const tasks = await getPool().query(`
    SELECT t.id, t.title, t.priority, t.status, t.due_at, ts.name AS stage_name,
      p.name AS project_name, o.name AS organization_name
    FROM tasks t
    LEFT JOIN task_stages ts ON ts.id = t.stage_id
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN organizations o ON o.id = t.organization_id
    WHERE t.status IN ('open', 'blocked')
    ORDER BY t.due_at ASC NULLS LAST, t.updated_at DESC
    LIMIT 8
  `);

  const deliverables = await getPool().query(`
    SELECT d.id, d.title, d.status, d.due_on, p.name AS project_name, o.name AS organization_name
    FROM deliverables d
    LEFT JOIN projects p ON p.id = d.project_id
    LEFT JOIN organizations o ON o.id = d.organization_id
    WHERE d.status NOT IN ('done', 'cancelled')
    ORDER BY d.due_on ASC NULLS LAST, d.updated_at DESC
    LIMIT 8
  `);

  const recommendations = await getPool().query(`
    SELECT r.id, r.title, r.body, r.created_at, d.title AS deal_title, p.name AS project_name
    FROM ai_recommendations r
    LEFT JOIN deals d ON d.id = r.deal_id
    LEFT JOIN projects p ON p.id = r.project_id
    WHERE r.status = 'pending'
    ORDER BY r.created_at DESC
    LIMIT 6
  `);

  const activity = await getPool().query(`
    SELECT action, entity_type, metadata, created_at
    FROM audit_events
    ORDER BY created_at DESC
    LIMIT 10
  `);

  return json({
    kpis: kpis.rows[0],
    pipeline: pipeline.rows,
    tasks: tasks.rows,
    deliverables: deliverables.rows,
    recommendations: recommendations.rows,
    activity: activity.rows,
  });
}

async function staffKpiDashboard(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  const summary = await getPool().query(`
    WITH won AS (
      SELECT COALESCE(sum(d.value_cents)::int, 0) AS cents
      FROM deals d
      JOIN pipeline_stages s ON s.id = d.stage_id
      WHERE (s.name = 'Won' OR d.status = 'won')
        AND d.updated_at >= date_trunc('month', now())
    ),
    invoiced AS (
      SELECT COALESCE(sum(total_cents)::int, 0) AS cents
      FROM invoices
      WHERE issued_on >= date_trunc('month', now())::date
    ),
    collected AS (
      SELECT COALESCE(sum(total_cents)::int, 0) AS cents
      FROM invoices
      WHERE status = 'paid'
        AND COALESCE(paid_at, updated_at) >= date_trunc('month', now())
    ),
    new_opportunities AS (
      SELECT count(*)::int AS count
      FROM deals
      WHERE created_at >= date_trunc('month', now())
    ),
    quotations AS (
      SELECT
        count(*)::int AS count,
        COALESCE(sum(q.total_value_cents)::int, 0) AS value_cents
      FROM quotes q
      WHERE q.sent_at >= date_trunc('month', now())
        AND q.status = 'sent_to_client'
    ),
    wins AS (
      SELECT
        count(*) FILTER (WHERE s.name = 'Won' OR d.status = 'won')::int AS won_count,
        count(*) FILTER (WHERE s.name IN ('Won', 'Lost') OR d.status IN ('won', 'lost'))::int AS decided_count
      FROM deals d
      JOIN pipeline_stages s ON s.id = d.stage_id
      WHERE d.updated_at >= date_trunc('month', now())
    ),
    partner_engagements AS (
      SELECT count(*)::int AS count
      FROM communications
      WHERE created_at >= date_trunc('month', now())
        AND (
          body ILIKE '%partner%'
          OR summary ILIKE '%partner%'
          OR subject ILIKE '%partner%'
          OR body ILIKE '%insurance%'
          OR summary ILIKE '%sprinkler%'
          OR summary ILIKE '%competitor%'
        )
    ),
    client_reviews AS (
      SELECT count(*)::int AS count
      FROM activities
      WHERE created_at >= date_trunc('month', now())
        AND (
          title ILIKE '%review%'
          OR title ILIKE '%cross-sell%'
          OR title ILIKE '%upsell%'
          OR title ILIKE '%referral%'
          OR body ILIKE '%service%'
        )
    ),
    service AS (
      SELECT
        count(*) FILTER (WHERE status IN ('planned', 'active', 'on_hold'))::int AS open_projects,
        count(*) FILTER (WHERE status = 'completed' AND updated_at >= date_trunc('month', now()))::int AS completed_projects
      FROM projects
    ),
    capability AS (
      SELECT count(*)::int AS count
      FROM tasks
      WHERE created_at >= date_trunc('month', now())
        AND (
          title ILIKE '%team%'
          OR title ILIKE '%vehicle%'
          OR title ILIKE '%training%'
          OR title ILIKE '%certification%'
          OR title ILIKE '%SOP%'
          OR description ILIKE '%capability%'
        )
    ),
    knowledge AS (
      SELECT
        count(*) FILTER (WHERE channel ILIKE '%call%' OR channel ILIKE '%voice%' OR subject ILIKE '%call%')::int AS calls_recorded,
        count(*) FILTER (WHERE summary ILIKE '%lesson%' OR body ILIKE '%lesson%' OR subject ILIKE '%case stud%')::int AS knowledge_items
      FROM communications
      WHERE created_at >= date_trunc('month', now())
    ),
    staff AS (
      SELECT count(*)::int AS count FROM app_users WHERE role IN ('admin', 'staff', 'agent') 
    ),
    risk AS (
      SELECT
        count(*) FILTER (WHERE status = 'blocked')::int AS blocked_tasks,
        count(*) FILTER (WHERE status IN ('open', 'blocked') AND due_at < now())::int AS overdue_tasks
      FROM tasks
    ),
    outbound AS (
      SELECT
        count(DISTINCT lc.id) FILTER (WHERE COALESCE((lc.raw->>'archived')::boolean, false) = false)::int AS active_campaigns,
        count(DISTINCT ll.contact_id)::int AS prospects_contacted,
        count(ll.id) FILTER (WHERE ll.replied_at IS NOT NULL)::int AS replies,
        count(ll.id) FILTER (WHERE ll.interested_at IS NOT NULL)::int AS interested_replies,
        count(ll.id) FILTER (WHERE ll.meeting_booked_at IS NOT NULL)::int AS meetings,
        count(ll.id) FILTER (WHERE ll.bounced_at IS NOT NULL)::int AS bounces,
        count(ll.id) FILTER (WHERE ll.unsubscribed_at IS NOT NULL)::int AS unsubscribes
      FROM lemlist_campaigns lc
      LEFT JOIN lemlist_lead_links ll ON ll.campaign_id = lc.id
        AND ll.created_at >= date_trunc('month', now())
    ),
    outbound_deals AS (
      SELECT
        count(*)::int AS deals_created,
        COALESCE(sum(value_cents)::int, 0) AS pipeline_generated_cents
      FROM deals
      WHERE campaign_source IS NOT NULL OR source = 'lemlist'
    ),
    growth_tasks AS (
      SELECT
        count(*) FILTER (WHERE status = 'done' AND title ILIKE '%quote%follow%')::int AS quote_followups_completed,
        count(*) FILTER (WHERE source = 'lemlist' AND status = 'done')::int AS completed_followup_tasks,
        count(*) FILTER (WHERE source = 'lemlist')::int AS total_followup_tasks
      FROM tasks
      WHERE created_at >= date_trunc('month', now())
    ),
    partner_campaign AS (
      SELECT
        count(DISTINCT ll.contact_id)::int AS partner_prospects_contacted,
        count(ll.id) FILTER (WHERE ll.meeting_booked_at IS NOT NULL)::int AS partner_meetings
      FROM lemlist_lead_links ll
      JOIN lemlist_campaigns lc ON lc.id = ll.campaign_id
      LEFT JOIN contacts c ON c.id = ll.contact_id
      LEFT JOIN organizations o ON o.id = c.organization_id
      WHERE ll.created_at >= date_trunc('month', now())
        AND (lc.segment ILIKE '%partner%' OR o.is_partner = true OR o.account_type ILIKE '%partner%')
    ),
    campaign_learning AS (
      SELECT count(*)::int AS count
      FROM ai_recommendations
      WHERE created_at >= date_trunc('month', now())
        AND recommendation_type = 'campaign_intelligence'
    )
    SELECT
      (SELECT cents FROM won) AS revenue_won_cents,
      (SELECT cents FROM invoiced) AS revenue_invoiced_cents,
      (SELECT cents FROM collected) AS revenue_collected_cents,
      (SELECT count FROM new_opportunities) AS new_opportunities,
      (SELECT count FROM quotations) AS quotations_issued,
      (SELECT value_cents FROM quotations) AS quotation_value_cents,
      CASE
        WHEN (SELECT decided_count FROM wins) = 0 THEN 0
        ELSE round(((SELECT won_count FROM wins)::numeric / (SELECT decided_count FROM wins)::numeric) * 100, 1)
      END AS win_rate,
      (SELECT count FROM partner_engagements) AS partner_engagements,
      (SELECT count FROM client_reviews) AS client_reviews,
      (SELECT open_projects FROM service) AS open_projects,
      (SELECT completed_projects FROM service) AS completed_projects,
      (SELECT count FROM capability) AS capability_items,
      (SELECT calls_recorded FROM knowledge) AS calls_recorded,
      (SELECT knowledge_items FROM knowledge) AS knowledge_items,
      (SELECT count FROM staff) AS active_staff,
      (SELECT blocked_tasks FROM risk) AS blocked_tasks,
      (SELECT overdue_tasks FROM risk) AS overdue_tasks,
      (SELECT active_campaigns FROM outbound) AS active_campaigns,
      (SELECT prospects_contacted FROM outbound) AS prospects_contacted,
      (SELECT replies FROM outbound) AS campaign_replies,
      (SELECT interested_replies FROM outbound) AS interested_replies,
      (SELECT meetings FROM outbound) AS campaign_meetings,
      (SELECT deals_created FROM outbound_deals) AS outbound_created_opportunities,
      (SELECT pipeline_generated_cents FROM outbound_deals) AS pipeline_generated_cents,
      (SELECT quote_followups_completed FROM growth_tasks) AS quote_followups_completed,
      (SELECT partner_prospects_contacted FROM partner_campaign) AS partner_prospects_contacted,
      (SELECT partner_meetings FROM partner_campaign) AS partner_meetings,
      (SELECT count FROM campaign_learning) AS campaign_learnings,
      CASE
        WHEN (SELECT total_followup_tasks FROM growth_tasks) = 0 THEN 0
        ELSE round(((SELECT completed_followup_tasks FROM growth_tasks)::numeric / (SELECT total_followup_tasks FROM growth_tasks)::numeric) * 100, 1)
      END AS followup_task_completion,
      CASE
        WHEN (SELECT prospects_contacted FROM outbound) = 0 THEN 0
        ELSE round(((SELECT bounces FROM outbound)::numeric / (SELECT prospects_contacted FROM outbound)::numeric) * 100, 1)
      END AS bounce_rate,
      CASE
        WHEN (SELECT prospects_contacted FROM outbound) = 0 THEN 0
        ELSE round(((SELECT unsubscribes FROM outbound)::numeric / (SELECT prospects_contacted FROM outbound)::numeric) * 100, 1)
      END AS unsubscribe_rate
  `);

  const staff = await getPool().query(`
    WITH task_counts AS (
      SELECT
        owner_id,
        count(*) FILTER (WHERE status IN ('open', 'blocked'))::int AS active_tasks,
        count(*) FILTER (WHERE status = 'blocked')::int AS blocked_tasks,
        count(*) FILTER (WHERE status IN ('open', 'blocked') AND due_at < now())::int AS overdue_tasks
      FROM tasks
      GROUP BY owner_id
    ),
    deal_counts AS (
      SELECT
        owner_id,
        count(*) FILTER (WHERE status = 'open')::int AS active_deals,
        COALESCE(sum(value_cents) FILTER (WHERE status = 'open'), 0)::int AS open_deal_value_cents
      FROM deals
      GROUP BY owner_id
    ),
    activity_counts AS (
      SELECT actor_id, count(*) FILTER (WHERE created_at >= current_date)::int AS activity_today
      FROM activities
      GROUP BY actor_id
    )
    SELECT
      u.id,
      u.name,
      u.email,
      u.role,
      skp.id AS profile_id,
      skp.role_summary,
      COALESCE(tc.active_tasks, 0) AS active_tasks,
      COALESCE(tc.blocked_tasks, 0) AS blocked_tasks,
      COALESCE(tc.overdue_tasks, 0) AS overdue_tasks,
      COALESCE(dc.active_deals, 0) AS active_deals,
      COALESCE(dc.open_deal_value_cents, 0) AS open_deal_value_cents,
      COALESCE(ac.activity_today, 0) AS activity_today
    FROM app_users u
    LEFT JOIN staff_kpi_profiles skp ON skp.user_id = u.id
    LEFT JOIN task_counts tc ON tc.owner_id = u.id
    LEFT JOIN deal_counts dc ON dc.owner_id = u.id
    LEFT JOIN activity_counts ac ON ac.actor_id = u.id
    WHERE u.role IN ('admin', 'staff', 'agent')
    ORDER BY
      CASE WHEN lower(u.name) = 'vusi' OR u.email = 'vusi@stirisk.co.za' THEN 0 ELSE 1 END,
      u.name
  `);

  const profile = await getPool().query(`
    SELECT skp.id, skp.manager_name, skp.role_summary, skp.active,
      u.id AS user_id, u.name AS user_name, u.email
    FROM staff_kpi_profiles skp
    JOIN app_users u ON u.id = skp.user_id
    WHERE u.email = 'vusi@stirisk.co.za'
    LIMIT 1
  `);

  const profileId = profile.rows[0]?.id as string | undefined;

  const objectives = profileId
    ? await getPool().query(
        `
        SELECT id, objective_key, title, success_measure, position
        FROM staff_kpi_objectives
        WHERE profile_id = $1
        ORDER BY position
      `,
        [profileId],
      )
    : { rows: [] };

  const pillars = profileId
    ? await getPool().query(
        `
        SELECT id, pillar_key, title, owner_label, description, position
        FROM staff_kpi_pillars
        WHERE profile_id = $1
        ORDER BY position
      `,
        [profileId],
      )
    : { rows: [] };

  const metrics = profileId
    ? await getPool().query(
        `
        SELECT m.id, m.metric_key, m.title, m.target_label, m.tracking_label,
          m.target_value, m.target_unit, m.calculation_key, m.position,
          p.pillar_key, p.title AS pillar_title
        FROM staff_kpi_metrics m
        LEFT JOIN staff_kpi_pillars p ON p.id = m.pillar_id
        WHERE m.profile_id = $1 AND m.active = true
        ORDER BY m.position
      `,
        [profileId],
      )
    : { rows: [] };

  const timeAllocation = profileId
    ? await getPool().query(
        `
        SELECT category_key, category_label, activity_label, COALESCE(sum(hours), 0)::numeric AS hours
        FROM staff_time_entries
        WHERE profile_id = $1
          AND entry_date >= date_trunc('week', current_date)::date
        GROUP BY category_key, category_label, activity_label
        ORDER BY min(created_at)
      `,
        [profileId],
      )
    : { rows: [] };

  const risks = await getPool().query(`
    SELECT t.id, t.title, t.priority, t.status, t.due_at,
      u.name AS owner_name, p.name AS project_name, o.name AS organization_name
    FROM tasks t
    LEFT JOIN app_users u ON u.id = t.owner_id
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN organizations o ON o.id = t.organization_id
    WHERE t.status = 'blocked'
       OR (t.status IN ('open', 'blocked') AND t.due_at < now())
    ORDER BY
      CASE WHEN t.status = 'blocked' THEN 0 ELSE 1 END,
      t.due_at ASC NULLS LAST,
      t.updated_at DESC
    LIMIT 8
  `);

  return json({
    summary: summary.rows[0],
    staff: staff.rows,
    vusiProfile: profile.rows[0] ?? null,
    objectives: objectives.rows,
    pillars: pillars.rows,
    metrics: metrics.rows,
    timeAllocation: timeAllocation.rows,
    risks: risks.rows,
  });
}

async function capabilityChecklist(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  if (request.method === "GET") {
    const [objective, tasks] = await Promise.all([
      getPool().query(
        `SELECT o.objective_key, o.title, o.success_measure
         FROM staff_kpi_objectives o
         JOIN staff_kpi_profiles p ON p.id = o.profile_id
         JOIN app_users u ON u.id = p.user_id
         WHERE u.email = 'vusi@stirisk.co.za'
           AND o.objective_key = 'service_installation_capability'
         LIMIT 1`,
      ),
      getPool().query(
        `SELECT t.id, t.title, t.description, t.status, t.priority, t.due_at,
           t.completed_at, t.owner_id, u.name AS owner_name, t.created_at, t.updated_at
         FROM tasks t
         LEFT JOIN app_users u ON u.id = t.owner_id
         WHERE t.source = 'capability_checklist'
         ORDER BY t.status = 'done', t.due_at ASC NULLS LAST, t.updated_at DESC`,
      ),
    ]);
    return json({ objective: objective.rows[0] ?? null, items: tasks.rows });
  }

  const body = await readJson(request);
  const title = requireText(body.title, "Checklist item title");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const board = await ensureTaskBoard(client);
    const fallbackStage =
      board.stages.find((stage) => stage.name === "Backlog") ?? board.stages[0];
    const result = await client.query(
      `INSERT INTO tasks (
        board_id, stage_id, owner_id, title, description, priority, status, due_at, source
       )
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'medium'), COALESCE($7, 'open'), $8, 'capability_checklist')
       RETURNING id`,
      [
        board.boardId,
        fallbackStage.id,
        auth.user.id,
        title,
        optionalText(body.description),
        optionalText(body.priority),
        optionalText(body.status),
        optionalText(body.dueAt),
      ],
    );
    await refreshTaskEmbedding(client, result.rows[0].id);
    await audit(getPool(), "create_capability_checklist_item", "task", result.rows[0].id, {}, auth.user);
    await client.query("COMMIT");
    return json({ ok: true, itemId: result.rows[0].id }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function workBoard(request: Request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  if (request.method === "POST") {
    const body = await readJson(request);
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const title = requireText(body.title, "Task title");
      const board = await ensureTaskBoard(client);
      const requestedStageId = optionalText(body.stageId);
      const fallbackStage =
        board.stages.find((stage) => stage.name === "Backlog") ?? board.stages[0];
      const stage = requestedStageId
        ? await client.query("SELECT id FROM task_stages WHERE id = $1 AND board_id = $2", [
            requestedStageId,
            board.boardId,
          ])
        : null;
      const stageId = stage?.rows[0]?.id ?? fallbackStage.id;
      const ownerEmail = optionalText(body.ownerEmail);
      const owner = ownerEmail
        ? await client.query(
            "SELECT id FROM app_users WHERE lower(email) = lower($1) AND role IN ('admin', 'staff')",
            [ownerEmail],
          )
        : null;
      const ownerId = owner?.rows[0]?.id ?? auth.user.id;

      const result = await client.query(
        `INSERT INTO tasks (
          board_id, stage_id, owner_id, title, description, priority, due_at, source
         )
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'medium'), $7, 'staff')
         RETURNING id`,
        [
          board.boardId,
          stageId,
          ownerId,
          title,
          optionalText(body.description),
          optionalText(body.priority),
          optionalText(body.dueAt),
        ],
      );
      await refreshTaskEmbedding(client, result.rows[0].id);
      await audit(client, "create_task", "task", result.rows[0].id, {}, auth.user);
      await client.query("COMMIT");
      return json({ ok: true, taskId: result.rows[0].id }, { status: 201 });
    } catch (error) {
      await client.query("ROLLBACK");
      const response = responseFromError(error);
      if (response) return response;
      throw error;
    } finally {
      client.release();
    }
  }

  const board = await ensureTaskBoard(getPool());
  const rows = await getPool().query(
    `
    SELECT
      ts.id AS stage_id, ts.name AS stage_name, ts.position, ts.is_terminal,
      t.id AS task_id, t.title, t.description, t.priority, t.status, t.due_at,
      t.created_at, t.updated_at, p.name AS project_name, o.name AS organization_name,
      d.title AS deal_title, u.id AS owner_id, u.name AS owner_name,
      count(DISTINCT tc.id)::int AS comments
    FROM task_stages ts
    LEFT JOIN tasks t ON t.stage_id = ts.id
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN organizations o ON o.id = t.organization_id
    LEFT JOIN deals d ON d.id = t.deal_id
    LEFT JOIN app_users u ON u.id = t.owner_id
    LEFT JOIN task_comments tc ON tc.task_id = t.id
    WHERE ts.board_id = $1
    GROUP BY ts.id, t.id, p.name, o.name, d.title, u.id, u.name
    ORDER BY ts.position, t.due_at ASC NULLS LAST, t.updated_at DESC NULLS LAST
  `,
    [board.boardId],
  );

  const stages = new Map<string, Record<string, unknown> & { tasks: unknown[] }>();
  for (const row of rows.rows) {
    if (!stages.has(row.stage_id)) {
      stages.set(row.stage_id, {
        id: row.stage_id,
        name: row.stage_name,
        position: row.position,
        isTerminal: row.is_terminal,
        tasks: [],
      });
    }
    if (row.task_id) {
      stages.get(row.stage_id)?.tasks.push({
        id: row.task_id,
        stageId: row.stage_id,
        title: row.title,
        description: row.description,
        priority: row.priority,
        status: row.status,
        dueAt: row.due_at,
        projectName: row.project_name,
        organizationName: row.organization_name,
        dealTitle: row.deal_title,
        ownerId: row.owner_id,
        ownerName: row.owner_name,
        comments: row.comments,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }
  }

  const owners = await getPool().query(`
    SELECT id, name, email, role
    FROM app_users
    WHERE role IN ('admin', 'staff')
    ORDER BY name
  `);

  return json({ boardId: board.boardId, stages: [...stages.values()], owners: owners.rows });
}

async function taskDetail(request: Request, taskId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  const task = await getPool().query(
    `
    SELECT t.id, t.board_id, t.stage_id, t.project_id, t.deliverable_id, t.deal_id,
      t.organization_id, t.owner_id, t.title, t.description, t.priority, t.status,
      t.due_at, t.completed_at, t.source, t.created_at, t.updated_at,
      ts.name AS stage_name, ts.is_terminal AS stage_is_terminal,
      u.name AS owner_name, u.email AS owner_email,
      o.name AS organization_name,
      d.title AS deal_title,
      p.name AS project_name,
      dl.title AS deliverable_title
    FROM tasks t
    LEFT JOIN task_stages ts ON ts.id = t.stage_id
    LEFT JOIN app_users u ON u.id = t.owner_id
    LEFT JOIN organizations o ON o.id = t.organization_id
    LEFT JOIN deals d ON d.id = t.deal_id
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN deliverables dl ON dl.id = t.deliverable_id
    WHERE t.id = $1
  `,
    [taskId],
  );

  if (!task.rows[0]) return json({ error: "Task not found" }, { status: 404 });

  const comments = await getPool().query(
    `
    SELECT tc.id, tc.body, tc.created_at, u.name AS author_name, u.email AS author_email
    FROM task_comments tc
    LEFT JOIN app_users u ON u.id = tc.author_id
    WHERE tc.task_id = $1
    ORDER BY tc.created_at ASC
  `,
    [taskId],
  );

  const history = await getPool().query(
    `
    SELECT h.id, h.created_at, actor.name AS actor_name,
      from_stage.name AS from_stage_name,
      to_stage.name AS to_stage_name
    FROM task_stage_history h
    LEFT JOIN app_users actor ON actor.id = h.actor_id
    LEFT JOIN task_stages from_stage ON from_stage.id = h.from_stage_id
    LEFT JOIN task_stages to_stage ON to_stage.id = h.to_stage_id
    WHERE h.task_id = $1
    ORDER BY h.created_at DESC
  `,
    [taskId],
  );

  return json({ task: task.rows[0], comments: comments.rows, history: history.rows });
}

async function updateTask(request: Request, taskId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  const body = await readJson(request);
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT * FROM tasks WHERE id = $1 FOR UPDATE", [taskId]);
    const row = current.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return json({ error: "Task not found" }, { status: 404 });
    }

    const title = Object.hasOwn(body, "title") ? requireText(body.title, "Task title") : row.title;
    const description = Object.hasOwn(body, "description")
      ? optionalString(body.description)
      : row.description;
    const priority = Object.hasOwn(body, "priority")
      ? requireOneOf(body.priority, "Priority", ["low", "medium", "high", "critical"] as const)
      : row.priority;
    let status = Object.hasOwn(body, "status")
      ? requireOneOf(body.status, "Status", ["open", "blocked", "done", "cancelled"] as const)
      : row.status;
    const dueAt = Object.hasOwn(body, "dueAt") ? optionalText(body.dueAt) : row.due_at;

    let ownerId = row.owner_id as string | null;
    if (Object.hasOwn(body, "ownerId")) {
      const requestedOwnerId = optionalText(body.ownerId);
      if (requestedOwnerId) {
        const owner = await client.query(
          "SELECT id FROM app_users WHERE id = $1 AND role IN ('admin', 'staff')",
          [requestedOwnerId],
        );
        if (!owner.rows[0]) {
          await client.query("ROLLBACK");
          return json({ error: "Owner not found" }, { status: 404 });
        }
        ownerId = owner.rows[0].id;
      } else {
        ownerId = null;
      }
    }

    let stageId = row.stage_id as string | null;
    let stageIsTerminal = false;
    if (Object.hasOwn(body, "stageId")) {
      const requestedStageId = optionalText(body.stageId);
      if (requestedStageId) {
        const stage = await client.query(
          "SELECT id, is_terminal FROM task_stages WHERE id = $1 AND board_id = $2",
          [requestedStageId, row.board_id],
        );
        if (!stage.rows[0]) {
          await client.query("ROLLBACK");
          return json({ error: "Task stage not found" }, { status: 404 });
        }
        stageId = stage.rows[0].id;
        stageIsTerminal = stage.rows[0].is_terminal;
      } else {
        stageId = null;
      }
    } else if (stageId) {
      const stage = await client.query("SELECT is_terminal FROM task_stages WHERE id = $1", [
        stageId,
      ]);
      stageIsTerminal = Boolean(stage.rows[0]?.is_terminal);
    }

    if (stageIsTerminal) status = "done";
    const completedAt = status === "done" ? (row.completed_at ?? new Date()) : null;

    await client.query(
      `UPDATE tasks
       SET title = $1,
           description = $2,
           owner_id = $3,
           priority = $4,
           status = $5,
           stage_id = $6,
           due_at = $7,
           completed_at = $8,
           updated_at = now()
       WHERE id = $9`,
      [title, description, ownerId, priority, status, stageId, dueAt, completedAt, taskId],
    );

    if (stageId !== row.stage_id) {
      await client.query(
        "INSERT INTO task_stage_history (task_id, from_stage_id, to_stage_id, actor_id) VALUES ($1, $2, $3, $4)",
        [taskId, row.stage_id, stageId, auth.user.id],
      );
    }

    await refreshTaskEmbedding(client, taskId);

    await audit(
      client,
      "update_task",
      "task",
      taskId,
      {
        changed: Object.keys(body).filter((key) =>
          ["title", "description", "ownerId", "priority", "status", "stageId", "dueAt"].includes(
            key,
          ),
        ),
      },
      auth.user,
    );
    await client.query("COMMIT");
    return json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function addTaskComment(request: Request, taskId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  const body = await readJson(request);
  const comment = requireText(body.body, "Comment");
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const task = await client.query("SELECT id FROM tasks WHERE id = $1", [taskId]);
    if (!task.rows[0]) {
      await client.query("ROLLBACK");
      return json({ error: "Task not found" }, { status: 404 });
    }

    const result = await client.query(
      "INSERT INTO task_comments (task_id, author_id, body) VALUES ($1, $2, $3) RETURNING id",
      [taskId, auth.user.id, comment],
    );
    await client.query("UPDATE tasks SET updated_at = now() WHERE id = $1", [taskId]);
    await refreshTaskEmbedding(client, taskId);
    await audit(
      client,
      "comment_task",
      "task",
      taskId,
      { commentId: result.rows[0].id },
      auth.user,
    );
    await client.query("COMMIT");
    return json({ ok: true, commentId: result.rows[0].id }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function moveTaskStage(request: Request, taskId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  const body = await readJson(request);
  const stageId = requireText(body.stageId, "Stage id");
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT id, stage_id FROM tasks WHERE id = $1 FOR UPDATE", [
      taskId,
    ]);
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return json({ error: "Task not found" }, { status: 404 });
    }

    const stage = await client.query(
      "SELECT id, name, is_terminal FROM task_stages WHERE id = $1",
      [stageId],
    );
    if (!stage.rows[0]) {
      await client.query("ROLLBACK");
      return json({ error: "Task stage not found" }, { status: 404 });
    }

    await client.query(
      `UPDATE tasks
       SET stage_id = $1,
           status = CASE WHEN $2 THEN 'done' ELSE CASE WHEN status = 'done' THEN 'open' ELSE status END END,
           completed_at = CASE WHEN $2 THEN now() ELSE NULL END,
           updated_at = now()
       WHERE id = $3`,
      [stageId, stage.rows[0].is_terminal, taskId],
    );
    await client.query(
      "INSERT INTO task_stage_history (task_id, from_stage_id, to_stage_id, actor_id) VALUES ($1, $2, $3, $4)",
      [taskId, current.rows[0].stage_id, stageId, auth.user.id],
    );
    await refreshTaskEmbedding(client, taskId);
    await audit(
      client,
      "move_task_stage",
      "task",
      taskId,
      { toStageId: stageId, toStage: stage.rows[0].name },
      auth.user,
    );
    await client.query("COMMIT");
    return json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function convertDealToProject(request: Request, dealId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const deal = await client.query(
      `SELECT d.*, o.name AS organization_name
       FROM deals d
       LEFT JOIN organizations o ON o.id = d.organization_id
       WHERE d.id = $1
       FOR UPDATE`,
      [dealId],
    );
    if (!deal.rows[0]) {
      await client.query("ROLLBACK");
      return json({ error: "Deal not found" }, { status: 404 });
    }
    if (deal.rows[0].project_id) {
      await client.query("COMMIT");
      return json({ ok: true, projectId: deal.rows[0].project_id, existing: true });
    }

    const project = await client.query(
      `INSERT INTO projects (
        organization_id, deal_id, owner_id, name, budget_cents, currency, description, due_on
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, current_date + 45)
       RETURNING id, name`,
      [
        deal.rows[0].organization_id,
        dealId,
        deal.rows[0].owner_id ?? auth.user.id,
        deal.rows[0].title,
        deal.rows[0].value_cents,
        deal.rows[0].currency,
        deal.rows[0].description,
      ],
    );

    await client.query("UPDATE deals SET project_id = $1, updated_at = now() WHERE id = $2", [
      project.rows[0].id,
      dealId,
    ]);

    const deliverableTitles = [
      "Project kickoff and risk context",
      "Site assessment and evidence pack",
      "Recommendations report",
      "Client review and sign-off",
    ];
    for (const [index, title] of deliverableTitles.entries()) {
      await client.query(
        `INSERT INTO deliverables (
          project_id, deal_id, organization_id, owner_id, title, status, due_on
         )
         VALUES ($1, $2, $3, $4, $5, $6, current_date + ($7::int * 10))`,
        [
          project.rows[0].id,
          dealId,
          deal.rows[0].organization_id,
          deal.rows[0].owner_id ?? auth.user.id,
          title,
          index === 0 ? "in_progress" : "not_started",
          index + 1,
        ],
      );
    }

    const board = await ensureTaskBoard(
      client,
      `${project.rows[0].name} Board`,
      project.rows[0].id,
    );
    const backlog = board.stages.find((stage) => stage.name === "Backlog") ?? board.stages[0];
    const kickoffTask = await client.query(
      `INSERT INTO tasks (
        board_id, stage_id, project_id, deal_id, organization_id, owner_id, title, description, priority, due_at, source
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'Schedule kickoff', $7, 'high', now() + interval '3 days', 'deal_conversion')
       RETURNING id`,
      [
        board.boardId,
        backlog.id,
        project.rows[0].id,
        dealId,
        deal.rows[0].organization_id,
        deal.rows[0].owner_id ?? auth.user.id,
        `Confirm project kickoff for ${deal.rows[0].organization_name ?? project.rows[0].name}.`,
      ],
    );
    await refreshTaskEmbedding(client, kickoffTask.rows[0].id);

    await refreshProjectEmbedding(client, project.rows[0].id);

    await audit(
      client,
      "convert_deal_to_project",
      "project",
      project.rows[0].id,
      { dealId },
      auth.user,
    );
    await client.query("COMMIT");
    return json({ ok: true, projectId: project.rows[0].id }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function projects(request: Request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  if (request.method === "POST") {
    const body = await readJson(request);
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const draft = await createProjectDraftRecord(client, auth.user.id, body);
      await audit(client, "create_project", "project", draft.projectId, {}, auth.user);
      await client.query("COMMIT");
      return json({ ok: true, projectId: draft.projectId }, { status: 201 });
    } catch (error) {
      await client.query("ROLLBACK");
      const response = responseFromError(error);
      if (response) return response;
      throw error;
    } finally {
      client.release();
    }
  }

  const rows = await getPool().query(`
    SELECT p.id, p.name, p.status, p.priority, p.budget_cents, p.currency, p.due_on,
      o.name AS organization_name, d.id AS deal_id, d.title AS deal_title,
      count(DISTINCT de.id)::int AS deliverables,
      count(DISTINCT t.id) FILTER (WHERE t.status IN ('open', 'blocked'))::int AS active_tasks
    FROM projects p
    LEFT JOIN organizations o ON o.id = p.organization_id
    LEFT JOIN deals d ON d.id = p.deal_id
    LEFT JOIN deliverables de ON de.project_id = p.id
    LEFT JOIN tasks t ON t.project_id = p.id
    GROUP BY p.id, o.name, d.id, d.title
    ORDER BY p.updated_at DESC
    LIMIT 100
  `);
  return json({ projects: rows.rows });
}

async function hasClientSignoffForContext(
  client: pg.Pool | pg.PoolClient,
  context: { projectId?: string | null; workItemId?: string | null },
) {
  if (!context.projectId && !context.workItemId) return true;
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1
       FROM client_signatures cs
       JOIN client_signoff_links csl ON csl.id = cs.signoff_link_id
       LEFT JOIN service_reports sr
         ON csl.target_type = 'service_report' AND sr.id = csl.target_id
       LEFT JOIN job_cards jc
         ON csl.target_type = 'job_card' AND jc.id = csl.target_id
       LEFT JOIN work_items wi ON wi.id = COALESCE(sr.work_item_id, jc.work_item_id)
       WHERE csl.status = 'submitted'
         AND (
           ($1::uuid IS NOT NULL AND sr.project_id = $1::uuid)
           OR ($2::uuid IS NOT NULL AND wi.id = $2::uuid)
         )
     ) AS ok`,
    [context.projectId ?? null, context.workItemId ?? null],
  );
  return Boolean(result.rows[0]?.ok);
}

async function invoices(request: Request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  if (request.method === "POST") {
    const body = await readJson(request);
    const totalCents = centsFromValue(body.total);
    const projectId = optionalText(body.projectId);
    const dealId = optionalText(body.dealId);
    let resolvedProjectId = projectId;
    if (!resolvedProjectId && dealId) {
      const deal = await getPool().query("SELECT project_id FROM deals WHERE id = $1", [dealId]);
      resolvedProjectId = deal.rows[0]?.project_id ?? null;
    }
    if (resolvedProjectId) {
      const signedOff = await hasClientSignoffForContext(getPool(), {
        projectId: resolvedProjectId,
      });
      if (!signedOff) return json({ error: "Awaiting client sign-off" }, { status: 409 });
    }
    const result = await getPool().query(
      `INSERT INTO invoices (
        invoice_number, organization_id, project_id, deal_id, client_po_id, sales_order_id,
        work_item_id, owner_id, status,
        subtotal_cents, tax_cents, total_cents, issued_on, due_on, notes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'draft'), $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      [
        optionalText(body.invoiceNumber),
        body.organizationId ?? null,
        resolvedProjectId,
        dealId,
        optionalText(body.clientPoId),
        optionalText(body.salesOrderId),
        optionalText(body.workItemId),
        auth.user.id,
        optionalText(body.status),
        totalCents,
        0,
        totalCents,
        optionalText(body.issuedOn),
        optionalText(body.dueOn),
        optionalText(body.notes),
      ],
    );
    await audit(getPool(), "create_invoice", "invoice", result.rows[0].id, {}, auth.user);
    return json({ ok: true, invoiceId: result.rows[0].id }, { status: 201 });
  }

  const rows = await getPool().query(`
    SELECT i.id, i.invoice_number, i.status, i.currency, i.total_cents, i.issued_on, i.due_on,
      i.paid_at, i.client_po_id, i.sales_order_id, i.work_item_id,
      o.name AS organization_name, p.name AS project_name, d.title AS deal_title,
      cp.po_number AS client_po_number, so.sales_order_number, wi.title AS work_item_title
    FROM invoices i
    LEFT JOIN organizations o ON o.id = i.organization_id
    LEFT JOIN projects p ON p.id = i.project_id
    LEFT JOIN deals d ON d.id = i.deal_id
    LEFT JOIN client_pos cp ON cp.id = i.client_po_id
    LEFT JOIN sales_orders so ON so.id = i.sales_order_id
    LEFT JOIN work_items wi ON wi.id = i.work_item_id
    ORDER BY i.due_on ASC NULLS LAST, i.created_at DESC
    LIMIT 100
  `);
  return json({ invoices: rows.rows });
}

async function paymentReleaseView(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const rows = await getPool().query(`
    SELECT spo.id, spo.po_number, spo.status, spo.amount_cents, spo.due_on,
      sc.name AS subcontractor_name,
      wi.id AS work_item_id, wi.title AS work_item_title,
      p.id AS project_id, p.name AS project_name,
      cp.po_number AS client_po_number, cp.status AS client_po_status,
      so.sales_order_number, so.status AS sales_order_status,
      inv.id AS invoice_id, inv.invoice_number, inv.status AS invoice_status,
      inv.total_cents AS invoice_total_cents,
      CASE
        WHEN spo.status NOT IN ('complete', 'invoiced') THEN 'Job not complete'
        WHEN inv.id IS NULL THEN 'No linked client invoice'
        WHEN inv.status <> 'paid' THEN 'Client invoice not paid'
        ELSE 'Ready for release'
      END AS release_reason,
      (
        spo.status IN ('complete', 'invoiced')
        AND inv.status = 'paid'
      ) AS release_ready
    FROM subcontractor_pos spo
    JOIN subcontractors sc ON sc.id = spo.subcontractor_id
    LEFT JOIN work_items wi ON wi.id = spo.work_item_id
    LEFT JOIN projects p ON p.id = spo.project_id
    LEFT JOIN LATERAL (
      SELECT cp.*
      FROM client_pos cp
      WHERE cp.id = spo.client_po_id
         OR (spo.client_po_id IS NULL AND cp.work_item_id = spo.work_item_id)
         OR (spo.client_po_id IS NULL AND spo.work_item_id IS NULL AND cp.project_id = spo.project_id)
      ORDER BY (cp.id = spo.client_po_id) DESC, cp.updated_at DESC
      LIMIT 1
    ) cp ON true
    LEFT JOIN LATERAL (
      SELECT so.*
      FROM sales_orders so
      WHERE (so.work_item_id = spo.work_item_id)
         OR (spo.work_item_id IS NULL AND so.project_id = spo.project_id)
         OR (cp.id IS NOT NULL AND so.client_po_id = cp.id)
      ORDER BY (cp.id IS NOT NULL AND so.client_po_id = cp.id) DESC, so.updated_at DESC
      LIMIT 1
    ) so ON true
    LEFT JOIN LATERAL (
      SELECT i.*
      FROM invoices i
      WHERE i.work_item_id = spo.work_item_id
         OR i.project_id = spo.project_id
         OR i.client_po_id = cp.id
         OR i.sales_order_id = so.id
      ORDER BY
        (i.work_item_id = spo.work_item_id) DESC,
        (i.client_po_id = cp.id) DESC,
        i.updated_at DESC
      LIMIT 1
    ) inv ON true
    WHERE spo.status NOT IN ('paid', 'cancelled')
    ORDER BY release_ready DESC, spo.due_on ASC NULLS LAST, spo.created_at DESC
    LIMIT 200
  `);
  return json({ paymentReleases: rows.rows });
}

async function subcontractorPos(request: Request, subcontractorPoId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  if (request.method === "PATCH") {
    const body = await readJson(request);
    const status = requireOneOf(body.status, "Status", [
      "draft",
      "issued",
      "accepted",
      "complete",
      "invoiced",
      "paid",
      "cancelled",
    ] as const);
    const current = await getPool().query(
      `SELECT id, work_item_id, project_id, status
       FROM subcontractor_pos
       WHERE id = $1`,
      [subcontractorPoId],
    );
    const row = current.rows[0];
    if (!row) return json({ error: "Subcontractor PO not found" }, { status: 404 });
    if (status === "paid") {
      const ok = await hasClientSignoffForContext(getPool(), {
        projectId: row.project_id as string | null,
        workItemId: row.work_item_id as string | null,
      });
      if (!ok) return json({ error: "Awaiting client sign-off" }, { status: 409 });
    }
    const updated = await getPool().query(
      `UPDATE subcontractor_pos
       SET status = $2, updated_at = now()
       WHERE id = $1
       RETURNING id, status`,
      [subcontractorPoId, status],
    );
    await audit(
      getPool(),
      `update_subcontractor_po_${status}`,
      "subcontractor_po",
      subcontractorPoId,
      {},
      auth.user,
    );
    return json({ ok: true, subcontractorPo: updated.rows[0] });
  }

  return json({ error: "Not found" }, { status: 404 });
}

async function operatingOverview(request: Request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  const [clientPos, salesOrders, workItems, reports, jobCards, risks, approvals] =
    await Promise.all([
      getPool().query("SELECT status, count(*)::int AS count FROM client_pos GROUP BY status"),
      getPool().query("SELECT status, count(*)::int AS count FROM sales_orders GROUP BY status"),
      getPool().query("SELECT status, count(*)::int AS count FROM work_items GROUP BY status"),
      getPool().query("SELECT status, count(*)::int AS count FROM service_reports GROUP BY status"),
      getPool().query("SELECT status, count(*)::int AS count FROM job_cards GROUP BY status"),
      getPool().query(
        "SELECT severity, status, count(*)::int AS count FROM risks GROUP BY severity, status",
      ),
      getPool().query(
        "SELECT status, count(*)::int AS count FROM approval_requests GROUP BY status",
      ),
    ]);

  return json({
    clientPos: clientPos.rows,
    salesOrders: salesOrders.rows,
    workItems: workItems.rows,
    reports: reports.rows,
    jobCards: jobCards.rows,
    risks: risks.rows,
    approvals: approvals.rows,
  });
}

async function clientFolders(request: Request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  if (request.method === "POST") {
    const body = await readJson(request);
    const name = requireText(body.name, "Customer name");
    const relationshipType = requireOneOf(
      optionalText(body.relationshipType) ?? "end_user",
      "Relationship type",
      ["strategic", "collaborative", "end_user"] as const,
    );
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const organization = await client.query(
        `INSERT INTO organizations (name, industry, website, relationship_type)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, industry, website, relationship_type, created_at`,
        [name, optionalText(body.industry), optionalText(body.website), relationshipType],
      );
      const contactFirstName = optionalText(body.contactFirstName);
      const contactLastName = optionalText(body.contactLastName) ?? "";
      const contactEmail = optionalText(body.contactEmail);
      const contactPhone = optionalText(body.contactPhone);
      let contactId: string | null = null;
      if (contactFirstName || contactEmail || contactPhone) {
        const contact = await client.query(
          `INSERT INTO contacts (
             organization_id, first_name, last_name, email, phone, role_title, status, owner_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, 'Client', $7)
           RETURNING id`,
          [
            organization.rows[0].id,
            contactFirstName ?? "Primary contact",
            contactLastName,
            contactEmail,
            contactPhone,
            optionalText(body.contactRole),
            auth.user.id,
          ],
        );
        contactId = contact.rows[0].id;
        await client.query("UPDATE organizations SET primary_contact_id = $1 WHERE id = $2", [
          contactId,
          organization.rows[0].id,
        ]);
      }
      await client.query(
        `INSERT INTO embedding_documents (entity_type, entity_id, content, metadata)
         VALUES ('organization', $1, $2, $3::jsonb)`,
        [
          organization.rows[0].id,
          [name, optionalText(body.industry), optionalText(body.website)]
            .filter(Boolean)
            .join("\n"),
          JSON.stringify({ source: "staff", organizationId: organization.rows[0].id }),
        ],
      );
      await audit(
        client,
        "create_customer",
        "organization",
        organization.rows[0].id,
        { contactId },
        auth.user,
      );
      await client.query("COMMIT");
      return json({ ok: true, customer: organization.rows[0], contactId }, { status: 201 });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if ((error as { code?: string }).code === "23505") {
        return json(
          { error: "A customer with this name or contact email already exists" },
          { status: 409 },
        );
      }
      const response = responseFromError(error);
      if (response) return response;
      throw error;
    } finally {
      client.release();
    }
  }

  const rows = await getPool().query(`
    SELECT
      o.id,
      o.name,
      count(DISTINCT c.id)::int AS contacts,
      count(DISTINCT s.id)::int AS sites,
      count(DISTINCT b.id)::int AS buildings,
      count(DISTINCT a.id)::int AS assets,
      count(DISTINCT p.id)::int AS projects,
      count(DISTINCT wi.id)::int AS work_items,
      count(DISTINCT q.id)::int AS quotes,
      count(DISTINCT cp.id)::int AS client_pos,
      count(DISTINCT sr.id)::int AS reports,
      count(DISTINCT i.id)::int AS invoices,
      count(DISTINCT ef.id)::int AS evidence,
      count(DISTINCT r.id)::int AS risks,
      COALESCE(sum(DISTINCT q.total_value_cents)::int, 0) AS quoted_value_cents,
      COALESCE(sum(DISTINCT i.total_cents)::int, 0) AS invoice_value_cents
    FROM organizations o
    LEFT JOIN contacts c ON c.organization_id = o.id
    LEFT JOIN sites s ON s.organization_id = o.id
    LEFT JOIN buildings b ON b.site_id = s.id
    LEFT JOIN assets a ON a.organization_id = o.id
    LEFT JOIN projects p ON p.organization_id = o.id
    LEFT JOIN work_items wi ON wi.organization_id = o.id
    LEFT JOIN quotes q ON q.organization_id = o.id
    LEFT JOIN client_pos cp ON cp.organization_id = o.id
    LEFT JOIN service_reports sr ON sr.organization_id = o.id
    LEFT JOIN invoices i ON i.organization_id = o.id
    LEFT JOIN evidence_files ef ON ef.organization_id = o.id
    LEFT JOIN risks r ON r.organization_id = o.id
    GROUP BY o.id
    ORDER BY o.name
    LIMIT 500
  `);

  return json({ clients: rows.rows });
}

async function clientFolderDetail(request: Request, organizationId: string) {
  const auth = await requireUser(
    request,
    request.method === "PATCH" ? ["admin", "staff"] : undefined,
  );
  if (auth.response) return auth.response;

  if (request.method === "PATCH") {
    const body = await readJson(request);
    const relationshipType = requireOneOf(body.relationshipType, "Relationship type", [
      "strategic",
      "collaborative",
      "end_user",
    ] as const);
    const result = await getPool().query(
      `UPDATE organizations
       SET relationship_type = $1, updated_at = now()
       WHERE id = $2
       RETURNING id, name, industry, website, relationship_type`,
      [relationshipType, organizationId],
    );
    if (!result.rows[0]) return json({ error: "Client not found" }, { status: 404 });
    await audit(
      getPool(),
      "update_customer_relationship_type",
      "organization",
      organizationId,
      { relationshipType },
      auth.user,
    );
    return json({ ok: true, client: result.rows[0] });
  }

  const [
    organization,
    contactsRows,
    sitesRows,
    assetsRows,
    workRows,
    quotesRows,
    poRows,
    reportsRows,
    invoiceRows,
    evidenceRows,
    riskRows,
  ] = await Promise.all([
    getPool().query(
      "SELECT id, name, industry, website, relationship_type FROM organizations WHERE id = $1",
      [organizationId],
    ),
    getPool().query(
      "SELECT id, first_name, last_name, email, phone, role_title, status FROM contacts WHERE organization_id = $1 ORDER BY updated_at DESC LIMIT 100",
      [organizationId],
    ),
    getPool().query(
      "SELECT id, name, address, status FROM sites WHERE organization_id = $1 ORDER BY name LIMIT 100",
      [organizationId],
    ),
    getPool().query(
      "SELECT id, name, asset_type, manufacturer, model, status, site_id FROM assets WHERE organization_id = $1 ORDER BY updated_at DESC LIMIT 100",
      [organizationId],
    ),
    getPool().query(
      "SELECT id, title, work_type, status, priority, scheduled_for FROM work_items WHERE organization_id = $1 ORDER BY updated_at DESC LIMIT 100",
      [organizationId],
    ),
    getPool().query(
      "SELECT id, quote_number, status, total_value_cents, valid_until FROM quotes WHERE organization_id = $1 ORDER BY updated_at DESC LIMIT 100",
      [organizationId],
    ),
    getPool().query(
      "SELECT id, po_number, status, amount_cents, received_on, file_name FROM client_pos WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100",
      [organizationId],
    ),
    getPool().query(
      `SELECT sr.id, sr.title, sr.report_type, sr.status, sr.created_at,
        csl.id AS signoff_link_id, csl.status AS signoff_link_status, csl.expires_at AS signoff_expires_at,
        cs.signed_at AS signoff_signed_at, cs.signer_name AS signoff_signer_name, cs.signer_role AS signoff_signer_role
       FROM service_reports sr
       LEFT JOIN client_signoff_links csl
         ON csl.target_type = 'service_report' AND csl.target_id = sr.id
       LEFT JOIN LATERAL (
         SELECT signed_at, signer_name, signer_role
         FROM client_signatures
         WHERE signoff_link_id = csl.id
         ORDER BY signed_at DESC
         LIMIT 1
       ) cs ON true
       WHERE sr.organization_id = $1
       ORDER BY sr.updated_at DESC
       LIMIT 100`,
      [organizationId],
    ),
    getPool().query(
      "SELECT id, invoice_number, status, total_cents, due_on FROM invoices WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100",
      [organizationId],
    ),
    getPool().query(
      "SELECT id, evidence_type, file_name, notes, created_at FROM evidence_files WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100",
      [organizationId],
    ),
    getPool().query(
      "SELECT id, title, severity, status, recommended_action, created_at FROM risks WHERE organization_id = $1 ORDER BY updated_at DESC LIMIT 100",
      [organizationId],
    ),
  ]);

  if (!organization.rows[0]) return json({ error: "Client not found" }, { status: 404 });

  return json({
    client: organization.rows[0],
    contacts: contactsRows.rows,
    sites: sitesRows.rows,
    assets: assetsRows.rows,
    work: workRows.rows,
    quotes: quotesRows.rows,
    pos: poRows.rows,
    reports: reportsRows.rows,
    invoices: invoiceRows.rows,
    evidence: evidenceRows.rows,
    risks: riskRows.rows,
  });
}

async function createSalesOrderDraftForClientPo(
  client: pg.Pool | pg.PoolClient,
  params: {
    clientPoId: string;
    salesOrderNumber?: string | null;
    sageReference?: string | null;
    total?: unknown;
    createdBy: string;
  },
) {
  const po = await client.query(
    `SELECT id, organization_id, quote_id, project_id, work_item_id, amount_cents
     FROM client_pos
     WHERE id = $1
     FOR UPDATE`,
    [params.clientPoId],
  );
  const row = po.rows[0];
  if (!row) return null;

  const result = await client.query(
    `INSERT INTO sales_orders (
      organization_id, client_po_id, quote_id, project_id, work_item_id, sales_order_number,
      status, sage_reference, total_cents, created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, $9)
     RETURNING id`,
    [
      row.organization_id,
      params.clientPoId,
      row.quote_id,
      row.project_id,
      row.work_item_id,
      params.salesOrderNumber ?? null,
      params.sageReference ?? null,
      centsFromValue(params.total) || Number(row.amount_cents ?? 0),
      params.createdBy,
    ],
  );
  await client.query(
    "UPDATE client_pos SET status = 'sales_order_draft', updated_at = now() WHERE id = $1",
    [params.clientPoId],
  );
  return result.rows[0].id as string;
}

async function poInbox(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  if (request.method === "POST") {
    const body = await readJson(request);
    const quoteId = optionalText(body.quoteId);
    const client = await getPool().connect();

    try {
      await client.query("BEGIN");
      const quote =
        quoteId &&
        (await client.query(
          `SELECT id, organization_id, site_id, quote_number, total_value_cents
           FROM quotes
           WHERE id = $1`,
          [quoteId],
        ));
      if (quoteId && !quote?.rows[0]) {
        await client.query("ROLLBACK");
        return json({ error: "Quote not found" }, { status: 404 });
      }

      const quoteRow = quote?.rows[0] ?? null;
      const organizationId =
        optionalText(body.organizationId) ?? (quoteRow?.organization_id as string | null);
      const siteId = optionalText(body.siteId) ?? (quoteRow?.site_id as string | null);
      const status = quoteId ? "matched" : (optionalText(body.status) ?? "unmatched");
      const amountCents = centsFromValue(body.amount);
      const result = await client.query(
        `INSERT INTO client_pos (
          organization_id, site_id, project_id, work_item_id, quote_id, uploaded_by,
          po_number, status, amount_cents, received_on, file_name, extracted_payload
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, current_date), $11, $12::jsonb)
         RETURNING id`,
        [
          organizationId,
          siteId,
          optionalText(body.projectId),
          optionalText(body.workItemId),
          quoteId,
          auth.user.id,
          optionalText(body.poNumber),
          status,
          amountCents,
          optionalText(body.receivedOn),
          optionalText(body.fileName),
          JSON.stringify(
            asRecord({
              ...asRecord(body.extractedPayload),
              quoteId: quoteRow?.id ?? null,
              quoteNumber: quoteRow?.quote_number ?? null,
              matched: Boolean(quoteRow),
            }),
          ),
        ],
      );

      let salesOrderId: string | null = null;
      if (quoteRow) {
        salesOrderId = await createSalesOrderDraftForClientPo(client, {
          clientPoId: result.rows[0].id,
          createdBy: auth.user.id,
          total: quoteRow.total_value_cents,
        });
      }

      await audit(
        client,
        "create_client_po",
        "client_po",
        result.rows[0].id,
        {
          matched: Boolean(quoteRow),
          salesOrderDraftId: salesOrderId,
        },
        auth.user,
      );
      await client.query("COMMIT");
      return json(
        {
          ok: true,
          poId: result.rows[0].id,
          salesOrderDraftId: salesOrderId,
          matched: Boolean(quoteRow),
        },
        { status: 201 },
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  const [pos, quoteCandidates] = await Promise.all([
    getPool().query(`
      SELECT cp.id, cp.po_number, cp.status, cp.amount_cents, cp.received_on, cp.file_name,
        o.name AS organization_name, s.name AS site_name, q.quote_number, p.name AS project_name,
        so.id AS sales_order_id, so.status AS sales_order_status
      FROM client_pos cp
      LEFT JOIN organizations o ON o.id = cp.organization_id
      LEFT JOIN sites s ON s.id = cp.site_id
      LEFT JOIN quotes q ON q.id = cp.quote_id
      LEFT JOIN projects p ON p.id = cp.project_id
      LEFT JOIN sales_orders so ON so.client_po_id = cp.id
      ORDER BY cp.created_at DESC
      LIMIT 200
    `),
    getPool().query(`
      SELECT q.id, q.quote_number, q.status, q.total_value_cents, o.name AS organization_name, s.name AS site_name
      FROM quotes q
      JOIN organizations o ON o.id = q.organization_id
      JOIN sites s ON s.id = q.site_id
      WHERE q.status IN ('sent_to_client', 'accepted', 'approved_internal')
      ORDER BY q.updated_at DESC
      LIMIT 200
    `),
  ]);

  return json({ pos: pos.rows, quoteCandidates: quoteCandidates.rows });
}

async function salesOrderDraft(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  const body = await readJson(request);
  const clientPoId = requireText(body.clientPoId, "Client PO");
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const salesOrderId = await createSalesOrderDraftForClientPo(client, {
      clientPoId,
      salesOrderNumber: optionalText(body.salesOrderNumber),
      sageReference: optionalText(body.sageReference),
      total: body.total,
      createdBy: auth.user.id,
    });
    if (!salesOrderId) {
      await client.query("ROLLBACK");
      return json({ error: "Client PO not found" }, { status: 404 });
    }
    await audit(client, "create_sales_order_draft", "sales_order", salesOrderId, {}, auth.user);
    await client.query("COMMIT");
    return json({ ok: true, salesOrderId }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const response = responseFromError(error);
    if (response) return response;
    throw error;
  } finally {
    client.release();
  }
}

async function fieldWork(request: Request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  if (request.method === "POST") {
    const body = await readJson(request);
    const result = await getPool().query(
      `INSERT INTO work_items (
        organization_id, site_id, building_id, area_id, asset_id, project_id, deal_id, quote_id,
        owner_id, title, work_type, status, priority, scope, scheduled_for
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, 'service'), COALESCE($12, 'new'), COALESCE($13, 'medium'), $14, $15)
       RETURNING id`,
      [
        optionalText(body.organizationId),
        optionalText(body.siteId),
        optionalText(body.buildingId),
        optionalText(body.areaId),
        optionalText(body.assetId),
        optionalText(body.projectId),
        optionalText(body.dealId),
        optionalText(body.quoteId),
        auth.user.id,
        requireText(body.title, "Work title"),
        optionalText(body.workType),
        optionalText(body.status),
        optionalText(body.priority),
        optionalText(body.scope),
        optionalText(body.scheduledFor),
      ],
    );
    await audit(getPool(), "create_work_item", "work_item", result.rows[0].id, {}, auth.user);
    return json({ ok: true, workItemId: result.rows[0].id }, { status: 201 });
  }

  const rows = await getPool().query(`
    SELECT wi.id, wi.title, wi.work_type, wi.status, wi.priority, wi.scope, wi.scheduled_for,
      o.name AS organization_name, s.name AS site_name, p.name AS project_name,
      count(DISTINCT fs.id)::int AS submissions,
      count(DISTINCT jc.id) FILTER (WHERE jc.status IN ('missing', 'uploaded'))::int AS job_cards_waiting,
      count(DISTINCT sr.id) FILTER (WHERE sr.status IN ('draft', 'pending_vusi_approval'))::int AS reports_waiting,
      COALESCE(json_agg(DISTINCT jsonb_build_object(
        'id', jc.id, 'status', jc.status, 'parentJobCardId', jc.parent_job_card_id,
        'authorizedBy', jc.authorized_by, 'signedByName', jc.signed_by_name, 'signedAt', jc.signed_at
      )) FILTER (WHERE jc.id IS NOT NULL), '[]'::json) AS job_cards
    FROM work_items wi
    LEFT JOIN organizations o ON o.id = wi.organization_id
    LEFT JOIN sites s ON s.id = wi.site_id
    LEFT JOIN projects p ON p.id = wi.project_id
    LEFT JOIN field_submissions fs ON fs.work_item_id = wi.id
    LEFT JOIN job_cards jc ON jc.work_item_id = wi.id
    LEFT JOIN service_reports sr ON sr.work_item_id = wi.id
    GROUP BY wi.id, o.name, s.name, p.name
    ORDER BY wi.scheduled_for ASC NULLS LAST, wi.updated_at DESC
    LIMIT 200
  `);
  return json({ jobs: rows.rows });
}

async function jobCards(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = request.method === "POST" ? asRecord(await readJson(request)) : {};
  if (request.method === "GET") {
    const workItemId = new URL(request.url).searchParams.get("workItemId");
    const result = await getPool().query(
      `SELECT jc.id, jc.work_item_id, jc.field_submission_id, jc.parent_job_card_id,
        jc.authorized_by, jc.status, jc.signed_by_name, jc.signed_at, jc.created_at,
        wi.title AS work_item_title
       FROM job_cards jc LEFT JOIN work_items wi ON wi.id = jc.work_item_id
       WHERE ($1::uuid IS NULL OR jc.work_item_id = $1::uuid)
       ORDER BY jc.created_at DESC`,
      [workItemId],
    );
    return json({ jobCards: result.rows });
  }

  const parentJobCardId = optionalText(body.parentJobCardId);
  if (parentJobCardId && !optionalText(body.authorizedBy)) {
    return json(
      { error: "Coordinator authorization is required for a sub-job-card" },
      { status: 400 },
    );
  }
  const requestedWorkItemId = optionalText(body.workItemId);
  let workItemId = requestedWorkItemId;
  if (parentJobCardId) {
    const parent = await getPool().query("SELECT id, work_item_id FROM job_cards WHERE id = $1", [
      parentJobCardId,
    ]);
    if (!parent.rows[0]) return json({ error: "Parent job card not found" }, { status: 404 });
    if (workItemId && parent.rows[0].work_item_id && workItemId !== parent.rows[0].work_item_id) {
      return json({ error: "Sub-job-card must use the parent work item" }, { status: 400 });
    }
    workItemId = workItemId ?? parent.rows[0].work_item_id;
  }
  if (!workItemId) return json({ error: "Work item is required" }, { status: 400 });
  const workItem = await getPool().query("SELECT id FROM work_items WHERE id = $1", [workItemId]);
  if (!workItem.rows[0]) return json({ error: "Work item not found" }, { status: 404 });
  const result = await getPool().query(
    `INSERT INTO job_cards (work_item_id, field_submission_id, parent_job_card_id, authorized_by, status)
     VALUES ($1, $2, $3, $4, 'missing')
     RETURNING id, work_item_id, field_submission_id, parent_job_card_id, authorized_by, status, created_at`,
    [
      workItemId,
      optionalText(body.fieldSubmissionId),
      parentJobCardId,
      optionalText(body.authorizedBy),
    ],
  );
  await audit(
    getPool(),
    parentJobCardId ? "create_sub_job_card" : "create_job_card",
    "job_card",
    result.rows[0].id,
    { parentJobCardId, authorizedBy: optionalText(body.authorizedBy) },
    auth.user,
  );
  return json({ ok: true, jobCard: result.rows[0] }, { status: 201 });
}

async function complianceContext(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const [visits, areas, assets] = await Promise.all([
    getPool().query(
      `SELECT sv.id, sv.site_id, sv.started_at, sv.status, s.name AS site_name, o.name AS organization_name FROM site_visits sv JOIN sites s ON s.id = sv.site_id JOIN organizations o ON o.id = sv.organization_id ORDER BY sv.started_at DESC LIMIT 200`,
    ),
    getPool().query(
      `SELECT a.id, a.site_id, a.name, a.area_type, s.name AS site_name FROM areas a JOIN sites s ON s.id = a.site_id ORDER BY s.name, a.name`,
    ),
    getPool().query(
      `SELECT a.id, a.area_id, a.site_id, a.name, a.asset_type, ar.name AS area_name FROM assets a LEFT JOIN areas ar ON ar.id = a.area_id ORDER BY a.name`,
    ),
  ]);
  return json({ visits: visits.rows, areas: areas.rows, assets: assets.rows });
}

async function complianceRecords(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  if (request.method === "GET") {
    const result = await getPool().query(
      `SELECT cr.*, a.name AS area_name, a.area_type, ast.name AS asset_name,
        sv.started_at AS visit_started_at, s.name AS site_name, o.name AS organization_name,
        u.name AS assessed_by_name,
        row_number() OVER (PARTITION BY cr.area_id, cr.asset_id ORDER BY cr.assessed_at DESC) = 1 AS is_current
       FROM compliance_records cr
       JOIN areas a ON a.id = cr.area_id
       LEFT JOIN assets ast ON ast.id = cr.asset_id
       JOIN site_visits sv ON sv.id = cr.site_visit_id
       JOIN sites s ON s.id = sv.site_id
       JOIN organizations o ON o.id = sv.organization_id
       LEFT JOIN app_users u ON u.id = cr.assessed_by
       ORDER BY cr.assessed_at DESC LIMIT 500`,
    );
    return json({ records: result.rows });
  }
  const body = asRecord(await readJson(request));
  const areaId = requireText(body.areaId, "Area");
  const siteVisitId = requireText(body.siteVisitId, "Site visit");
  const status = requireOneOf(body.status, "Status", ["green", "red", "yellow"] as const);
  const note = optionalText(body.note);
  if (status === "yellow" && !note)
    return json({ error: "A note is required for yellow compliance" }, { status: 400 });
  const assetId = optionalText(body.assetId);
  const context = await getPool().query(
    `SELECT a.site_id, sv.site_id AS visit_site_id FROM areas a JOIN site_visits sv ON sv.id = $2 WHERE a.id = $1`,
    [areaId, siteVisitId],
  );
  if (!context.rows[0]) return json({ error: "Area or site visit not found" }, { status: 404 });
  if (context.rows[0].site_id !== context.rows[0].visit_site_id)
    return json({ error: "Area and site visit must belong to the same site" }, { status: 400 });
  if (assetId) {
    const asset = await getPool().query("SELECT id FROM assets WHERE id = $1 AND area_id = $2", [
      assetId,
      areaId,
    ]);
    if (!asset.rows[0])
      return json({ error: "Asset does not belong to the selected area" }, { status: 400 });
  }
  const result = await getPool().query(
    `INSERT INTO compliance_records (area_id, asset_id, site_visit_id, status, note, assessed_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [areaId, assetId, siteVisitId, status, note, auth.user.id],
  );
  await audit(
    getPool(),
    "create_compliance_record",
    "compliance_record",
    result.rows[0].id,
    { status, areaId, assetId },
    auth.user,
  );
  return json({ ok: true, record: result.rows[0] }, { status: 201 });
}

async function complianceRecordLinks(request: Request, recordId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = asRecord(await readJson(request));
  const result = await getPool().query(
    `UPDATE compliance_records SET service_report_id = COALESCE($2, service_report_id), quote_id = COALESCE($3, quote_id)
     WHERE id = $1 RETURNING *`,
    [recordId, optionalText(body.serviceReportId), optionalText(body.quoteId)],
  );
  if (!result.rows[0]) return json({ error: "Compliance record not found" }, { status: 404 });
  await audit(
    getPool(),
    "link_compliance_record",
    "compliance_record",
    recordId,
    { serviceReportId: optionalText(body.serviceReportId), quoteId: optionalText(body.quoteId) },
    auth.user,
  );
  return json({ ok: true, record: result.rows[0] });
}

function requestOriginMetadata(request: Request) {
  return {
    ip:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      null,
    userAgent: request.headers.get("user-agent"),
  };
}

async function siteVisits(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  if (request.method === "GET") {
    const result = await getPool().query(
      `SELECT sv.*, o.name AS organization_name, s.name AS site_name, p.name AS project_name,
        c.name AS container_name, cp.po_number, wi.title AS work_item_title
       FROM site_visits sv
       JOIN organizations o ON o.id = sv.organization_id
       JOIN sites s ON s.id = sv.site_id
       JOIN containers c ON c.id = sv.container_id
       LEFT JOIN projects p ON p.id = sv.project_id
       LEFT JOIN client_pos cp ON cp.id = sv.client_po_id
       LEFT JOIN work_items wi ON wi.id = sv.work_item_id
       ORDER BY sv.started_at DESC LIMIT 200`,
    );
    return json({ siteVisits: result.rows });
  }
  const body = asRecord(await readJson(request));
  const organizationId = requireText(body.organizationId ?? body.organization_id, "Organization");
  const containerId = requireText(body.containerId ?? body.container_id, "Container");
  const siteId = requireText(body.siteId ?? body.site_id, "Site");
  const captureMode = requireOneOf(body.captureMode ?? body.capture_mode, "Capture mode", [
    "technician_submitted",
    "client_self_service_submitted",
  ] as const);
  const visitType = body.visitType ?? body.visit_type;
  if (visitType !== undefined && visitType !== null && visitType !== "")
    requireOneOf(visitType, "Visit type", ["maintenance", "project"] as const);
  const context = await getPool().query(
    `SELECT o.id AS organization_id, c.id AS container_id, s.id AS site_id
     FROM organizations o CROSS JOIN containers c CROSS JOIN sites s
     WHERE o.id = $1 AND c.id = $2 AND c.organization_id = o.id
       AND s.id = $3 AND s.organization_id = o.id`,
    [organizationId, containerId, siteId],
  );
  if (!context.rows[0])
    return json({ error: "Organization, container, or site context is invalid" }, { status: 400 });
  const projectId = optionalText(body.projectId ?? body.project_id);
  const clientPoId = optionalText(body.clientPoId ?? body.client_po_id);
  const workItemId = optionalText(body.workItemId ?? body.work_item_id);
  if (projectId) {
    const project = await getPool().query(
      "SELECT id FROM projects WHERE id = $1 AND organization_id = $2 AND container_id = $3",
      [projectId, organizationId, containerId],
    );
    if (!project.rows[0])
      return json(
        { error: "Project does not belong to this organization/container" },
        { status: 400 },
      );
  }
  if (clientPoId) {
    const po = await getPool().query(
      "SELECT id FROM client_pos WHERE id = $1 AND organization_id = $2",
      [clientPoId, organizationId],
    );
    if (!po.rows[0])
      return json({ error: "Client PO does not belong to this organization" }, { status: 400 });
  }
  if (workItemId) {
    const workItem = await getPool().query(
      "SELECT id FROM work_items WHERE id = $1 AND organization_id = $2",
      [workItemId, organizationId],
    );
    if (!workItem.rows[0])
      return json({ error: "Work item does not belong to this organization" }, { status: 400 });
  }
  const result = await getPool().query(
    `INSERT INTO site_visits (
      organization_id, container_id, project_id, site_id, building_id, floor_id, area_id,
      capture_mode, visit_type, client_po_id, work_item_id, submitted_by_user_id, notes, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
    RETURNING *`,
    [
      organizationId,
      containerId,
      projectId,
      siteId,
      optionalText(body.buildingId ?? body.building_id),
      optionalText(body.floorId ?? body.floor_id),
      optionalText(body.areaId ?? body.area_id),
      captureMode,
      optionalText(visitType),
      clientPoId,
      workItemId,
      auth.user.id,
      optionalText(body.notes),
      JSON.stringify(body.metadata && typeof body.metadata === "object" ? body.metadata : {}),
    ],
  );
  await audit(
    getPool(),
    "create_site_visit",
    "site_visit",
    result.rows[0].id,
    { visitType, captureMode },
    auth.user,
  );
  return json({ ok: true, siteVisit: result.rows[0] }, { status: 201 });
}

async function projectQrManagement(request: Request, projectId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const project = await getPool().query("SELECT id, name FROM projects WHERE id = $1", [projectId]);
  if (!project.rows[0]) return json({ error: "Project not found" }, { status: 404 });
  if (request.method === "GET") {
    const [identity, grants] = await Promise.all([
      getPool().query(
        "SELECT id, project_id, status, created_by, created_at, revoked_at FROM project_qr_identities WHERE project_id = $1 ORDER BY created_at DESC",
        [projectId],
      ),
      getPool().query(
        "SELECT * FROM project_access_grants WHERE project_id = $1 ORDER BY granted_at DESC",
        [projectId],
      ),
    ]);
    return json({ project: project.rows[0], identities: identity.rows, grants: grants.rows });
  }
  const body = asRecord(await readJson(request));
  const action = requireOneOf(body.action, "Action", ["create", "rotate"] as const);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT id FROM project_qr_identities WHERE project_id = $1 AND status = 'active' FOR UPDATE",
      [projectId],
    );
    if (action === "create" && current.rows[0]) {
      await client.query("ROLLBACK");
      return json(
        { error: "Project already has an active QR identity; use rotate" },
        { status: 409 },
      );
    }
    if (action === "rotate" && current.rows[0])
      await client.query(
        "UPDATE project_qr_identities SET status = 'revoked', revoked_at = now() WHERE id = $1",
        [current.rows[0].id],
      );
    const token = crypto.randomBytes(24).toString("base64url");
    const inserted = await client.query(
      "INSERT INTO project_qr_identities (project_id, token_hash, created_by) VALUES ($1, $2, $3) RETURNING id, project_id, status, created_at",
      [projectId, hashToken(token), auth.user.id],
    );
    await audit(
      client,
      action === "rotate" ? "project_qr_rotated" : "project_qr_created",
      "project_qr_identity",
      inserted.rows[0].id,
      { projectId, previousIdentityId: current.rows[0]?.id ?? null },
      auth.user,
    );
    await client.query("COMMIT");
    return json(
      {
        ok: true,
        identity: inserted.rows[0],
        url: `${process.env.PUBLIC_BASE_URL ?? new URL(request.url).origin}/project-scan/${token}`,
      },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function projectQrRevoke(request: Request, identityId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const result = await getPool().query(
    "UPDATE project_qr_identities SET status = 'revoked', revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 AND status = 'active' RETURNING id, project_id",
    [identityId],
  );
  if (!result.rows[0]) return json({ error: "Active QR identity not found" }, { status: 404 });
  await audit(
    getPool(),
    "project_qr_revoked",
    "project_qr_identity",
    identityId,
    { projectId: result.rows[0].project_id },
    auth.user,
  );
  return json({ ok: true });
}

async function projectAccessGrants(request: Request, projectId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const project = await getPool().query("SELECT id FROM projects WHERE id = $1", [projectId]);
  if (!project.rows[0]) return json({ error: "Project not found" }, { status: 404 });
  const body = asRecord(await readJson(request));
  const result = await getPool().query(
    "INSERT INTO project_access_grants (project_id, grantee_type, grantee_label, granted_by, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    [
      projectId,
      requireText(body.granteeType, "Grantee type"),
      requireText(body.granteeLabel, "Grantee label"),
      auth.user.id,
      optionalText(body.expiresAt),
    ],
  );
  await audit(
    getPool(),
    "project_access_granted",
    "project_access_grant",
    result.rows[0].id,
    {
      projectId,
      granteeType: result.rows[0].grantee_type,
      granteeLabel: result.rows[0].grantee_label,
    },
    auth.user,
  );
  return json({ ok: true, grant: result.rows[0] }, { status: 201 });
}

async function projectAccessGrantRevoke(request: Request, grantId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const result = await getPool().query(
    "UPDATE project_access_grants SET status = 'revoked', revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 AND status = 'active' RETURNING id, project_id",
    [grantId],
  );
  if (!result.rows[0]) return json({ error: "Active access grant not found" }, { status: 404 });
  await audit(
    getPool(),
    "project_access_revoked",
    "project_access_grant",
    grantId,
    { projectId: result.rows[0].project_id },
    auth.user,
  );
  return json({ ok: true });
}

async function projectScan(request: Request, token: string) {
  const tokenHash = hashToken(token);
  const client = getPool();
  const identity = await client.query(
    "SELECT id, project_id FROM project_qr_identities WHERE token_hash = $1 AND status = 'active'",
    [tokenHash],
  );
  const identityRow = identity.rows[0];
  const projectId = identityRow?.project_id ?? null;
  const grant = projectId
    ? await client.query(
        "SELECT 1 FROM project_access_grants WHERE project_id = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > now()) LIMIT 1",
        [projectId],
      )
    : { rows: [] };
  const allowed = Boolean(identityRow && grant.rows[0]);
  await audit(
    client,
    "project_qr_scanned",
    "project_qr_identity",
    identityRow?.id ?? null,
    {
      ...requestOriginMetadata(request),
      tokenIdentity: identityRow?.id ?? tokenHash.slice(0, 12),
      projectId,
      result: allowed ? "allowed" : "denied",
    },
    null,
  );
  if (!allowed) return json({ error: "Project view not available" }, { status: 404 });
  const [project, records] = await Promise.all([
    client.query("SELECT id, name, status, organization_id FROM projects WHERE id = $1", [
      projectId,
    ]),
    client.query(
      `SELECT cr.id, cr.status, cr.note, cr.assessed_at, a.id AS area_id, a.name AS area_name, a.area_type, ast.id AS asset_id, ast.name AS asset_name, ast.asset_type, sv.id AS site_visit_id, sv.started_at AS visit_started_at FROM projects p JOIN site_visits sv ON sv.project_id = p.id JOIN compliance_records cr ON cr.site_visit_id = sv.id JOIN areas a ON a.id = cr.area_id LEFT JOIN assets ast ON ast.id = cr.asset_id WHERE p.id = $1 ORDER BY cr.assessed_at DESC`,
      [projectId],
    ),
  ]);
  return json({ ok: true, project: project.rows[0], complianceRecords: records.rows });
}

async function projectSticker(request: Request, projectId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const project = await client.query(
      `SELECT p.id, p.name, p.status, o.name AS organization_name
       FROM projects p LEFT JOIN organizations o ON o.id = p.organization_id
       WHERE p.id = $1`,
      [projectId],
    );
    if (!project.rows[0]) {
      await client.query("ROLLBACK");
      return json({ error: "Project not found" }, { status: 404 });
    }
    const identity = await client.query(
      `SELECT id FROM project_qr_identities
       WHERE project_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [projectId],
    );
    const previousIdentityId = identity.rows[0]?.id ?? null;
    if (previousIdentityId)
      await client.query(
        "UPDATE project_qr_identities SET status = 'revoked', revoked_at = now() WHERE id = $1",
        [previousIdentityId],
      );
    const token = crypto.randomBytes(24).toString("base64url");
    const newIdentity = await client.query(
      `INSERT INTO project_qr_identities (project_id, token_hash, created_by)
       VALUES ($1, $2, $3) RETURNING id, project_id, status, created_at`,
      [projectId, hashToken(token), auth.user.id],
    );
    await audit(
      client,
      previousIdentityId ? "project_qr_rotated" : "project_qr_created",
      "project_qr_identity",
      newIdentity.rows[0].id,
      {
        projectId,
        previousIdentityId,
        reason: "project_sticker_print",
      },
      auth.user,
    );
    const [sites, records, revision] = await Promise.all([
      client.query(
        `SELECT DISTINCT s.id, s.name, s.address
         FROM site_visits sv JOIN sites s ON s.id = sv.site_id
         WHERE sv.project_id = $1 ORDER BY s.name`,
        [projectId],
      ),
      client.query(
        `WITH ranked AS (
           SELECT cr.id, cr.status, cr.note, cr.assessed_at, cr.area_id, cr.asset_id,
                  ROW_NUMBER() OVER (
                    PARTITION BY cr.area_id, COALESCE(cr.asset_id, '00000000-0000-0000-0000-000000000000'::uuid)
                    ORDER BY cr.assessed_at DESC, cr.created_at DESC
                  ) AS row_number
           FROM compliance_records cr
           JOIN site_visits sv ON sv.id = cr.site_visit_id
           WHERE sv.project_id = $1
         )
         SELECT r.id, r.status, r.note, r.assessed_at, r.area_id, r.asset_id,
                a.name AS area_name, ast.name AS asset_name
         FROM ranked r JOIN areas a ON a.id = r.area_id
         LEFT JOIN assets ast ON ast.id = r.asset_id
         WHERE r.row_number = 1 ORDER BY r.assessed_at DESC`,
        [projectId],
      ),
      client.query(
        `SELECT count(*)::int AS count FROM audit_events
         WHERE action = 'project_sticker_printed' AND entity_type = 'project' AND entity_id = $1`,
        [projectId],
      ),
    ]);
    const currentStatuses = records.rows.map((row) => row.status as string);
    const aggregateState =
      currentStatuses.length === 0
        ? "not_yet_assessed"
        : currentStatuses.includes("red")
          ? "red"
          : currentStatuses.includes("yellow")
            ? "yellow"
            : "green";
    const issuedAt = new Date().toISOString();
    const stickerRevision = Number(revision.rows[0].count) + 1;
    await audit(
      client,
      "project_sticker_printed",
      "project",
      projectId,
      {
        projectId,
        revision: stickerRevision,
        aggregateState,
        qrIdentityId: newIdentity.rows[0].id,
      },
      auth.user,
    );
    await client.query("COMMIT");
    return json({
      ok: true,
      sticker: {
        project: project.rows[0],
        sites: sites.rows,
        aggregateState,
        complianceRecords: records.rows,
        issuedAt,
        revision: stickerRevision,
        qrUrl: `${process.env.PUBLIC_BASE_URL ?? new URL(request.url).origin}/project-scan/${token}`,
        instructions: "Scan this QR code to view the project compliance history.",
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function assetsRisk(request: Request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  const [sitesRows, assetsRows, risksRows, recommendationsRows] = await Promise.all([
    getPool().query(`
      SELECT s.id, s.name, s.address, s.status, o.name AS organization_name,
        count(DISTINCT b.id)::int AS buildings,
        count(DISTINCT a.id)::int AS assets,
        count(DISTINCT r.id) FILTER (WHERE r.status <> 'resolved')::int AS open_risks
      FROM sites s
      JOIN organizations o ON o.id = s.organization_id
      LEFT JOIN buildings b ON b.site_id = s.id
      LEFT JOIN assets a ON a.site_id = s.id
      LEFT JOIN risks r ON r.site_id = s.id
      GROUP BY s.id, o.name
      ORDER BY o.name, s.name
      LIMIT 200
    `),
    getPool().query(`
      SELECT a.id, a.name, a.asset_type, a.manufacturer, a.model, a.status,
        o.name AS organization_name, s.name AS site_name
      FROM assets a
      LEFT JOIN organizations o ON o.id = a.organization_id
      JOIN sites s ON s.id = a.site_id
      ORDER BY a.updated_at DESC
      LIMIT 200
    `),
    getPool().query(`
      SELECT r.id, r.title, r.severity, r.status, r.recommended_action,
        o.name AS organization_name, s.name AS site_name, a.name AS asset_name
      FROM risks r
      LEFT JOIN organizations o ON o.id = r.organization_id
      LEFT JOIN sites s ON s.id = r.site_id
      LEFT JOIN assets a ON a.id = r.asset_id
      ORDER BY r.updated_at DESC
      LIMIT 200
    `),
    getPool().query(`
      SELECT rec.id, rec.title, rec.status, rec.description,
        o.name AS organization_name, s.name AS site_name, a.name AS asset_name
      FROM recommendations rec
      LEFT JOIN organizations o ON o.id = rec.organization_id
      LEFT JOIN sites s ON s.id = rec.site_id
      LEFT JOIN assets a ON a.id = rec.asset_id
      ORDER BY rec.updated_at DESC
      LIMIT 200
    `),
  ]);

  return json({
    sites: sitesRows.rows,
    assets: assetsRows.rows,
    risks: risksRows.rows,
    recommendations: recommendationsRows.rows,
  });
}

async function createOperatingSite(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = await readJson(request);
  const result = await getPool().query(
    `INSERT INTO sites (organization_id, name, address, notes, site_code, primary_contact_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (organization_id, name) DO UPDATE SET
       address = COALESCE(EXCLUDED.address, sites.address),
       notes = COALESCE(EXCLUDED.notes, sites.notes),
       site_code = COALESCE(EXCLUDED.site_code, sites.site_code),
       primary_contact_id = COALESCE(EXCLUDED.primary_contact_id, sites.primary_contact_id),
       updated_at = now()
     RETURNING id`,
    [
      requireText(body.organizationId, "Client"),
      requireText(body.name, "Site name"),
      optionalText(body.address),
      optionalText(body.notes),
      optionalText(body.siteCode),
      optionalText(body.primaryContactId),
    ],
  );
  await audit(getPool(), "upsert_site", "site", result.rows[0].id, {}, auth.user);
  return json({ ok: true, siteId: result.rows[0].id }, { status: 201 });
}

async function createInspectionHierarchy(request: Request, kind: "building" | "floor" | "area") {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = asRecord(await readJson(request));
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (kind === "building") {
      const siteId = requireText(body.siteId, "Site");
      const site = await client.query("SELECT id FROM sites WHERE id = $1", [siteId]);
      if (!site.rows[0]) {
        await client.query("ROLLBACK");
        return json({ error: "Site not found" }, { status: 404 });
      }
      const result = await client.query(
        `INSERT INTO buildings (site_id, name, description) VALUES ($1, $2, $3)
         ON CONFLICT (site_id, name) DO UPDATE SET description = COALESCE(EXCLUDED.description, buildings.description), updated_at = now()
         RETURNING id, site_id, name`,
        [siteId, requireText(body.name, "Building name"), optionalText(body.description)],
      );
      await client.query("COMMIT");
      await audit(
        getPool(),
        "create_inspection_building",
        "building",
        result.rows[0].id,
        {},
        auth.user,
      );
      return json({ ok: true, building: result.rows[0] }, { status: 201 });
    }
    if (kind === "floor") {
      const buildingId = requireText(body.buildingId, "Building");
      const building = await client.query("SELECT id FROM buildings WHERE id = $1", [buildingId]);
      if (!building.rows[0]) {
        await client.query("ROLLBACK");
        return json({ error: "Building not found" }, { status: 404 });
      }
      const result = await client.query(
        `INSERT INTO floors (building_id, name, level_number) VALUES ($1, $2, $3)
         ON CONFLICT (building_id, name) DO UPDATE SET level_number = COALESCE(EXCLUDED.level_number, floors.level_number), updated_at = now()
         RETURNING id, building_id, name, level_number`,
        [buildingId, requireText(body.name, "Floor name"), optionalNumber(body.levelNumber)],
      );
      await client.query("COMMIT");
      await audit(getPool(), "create_inspection_floor", "floor", result.rows[0].id, {}, auth.user);
      return json({ ok: true, floor: result.rows[0] }, { status: 201 });
    }
    const siteId = requireText(body.siteId, "Site");
    const buildingId = optionalText(body.buildingId);
    const floorId = optionalText(body.floorId);
    const site = await client.query("SELECT id FROM sites WHERE id = $1", [siteId]);
    if (!site.rows[0]) {
      await client.query("ROLLBACK");
      return json({ error: "Site not found" }, { status: 404 });
    }
    if (buildingId) {
      const parent = await client.query("SELECT id FROM buildings WHERE id = $1 AND site_id = $2", [
        buildingId,
        siteId,
      ]);
      if (!parent.rows[0]) {
        await client.query("ROLLBACK");
        return json({ error: "Building does not belong to this site" }, { status: 400 });
      }
    }
    if (floorId) {
      const parent = await client.query(
        `SELECT f.id FROM floors f JOIN buildings b ON b.id = f.building_id
         WHERE f.id = $1 AND b.site_id = $2 AND ($3::uuid IS NULL OR f.building_id = $3)`,
        [floorId, siteId, buildingId],
      );
      if (!parent.rows[0]) {
        await client.query("ROLLBACK");
        return json(
          { error: "Floor does not belong to the selected site/building" },
          { status: 400 },
        );
      }
    }
    const result = await client.query(
      `INSERT INTO areas (site_id, building_id, floor_id, name, area_type, description)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'area'), $6)
       ON CONFLICT (site_id, name) DO UPDATE SET
         building_id = COALESCE(EXCLUDED.building_id, areas.building_id),
         floor_id = COALESCE(EXCLUDED.floor_id, areas.floor_id),
         area_type = COALESCE(EXCLUDED.area_type, areas.area_type),
         description = COALESCE(EXCLUDED.description, areas.description), updated_at = now()
       RETURNING id, site_id, building_id, floor_id, name, area_type`,
      [
        siteId,
        buildingId,
        floorId,
        requireText(body.name, "Area name"),
        optionalText(body.areaType),
        optionalText(body.description),
      ],
    );
    await client.query("COMMIT");
    await audit(getPool(), "create_inspection_area", "area", result.rows[0].id, {}, auth.user);
    return json({ ok: true, area: result.rows[0] }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const response = responseFromError(error);
    if (response) return response;
    throw error;
  } finally {
    client.release();
  }
}

async function createOperatingAsset(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = await readJson(request);
  const site = await getPool().query("SELECT organization_id FROM sites WHERE id = $1", [
    requireText(body.siteId, "Site"),
  ]);
  if (!site.rows[0]) return json({ error: "Site not found" }, { status: 404 });
  const result = await getPool().query(
    `INSERT INTO assets (
      organization_id, site_id, building_id, floor_id, area_id, asset_tag, name, asset_type,
      manufacturer, model, serial_number, system_family, status, installed_on, notes
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'asset'), $9, $10, $11, $12, COALESCE($13, 'unknown'), $14, $15)
     RETURNING id`,
    [
      site.rows[0].organization_id,
      requireText(body.siteId, "Site"),
      optionalText(body.buildingId),
      optionalText(body.floorId),
      optionalText(body.areaId),
      optionalText(body.assetTag),
      requireText(body.name, "Asset name"),
      optionalText(body.assetType),
      optionalText(body.manufacturer),
      optionalText(body.model),
      optionalText(body.serialNumber),
      optionalText(body.systemFamily),
      optionalText(body.status),
      optionalText(body.installedOn),
      optionalText(body.notes),
    ],
  );
  await audit(getPool(), "create_asset", "asset", result.rows[0].id, {}, auth.user);
  return json({ ok: true, assetId: result.rows[0].id }, { status: 201 });
}

async function createRisk(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = await readJson(request);
  const result = await getPool().query(
    `INSERT INTO risks (
      organization_id, site_id, asset_id, work_item_id, report_id, title, severity, status,
      description, recommended_action, created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'medium'), COALESCE($8, 'open'), $9, $10, $11)
     RETURNING id`,
    [
      optionalText(body.organizationId),
      optionalText(body.siteId),
      optionalText(body.assetId),
      optionalText(body.workItemId),
      optionalText(body.reportId),
      requireText(body.title, "Risk title"),
      optionalText(body.severity),
      optionalText(body.status),
      optionalText(body.description),
      optionalText(body.recommendedAction),
      auth.user.id,
    ],
  );
  await audit(getPool(), "create_risk", "risk", result.rows[0].id, {}, auth.user);
  return json({ ok: true, riskId: result.rows[0].id }, { status: 201 });
}

async function insertJobLink(
  client: pg.Pool | pg.PoolClient,
  params: {
    workItemId: string;
    subcontractorId?: string | null;
    expiresAt?: string | null;
    createdBy: string;
  },
) {
  const token = crypto.randomBytes(24).toString("base64url");
  const result = await client.query(
    `INSERT INTO job_links (
      work_item_id, subcontractor_id, token_hash, expires_at, created_by
     )
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      params.workItemId,
      params.subcontractorId ?? null,
      hashToken(token),
      params.expiresAt ?? null,
      params.createdBy,
    ],
  );
  return {
    jobLinkId: result.rows[0].id as string,
    token,
    url: `${process.env.PUBLIC_BASE_URL ?? ""}/field/${token}`,
  };
}

async function createJobLink(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = await readJson(request);
  const link = await insertJobLink(getPool(), {
    workItemId: requireText(body.workItemId, "Work item"),
    subcontractorId: optionalText(body.subcontractorId),
    expiresAt: optionalText(body.expiresAt),
    createdBy: auth.user.id,
  });
  await audit(getPool(), "create_job_link", "job_link", link.jobLinkId, {}, auth.user);
  return json({ ok: true, ...link }, { status: 201 });
}

async function issueSubcontractorPo(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = await readJson(request);
  const workItemId = requireText(body.workItemId, "Work item");
  const subcontractorId = requireText(body.subcontractorId, "Subcontractor");
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const workItem = await client.query(
      `SELECT id, title, organization_id, site_id
       FROM work_items
       WHERE id = $1`,
      [workItemId],
    );
    if (!workItem.rows[0]) {
      await client.query("ROLLBACK");
      return json({ error: "Work item not found" }, { status: 404 });
    }

    const subcontractor = await client.query(
      `SELECT id, name, email, phone, preferred_channel
       FROM subcontractors
       WHERE id = $1 AND status = 'active'`,
      [subcontractorId],
    );
    if (!subcontractor.rows[0]) {
      await client.query("ROLLBACK");
      return json({ error: "Subcontractor not found or inactive" }, { status: 404 });
    }

    const po = await client.query(
      `INSERT INTO subcontractor_pos (
        subcontractor_id, work_item_id, project_id, client_po_id, po_number,
        status, amount_cents, issued_on, due_on, created_by
       )
       VALUES ($1, $2, $3, $4, $5, 'issued', $6, COALESCE($7, current_date), $8, $9)
       RETURNING id`,
      [
        subcontractorId,
        workItemId,
        optionalText(body.projectId),
        optionalText(body.clientPoId),
        optionalText(body.poNumber),
        centsFromValue(body.amount),
        optionalText(body.issuedOn),
        optionalText(body.dueOn),
        auth.user.id,
      ],
    );

    const link = await insertJobLink(client, {
      workItemId,
      subcontractorId,
      expiresAt: optionalText(body.expiresAt),
      createdBy: auth.user.id,
    });

    await client.query(
      "UPDATE subcontractor_pos SET job_link_id = $1, updated_at = now() WHERE id = $2",
      [link.jobLinkId, po.rows[0].id],
    );

    const notifyChannel = subcontractor.rows[0].preferred_channel as "whatsapp" | "email";
    const recipient =
      notifyChannel === "whatsapp"
        ? (optionalText(subcontractor.rows[0].phone) ?? "")
        : (optionalText(subcontractor.rows[0].email) ?? "");
    if (!recipient) {
      await client.query("ROLLBACK");
      return json(
        { error: "Subcontractor needs a phone number or email address" },
        { status: 400 },
      );
    }
    const notify = subcontractorNotifyBody({
      subcontractorName: subcontractor.rows[0].name as string,
      poNumber: optionalText(body.poNumber),
      url: link.url,
    });
    const approvalId = await upsertSubcontractorNotifyApproval(client, {
      subcontractorPoId: po.rows[0].id as string,
      workItemId,
      subcontractorId,
      subcontractorName: subcontractor.rows[0].name as string,
      poNumber: optionalText(body.poNumber),
      recipient,
      channel: notifyChannel,
      url: link.url,
      messageBody: notify.plainText,
      messageHtml: notify.html,
      requestedBy: auth.user.id,
    });

    await audit(
      client,
      "issue_subcontractor_po",
      "subcontractor_po",
      po.rows[0].id,
      {
        workItemId,
        subcontractorId,
        jobLinkId: link.jobLinkId,
        approvalRequestId: approvalId,
        channel: notifyChannel,
      },
      auth.user,
    );
    await client.query("COMMIT");
    return json(
      {
        ok: true,
        subcontractorPoId: po.rows[0].id,
        ...link,
        approvalRequestId: approvalId,
        notifyChannel,
      },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function fieldSubmission(request: Request) {
  const body = await readJson(request);
  const token = optionalText(body.token);
  let jobLinkId: string | null = optionalText(body.jobLinkId);
  let workItemId = optionalText(body.workItemId);
  let subcontractorId = optionalText(body.subcontractorId);

  if (token) {
    const link = await getPool().query(
      `SELECT id, work_item_id, subcontractor_id
       FROM job_links
       WHERE token_hash = $1
         AND status = 'active'
         AND (expires_at IS NULL OR expires_at > now())`,
      [hashToken(token)],
    );
    if (!link.rows[0]) return json({ error: "Job link is invalid or expired" }, { status: 404 });
    jobLinkId = link.rows[0].id;
    workItemId = link.rows[0].work_item_id;
    subcontractorId = link.rows[0].subcontractor_id;
  } else {
    const auth = await requireUser(request, ["admin", "staff"]);
    if (auth.response) return auth.response;
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO field_submissions (
        work_item_id, job_link_id, subcontractor_id, submitted_by_name, status,
        checklist, fault_notes, recommendations, quote_line_suggestions
       )
       VALUES ($1, $2, $3, $4, 'submitted', $5::jsonb, $6, $7, $8::jsonb)
       RETURNING id`,
      [
        workItemId,
        jobLinkId,
        subcontractorId,
        optionalText(body.submittedByName),
        JSON.stringify(asRecord(body.checklist)),
        optionalText(body.faultNotes),
        optionalText(body.recommendations),
        JSON.stringify(Array.isArray(body.quoteLineSuggestions) ? body.quoteLineSuggestions : []),
      ],
    );

    if (jobLinkId) {
      await client.query("UPDATE job_links SET status = 'submitted' WHERE id = $1", [jobLinkId]);
    }
    if (workItemId) {
      await client.query(
        "UPDATE work_items SET status = 'report_pending', updated_at = now() WHERE id = $1",
        [workItemId],
      );
    }

    await refreshFieldSubmissionEmbedding(client, result.rows[0].id);
    await client.query("COMMIT");
    return json({ ok: true, fieldSubmissionId: result.rows[0].id }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function subcontractorDirectory(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  if (request.method === "POST") {
    const body = await readJson(request);
    const preferredChannel = requireOneOf(
      body.preferredChannel,
      "Preferred channel",
      subcontractorChannels,
    );
    const rateCard = normalizeSubcontractorRateCard(body.rateCard);
    const result = await getPool().query(
      `INSERT INTO subcontractors (
        name, primary_contact_name, email, phone, region, work_types, status, compliance_status,
        preferred_channel, rate_card, notes
       )
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'active'), COALESCE($8, 'unknown'), $9, $10::jsonb, $11)
       ON CONFLICT (name) DO UPDATE SET
        primary_contact_name = EXCLUDED.primary_contact_name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        region = EXCLUDED.region,
        work_types = EXCLUDED.work_types,
        status = EXCLUDED.status,
        compliance_status = EXCLUDED.compliance_status,
        preferred_channel = EXCLUDED.preferred_channel,
        rate_card = EXCLUDED.rate_card,
        notes = EXCLUDED.notes,
        updated_at = now()
       RETURNING id`,
      [
        requireText(body.name, "Name"),
        optionalText(body.primaryContactName),
        optionalText(body.email),
        optionalText(body.phone),
        optionalText(body.region),
        Array.isArray(body.workTypes) ? body.workTypes.map(String) : [],
        optionalText(body.status),
        optionalText(body.complianceStatus),
        preferredChannel,
        JSON.stringify(rateCard),
        optionalText(body.notes),
      ],
    );
    await audit(
      getPool(),
      "upsert_subcontractor",
      "subcontractor",
      result.rows[0].id,
      {},
      auth.user,
    );
    return json({ ok: true, subcontractorId: result.rows[0].id }, { status: 201 });
  }

  const rows = await getPool().query(`
    SELECT sc.id, sc.name, sc.primary_contact_name, sc.email, sc.phone, sc.region,
      sc.work_types, sc.status, sc.compliance_status, sc.preferred_channel, sc.rate_card,
      count(DISTINCT spo.id) FILTER (WHERE spo.status NOT IN ('complete', 'paid', 'cancelled'))::int AS active_pos,
      COALESCE(sum(spo.amount_cents) FILTER (WHERE spo.status NOT IN ('paid', 'cancelled'))::int, 0) AS pending_amount_cents
    FROM subcontractors sc
    LEFT JOIN subcontractor_pos spo ON spo.subcontractor_id = sc.id
    GROUP BY sc.id
    ORDER BY sc.name
  `);
  return json({ subcontractors: rows.rows });
}

async function subcontractorDetail(request: Request, subcontractorId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  if (request.method !== "PATCH") return json({ error: "Method not allowed" }, { status: 405 });

  const body = await readJson(request);
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT id FROM subcontractors WHERE id = $1 FOR UPDATE", [
      subcontractorId,
    ]);
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return json({ error: "Subcontractor not found" }, { status: 404 });
    }

    const preferredChannel = body.preferredChannel
      ? requireOneOf(body.preferredChannel, "Preferred channel", subcontractorChannels)
      : null;
    const rateCard =
      body.rateCard !== undefined ? normalizeSubcontractorRateCard(body.rateCard) : null;

    const result = await client.query(
      `UPDATE subcontractors
       SET name = COALESCE($2, name),
         primary_contact_name = COALESCE($3, primary_contact_name),
         email = COALESCE($4, email),
         phone = COALESCE($5, phone),
         region = COALESCE($6, region),
         work_types = COALESCE($7, work_types),
         status = COALESCE($8, status),
         compliance_status = COALESCE($9, compliance_status),
         preferred_channel = COALESCE($10, preferred_channel),
         rate_card = COALESCE($11::jsonb, rate_card),
         notes = COALESCE($12, notes),
         updated_at = now()
       WHERE id = $1
       RETURNING id`,
      [
        subcontractorId,
        optionalText(body.name),
        optionalText(body.primaryContactName),
        optionalText(body.email),
        optionalText(body.phone),
        optionalText(body.region),
        Array.isArray(body.workTypes) ? body.workTypes.map(String) : null,
        body.status
          ? requireOneOf(body.status, "Status", ["active", "inactive", "blocked"] as const)
          : null,
        body.complianceStatus
          ? requireOneOf(body.complianceStatus, "Compliance status", [
              "unknown",
              "pending",
              "approved",
              "expired",
            ] as const)
          : null,
        preferredChannel,
        rateCard ? JSON.stringify(rateCard) : null,
        optionalText(body.notes),
      ],
    );

    await audit(client, "update_subcontractor", "subcontractor", result.rows[0].id, {}, auth.user);
    await client.query("COMMIT");
    return json({ ok: true, subcontractorId: result.rows[0].id });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const response = responseFromError(error);
    if (response) return response;
    throw error;
  } finally {
    client.release();
  }
}

function subcontractorNotifyBody(params: {
  subcontractorName: string;
  poNumber: string | null;
  url: string;
}) {
  const greeting = params.subcontractorName ? `Hi ${params.subcontractorName},` : "Hi,";
  const poLabel = params.poNumber ? ` for PO ${params.poNumber}` : "";
  const plainText = [
    greeting,
    "",
    `Your STI Risk job link${poLabel} is ready: ${params.url}`,
    "",
    "Please use the link to complete the site visit, photos, notes, and report submission.",
    "",
    "Regards,",
    "STI Risk",
  ].join("\n");
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>Your STI Risk job link${poLabel ? escapeHtml(poLabel) : ""} is ready: <a href="${escapeHtml(params.url)}">${escapeHtml(params.url)}</a></p>`,
    "<p>Please use the link to complete the site visit, photos, notes, and report submission.</p>",
    "<p>Regards,<br />STI Risk</p>",
  ].join("\n");
  return { plainText, html };
}

async function upsertSubcontractorNotifyApproval(
  client: pg.Pool | pg.PoolClient,
  params: {
    subcontractorPoId: string;
    workItemId: string;
    subcontractorId: string;
    subcontractorName: string;
    poNumber: string | null;
    recipient: string;
    channel: "whatsapp" | "email";
    url: string;
    messageBody: string;
    messageHtml: string;
    requestedBy: string;
  },
) {
  const existing = await client.query(
    `SELECT id
     FROM approval_requests
     WHERE action_type = 'subcontractor_notify'
       AND entity_type = 'subcontractor_po'
       AND entity_id = $1
       AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`,
    [params.subcontractorPoId],
  );
  const payload = {
    subcontractorPoId: params.subcontractorPoId,
    workItemId: params.workItemId,
    subcontractorId: params.subcontractorId,
    subcontractorName: params.subcontractorName,
    poNumber: params.poNumber,
    recipient: params.recipient,
    channel: params.channel,
    url: params.url,
    messageBody: params.messageBody,
    messageHtml: params.messageHtml,
  };
  const title = `Approve subcontractor notification for ${params.subcontractorName}`;
  const summary = `${params.channel.toUpperCase()} draft for ${params.subcontractorName}${params.poNumber ? ` · PO ${params.poNumber}` : ""}`;

  if (existing.rows[0]) {
    const approvalId = existing.rows[0].id as string;
    await client.query(
      `UPDATE approval_requests
       SET title = $2,
           summary = $3,
           payload = $4::jsonb,
           status = 'pending',
           decided_by = NULL,
           decided_at = NULL
       WHERE id = $1`,
      [approvalId, title, summary, JSON.stringify(payload)],
    );
    await client.query(
      `UPDATE agent_actions
       SET status = 'pending_approval',
           input = $2::jsonb,
           output = '{}'::jsonb,
           error = NULL,
           updated_at = now()
       WHERE approval_request_id = $1`,
      [approvalId, JSON.stringify({ requestedBy: params.requestedBy, payload })],
    );
    return approvalId;
  }

  const approval = await client.query(
    `INSERT INTO approval_requests (
      requested_by, action_type, entity_type, entity_id, title, summary, payload
     )
     VALUES ($1, 'subcontractor_notify', 'subcontractor_po', $2, $3, $4, $5::jsonb)
     RETURNING id`,
    [params.requestedBy, params.subcontractorPoId, title, summary, JSON.stringify(payload)],
  );
  await client.query(
    `INSERT INTO agent_actions (
      requested_by, approval_request_id, action_type, entity_type, entity_id, status, input
     )
     VALUES ($1, $2, 'subcontractor_notify', 'subcontractor_po', $3, 'pending_approval', $4::jsonb)`,
    [
      params.requestedBy,
      approval.rows[0].id,
      params.subcontractorPoId,
      JSON.stringify({ payload }),
    ],
  );
  return approval.rows[0].id as string;
}

type ClientSignoffTargetType = "service_report" | "job_card" | "quote";

type ClientSignoffTargetContext = {
  targetType: ClientSignoffTargetType;
  targetId: string;
  title: string;
  summary: string | null;
  organizationId: string | null;
  organizationName: string | null;
  projectId: string | null;
  projectName: string | null;
  workItemId: string | null;
  workItemTitle: string | null;
  quoteStatus: string | null;
  linkId: string | null;
  linkStatus: string | null;
  linkExpiresAt: string | null;
  signedAt: string | null;
  signerName: string | null;
  signerRole: string | null;
  signatureData: Record<string, unknown> | null;
};

function clientSignoffNotifyBody(params: {
  organizationName: string | null;
  title: string;
  summary: string | null;
  url: string;
}) {
  const greeting = params.organizationName ? `Hi ${params.organizationName},` : "Hi,";
  const bodyText = [
    greeting,
    "",
    `Your client sign-off link for ${params.title} is ready: ${params.url}`,
    params.summary ? "" : "",
    params.summary ? params.summary : "",
    "",
    "Please open the link, review the completed work, and sign off on the record.",
    "",
    "Regards,",
    "STI Risk",
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n");
  const bodyHtml = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>Your client sign-off link for <strong>${escapeHtml(params.title)}</strong> is ready: <a href="${escapeHtml(params.url)}">${escapeHtml(params.url)}</a></p>`,
    params.summary ? `<p>${escapeHtml(params.summary)}</p>` : "",
    "<p>Please open the link, review the completed work, and sign off on the record.</p>",
    "<p>Regards,<br />STI Risk</p>",
  ].join("\n");
  return { bodyText, bodyHtml };
}

async function loadClientSignoffTarget(
  client: pg.Pool | pg.PoolClient,
  targetType: ClientSignoffTargetType,
  targetId: string,
): Promise<ClientSignoffTargetContext | null> {
  if (targetType === "service_report") {
    const result = await client.query(
      `SELECT sr.id, sr.title, sr.summary, sr.status, sr.organization_id,
        o.name AS organization_name, p.id AS project_id, p.name AS project_name,
        wi.id AS work_item_id, wi.title AS work_item_title,
        csl.id AS link_id, csl.status AS link_status, csl.expires_at AS link_expires_at,
        cs.signed_at, cs.signer_name, cs.signer_role, cs.signature_data
       FROM service_reports sr
       LEFT JOIN organizations o ON o.id = sr.organization_id
       LEFT JOIN projects p ON p.id = sr.project_id
       LEFT JOIN work_items wi ON wi.id = sr.work_item_id
       LEFT JOIN client_signoff_links csl
         ON csl.target_type = 'service_report' AND csl.target_id = sr.id
         AND csl.status = 'active'
       LEFT JOIN LATERAL (
         SELECT signed_at, signer_name, signer_role, signature_data
         FROM client_signatures
         WHERE signoff_link_id = csl.id
         ORDER BY signed_at DESC
         LIMIT 1
       ) cs ON true
       WHERE sr.id = $1`,
      [targetId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      targetType,
      targetId: row.id as string,
      title: row.title as string,
      summary: optionalText(row.summary),
      organizationId: row.organization_id as string | null,
      organizationName: row.organization_name as string | null,
      projectId: row.project_id as string | null,
      projectName: row.project_name as string | null,
      workItemId: row.work_item_id as string | null,
      workItemTitle: row.work_item_title as string | null,
      quoteStatus: null,
      linkId: row.link_id as string | null,
      linkStatus: row.link_status as string | null,
      linkExpiresAt: row.link_expires_at ? new Date(row.link_expires_at).toISOString() : null,
      signedAt: row.signed_at ? new Date(row.signed_at).toISOString() : null,
      signerName: row.signer_name as string | null,
      signerRole: row.signer_role as string | null,
      signatureData: asRecord(row.signature_data),
    };
  }

  if (targetType === "quote") {
    const result = await client.query(
      `SELECT q.id, q.quote_number, q.status, q.total_value_cents, q.currency, q.notes,
        q.organization_id, o.name AS organization_name, q.site_id, s.name AS site_name,
        csl.id AS link_id, csl.status AS link_status, csl.expires_at AS link_expires_at,
        cs.signed_at, cs.signer_name, cs.signer_role, cs.signature_data
       FROM quotes q
       JOIN organizations o ON o.id = q.organization_id
       JOIN sites s ON s.id = q.site_id
       LEFT JOIN client_signoff_links csl
         ON csl.target_type = 'quote' AND csl.target_id = q.id
         AND csl.status = 'active'
       LEFT JOIN LATERAL (
         SELECT signed_at, signer_name, signer_role, signature_data
         FROM client_signatures
         WHERE signoff_link_id = csl.id
         ORDER BY signed_at DESC
         LIMIT 1
       ) cs ON true
       WHERE q.id = $1`,
      [targetId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      targetType,
      targetId: row.id as string,
      title: `Quote ${row.quote_number as string}`,
      summary: [
        row.organization_name ? `Client: ${row.organization_name}` : null,
        row.site_name ? `Site: ${row.site_name}` : null,
        row.total_value_cents !== null
          ? `Total: ${centsToMoney(row.total_value_cents, row.currency as string)}`
          : null,
        row.status ? `Quote status: ${row.status}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      organizationId: row.organization_id as string | null,
      organizationName: row.organization_name as string | null,
      projectId: null,
      projectName: null,
      workItemId: row.site_id as string | null,
      workItemTitle: row.site_name as string | null,
      quoteStatus: row.status as string | null,
      linkId: row.link_id as string | null,
      linkStatus: row.link_status as string | null,
      linkExpiresAt: row.link_expires_at ? new Date(row.link_expires_at).toISOString() : null,
      signedAt: row.signed_at ? new Date(row.signed_at).toISOString() : null,
      signerName: row.signer_name as string | null,
      signerRole: row.signer_role as string | null,
      signatureData: asRecord(row.signature_data),
    };
  }

  const result = await client.query(
    `SELECT jc.id, jc.status, jc.signed_by_name, jc.signed_at, jc.field_submission_id,
      wi.title AS work_item_title, wi.organization_id, wi.project_id, wi.id AS work_item_id,
      o.name AS organization_name, p.name AS project_name,
      csl.id AS link_id, csl.status AS link_status, csl.expires_at AS link_expires_at,
      cs.signed_at AS signature_signed_at, cs.signer_name, cs.signer_role, cs.signature_data
     FROM job_cards jc
     LEFT JOIN work_items wi ON wi.id = jc.work_item_id
     LEFT JOIN organizations o ON o.id = wi.organization_id
     LEFT JOIN projects p ON p.id = wi.project_id
     LEFT JOIN client_signoff_links csl
       ON csl.target_type = 'job_card' AND csl.target_id = jc.id
       AND csl.status = 'active'
     LEFT JOIN LATERAL (
       SELECT signed_at, signer_name, signer_role, signature_data
       FROM client_signatures
       WHERE signoff_link_id = csl.id
       ORDER BY signed_at DESC
       LIMIT 1
     ) cs ON true
     WHERE jc.id = $1`,
    [targetId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    targetType,
    targetId: row.id as string,
    title: row.work_item_title ? `${row.work_item_title} job card` : "Job card",
    summary: row.status ? `Job card status: ${row.status}` : null,
    organizationId: row.organization_id as string | null,
    organizationName: row.organization_name as string | null,
    projectId: row.project_id as string | null,
    projectName: row.project_name as string | null,
    workItemId: row.work_item_id as string | null,
    workItemTitle: row.work_item_title as string | null,
    quoteStatus: null,
    linkId: row.link_id as string | null,
    linkStatus: row.link_status as string | null,
    linkExpiresAt: row.link_expires_at ? new Date(row.link_expires_at).toISOString() : null,
    signedAt: row.signature_signed_at
      ? new Date(row.signature_signed_at).toISOString()
      : row.signed_at
        ? new Date(row.signed_at).toISOString()
        : null,
    signerName: row.signer_name ?? row.signed_by_name ?? null,
    signerRole: row.signer_role as string | null,
    signatureData: asRecord(row.signature_data),
  };
}

async function insertClientSignoffLink(
  client: pg.Pool | pg.PoolClient,
  params: {
    targetType: ClientSignoffTargetType;
    targetId: string;
    createdBy: string;
    expiresAt?: string | null;
  },
) {
  const token = crypto.randomBytes(24).toString("base64url");
  const result = await client.query(
    `INSERT INTO client_signoff_links (
      target_type, target_id, token_hash, expires_at, created_by
     )
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      params.targetType,
      params.targetId,
      hashToken(token),
      params.expiresAt ?? null,
      params.createdBy,
    ],
  );
  return {
    signoffLinkId: result.rows[0].id as string,
    token,
    url: `${process.env.PUBLIC_BASE_URL ?? ""}/sign/${token}`,
  };
}

async function rotateClientSignoffLinkToken(
  client: pg.Pool | pg.PoolClient,
  signoffLinkId: string,
  expiresAt?: string | null,
) {
  const token = crypto.randomBytes(24).toString("base64url");
  await client.query(
    `UPDATE client_signoff_links
     SET token_hash = $2,
         expires_at = COALESCE($3, expires_at),
         status = 'active',
         updated_at = now()
     WHERE id = $1`,
    [signoffLinkId, hashToken(token), expiresAt ?? null],
  );
  return {
    token,
    url: `${process.env.PUBLIC_BASE_URL ?? ""}/sign/${token}`,
  };
}

async function upsertClientSignoffApproval(
  client: pg.Pool | pg.PoolClient,
  params: {
    targetType: ClientSignoffTargetType;
    targetId: string;
    title: string;
    summary: string | null;
    recipient: string;
    channel: "whatsapp" | "email";
    url: string;
    bodyText: string;
    bodyHtml: string;
    requestedBy: string;
  },
) {
  const existing = await client.query(
    `SELECT id
     FROM approval_requests
     WHERE action_type = 'client_signoff_notify'
       AND entity_type = $1
       AND entity_id = $2
       AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`,
    [params.targetType, params.targetId],
  );
  const payload = {
    targetType: params.targetType,
    targetId: params.targetId,
    recipient: params.recipient,
    channel: params.channel,
    url: params.url,
    bodyText: params.bodyText,
    bodyHtml: params.bodyHtml,
  };
  const title = `Approve client sign-off link for ${params.title}`;
  const summary = `${params.channel.toUpperCase()} sign-off draft${params.summary ? ` · ${params.summary}` : ""}`;

  if (existing.rows[0]) {
    const approvalId = existing.rows[0].id as string;
    await client.query(
      `UPDATE approval_requests
       SET title = $2,
           summary = $3,
           payload = $4::jsonb,
           status = 'pending',
           decided_by = NULL,
           decided_at = NULL
       WHERE id = $1`,
      [approvalId, title, summary, JSON.stringify(payload)],
    );
    await client.query(
      `UPDATE agent_actions
       SET status = 'pending_approval',
           input = $2::jsonb,
           output = '{}'::jsonb,
           error = NULL,
           updated_at = now()
       WHERE approval_request_id = $1`,
      [approvalId, JSON.stringify({ requestedBy: params.requestedBy, payload })],
    );
    return approvalId;
  }

  const approval = await client.query(
    `INSERT INTO approval_requests (
      requested_by, action_type, entity_type, entity_id, title, summary, payload
     )
     VALUES ($1, 'client_signoff_notify', $2, $3, $4, $5, $6::jsonb)
     RETURNING id`,
    [
      params.requestedBy,
      params.targetType,
      params.targetId,
      title,
      summary,
      JSON.stringify(payload),
    ],
  );
  await client.query(
    `INSERT INTO agent_actions (
      requested_by, approval_request_id, action_type, entity_type, entity_id, status, input
     )
     VALUES ($1, $2, 'client_signoff_notify', $3, $4, 'pending_approval', $5::jsonb)`,
    [
      params.requestedBy,
      approval.rows[0].id,
      params.targetType,
      params.targetId,
      JSON.stringify({ payload }),
    ],
  );
  return approval.rows[0].id as string;
}

type ApprovalExecutorContext = {
  client: pg.Pool | pg.PoolClient;
  authUser: User;
  approvalId: string;
  approval: {
    action_type: string;
    entity_type: string;
    entity_id: string | null;
  };
  payload: Record<string, unknown>;
};

const approvalExecutors: Record<string, (context: ApprovalExecutorContext) => Promise<void>> = {
  subcontractor_notify: async ({ client, authUser, approvalId, approval, payload }) => {
    const subject =
      optionalText(payload.subject) ??
      `Job link for ${optionalText(payload.subcontractorName) ?? "subcontractor"}`;
    if (optionalText(payload.channel) === "email") {
      await createMicrosoftEmailDraft(authUser, {
        to: [requireText(payload.recipient, "Recipient")],
        subject,
        body: optionalText(payload.bodyHtml) ?? optionalText(payload.bodyText) ?? "",
      });
    } else {
      const communication = await client.query(
        `INSERT INTO communications (
          deal_id, contact_id, organization_id, direction, channel, subject, body, summary
         )
         VALUES ($1, $2, $3, 'outbound', 'whatsapp', $4, $5, $6)
         RETURNING id`,
        [
          null,
          null,
          null,
          subject,
          requireText(payload.bodyText, "Message body"),
          optionalText(payload.bodyText)?.slice(0, 240) ?? "",
        ],
      );
      await client.query(
        `INSERT INTO whatsapp_outbox (
          communication_id, recipient, message_body, status, metadata
         )
         VALUES ($1, $2, $3, 'pending', $4::jsonb)`,
        [
          communication.rows[0].id,
          requireText(payload.recipient, "Recipient"),
          requireText(payload.bodyText, "Message body"),
          JSON.stringify({
            approvalRequestId: approvalId,
            actionType: approval.action_type,
            targetType: approval.entity_type,
            targetId: approval.entity_id ?? null,
            url: payload.url ?? null,
          }),
        ],
      );
    }
  },
  client_signoff_notify: async ({ client, authUser, approvalId, approval, payload }) => {
    const subject =
      optionalText(payload.subject) ??
      `Client sign-off link for ${optionalText(payload.title) ?? "record"}`;
    if (optionalText(payload.channel) === "email") {
      await createMicrosoftEmailDraft(authUser, {
        to: [requireText(payload.recipient, "Recipient")],
        subject,
        body: optionalText(payload.bodyHtml) ?? optionalText(payload.bodyText) ?? "",
      });
    } else {
      const communication = await client.query(
        `INSERT INTO communications (
          deal_id, contact_id, organization_id, direction, channel, subject, body, summary
         )
         VALUES ($1, $2, $3, 'outbound', 'whatsapp', $4, $5, $6)
         RETURNING id`,
        [
          null,
          null,
          null,
          subject,
          requireText(payload.bodyText, "Message body"),
          optionalText(payload.bodyText)?.slice(0, 240) ?? "",
        ],
      );
      await client.query(
        `INSERT INTO whatsapp_outbox (
          communication_id, recipient, message_body, status, metadata
         )
         VALUES ($1, $2, $3, 'pending', $4::jsonb)`,
        [
          communication.rows[0].id,
          requireText(payload.recipient, "Recipient"),
          requireText(payload.bodyText, "Message body"),
          JSON.stringify({
            approvalRequestId: approvalId,
            actionType: approval.action_type,
            targetType: approval.entity_type,
            targetId: approval.entity_id ?? null,
            url: payload.url ?? null,
          }),
        ],
      );
    }
  },
};

async function createClientSignoffLink(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = await readJson(request);
  const targetType = requireOneOf(body.targetType, "Target type", [
    "service_report",
    "job_card",
    "quote",
  ] as const);
  const targetId = requireText(body.targetId, "Target id");
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const target = await loadClientSignoffTarget(client, targetType, targetId);
    if (!target) {
      await client.query("ROLLBACK");
      return json({ error: "Sign-off target not found" }, { status: 404 });
    }
    if (targetType === "quote" && target.quoteStatus !== "sent_to_client") {
      await client.query("ROLLBACK");
      return json(
        { error: "Quote must be sent to the client before sign-off can be requested" },
        { status: 409 },
      );
    }

    let linkId = target.linkId;
    let url = "";
    if (!linkId) {
      const link = await insertClientSignoffLink(client, {
        targetType,
        targetId,
        createdBy: auth.user.id,
        expiresAt: optionalText(body.expiresAt),
      });
      linkId = link.signoffLinkId;
      url = link.url;
    } else {
      const rotated = await rotateClientSignoffLinkToken(
        client,
        linkId,
        optionalText(body.expiresAt),
      );
      url = rotated.url;
    }

    const contact = target.organizationId
      ? await client.query(
          `SELECT c.email, c.phone, c.first_name, c.last_name
             FROM contacts c
             JOIN organizations o ON o.primary_contact_id = c.id
             WHERE o.id = $1
             LIMIT 1`,
          [target.organizationId],
        )
      : null;
    const fallbackContact =
      !contact?.rows[0] && target.organizationId
        ? await client.query(
            `SELECT email, phone, first_name, last_name
             FROM contacts
             WHERE organization_id = $1
             ORDER BY updated_at DESC
             LIMIT 1`,
            [target.organizationId],
          )
        : null;
    const contactRow = contact?.rows[0] ?? fallbackContact?.rows[0] ?? null;
    const recipientName = [contactRow?.first_name, contactRow?.last_name].filter(Boolean).join(" ");
    const channel = optionalText(contactRow?.phone) ? "whatsapp" : "email";
    const recipient =
      channel === "whatsapp"
        ? (optionalText(contactRow?.phone) ?? "")
        : (optionalText(contactRow?.email) ?? "");
    if (!recipient) {
      await client.query("ROLLBACK");
      return json({ error: "Client needs an email address or phone number" }, { status: 400 });
    }

    const message = clientSignoffNotifyBody({
      organizationName: recipientName || target.organizationName,
      title: target.title,
      summary: target.summary,
      url,
    });
    const approvalId = await upsertClientSignoffApproval(client, {
      targetType,
      targetId,
      title: target.title,
      summary: target.summary,
      recipient,
      channel,
      url,
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml,
      requestedBy: auth.user.id,
    });

    await client.query("COMMIT");
    await audit(
      client,
      "create_client_signoff_link",
      targetType,
      targetId,
      {
        linkId,
        approvalRequestId: approvalId,
        channel,
      },
      auth.user,
    );
    return json(
      {
        ok: true,
        signoffLinkId: linkId,
        approvalRequestId: approvalId,
        url,
        channel,
      },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function clientSignoffContext(request: Request, token: string) {
  const result = await getPool().query(
    `SELECT csl.id, csl.target_type, csl.target_id, csl.status, csl.expires_at,
      sr.title AS report_title, sr.summary AS report_summary, sr.status AS report_status,
      sr.report_type, sr.report_payload,
      jc.status AS job_card_status, jc.signed_at, jc.signed_by_name,
      o.name AS organization_name, p.name AS project_name, wi.title AS work_item_title,
      cs.signed_at AS signature_signed_at, cs.signer_name, cs.signer_role, cs.signature_data
     FROM client_signoff_links csl
     LEFT JOIN service_reports sr ON sr.id = csl.target_id AND csl.target_type = 'service_report'
     LEFT JOIN job_cards jc ON jc.id = csl.target_id AND csl.target_type = 'job_card'
     LEFT JOIN work_items wi ON wi.id = COALESCE(sr.work_item_id, jc.work_item_id)
     LEFT JOIN organizations o ON o.id = COALESCE(sr.organization_id, wi.organization_id)
     LEFT JOIN projects p ON p.id = COALESCE(sr.project_id, wi.project_id)
     LEFT JOIN LATERAL (
       SELECT signed_at, signer_name, signer_role, signature_data
       FROM client_signatures
       WHERE signoff_link_id = csl.id
       ORDER BY signed_at DESC
       LIMIT 1
     ) cs ON true
     WHERE csl.token_hash = $1
     LIMIT 1`,
    [hashToken(token)],
  );
  const row = result.rows[0];
  if (!row) return json({ error: "Sign-off link not found" }, { status: 404 });
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return json({ error: "Sign-off link expired" }, { status: 410 });
  }

  if (row.target_type === "quote") {
    const quote = await getPool().query(
      `SELECT q.quote_number, q.status, q.total_value_cents, q.currency, q.notes,
        o.name AS organization_name, s.name AS site_name
       FROM quotes q
       JOIN organizations o ON o.id = q.organization_id
       JOIN sites s ON s.id = q.site_id
       WHERE q.id = $1`,
      [row.target_id],
    );
    const quoteRow = quote.rows[0];
    return json({
      ok: true,
      link: {
        id: row.id,
        targetType: row.target_type,
        targetId: row.target_id,
        status: row.status,
        expiresAt: row.expires_at,
      },
      target: {
        title: quoteRow ? `Quote ${quoteRow.quote_number}` : "Client sign-off",
        summary: quoteRow
          ? [
              quoteRow.organization_name ? `Client: ${quoteRow.organization_name}` : null,
              quoteRow.site_name ? `Site: ${quoteRow.site_name}` : null,
              quoteRow.total_value_cents !== null
                ? `Total: ${centsToMoney(quoteRow.total_value_cents, quoteRow.currency)}`
                : null,
              quoteRow.status ? `Quote status: ${quoteRow.status}` : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : null,
        organizationName: quoteRow?.organization_name ?? null,
        projectName: null,
        reportStatus: null,
        jobCardStatus: null,
        quoteNumber: quoteRow?.quote_number ?? null,
        quoteStatus: quoteRow?.status ?? null,
        siteName: quoteRow?.site_name ?? null,
        totalValueCents: quoteRow?.total_value_cents ?? null,
      },
      signature: row.signature_signed_at
        ? {
            signedAt: row.signature_signed_at,
            signerName: row.signer_name,
            signerRole: row.signer_role,
            signatureData: row.signature_data,
          }
        : null,
    });
  }

  return json({
    ok: true,
    link: {
      id: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      status: row.status,
      expiresAt: row.expires_at,
    },
    target: {
      title: row.report_title ?? row.work_item_title ?? "Client sign-off",
      summary: row.report_summary ?? null,
      organizationName: row.organization_name ?? null,
      projectName: row.project_name ?? null,
      reportStatus: row.report_status ?? null,
      jobCardStatus: row.job_card_status ?? null,
      reportType: row.report_type ?? null,
      inspectionReport:
        row.report_type === "site_survey"
          ? clientInspectionReportForSignoff(row.report_payload, token)
          : null,
    },
    signature: row.signature_signed_at
      ? {
          signedAt: row.signature_signed_at,
          signerName: row.signer_name,
          signerRole: row.signer_role,
          signatureData: row.signature_data,
        }
      : null,
  });
}

function clientInspectionReportForSignoff(payload: unknown, token: string) {
  const report = asRecord(payload);
  const rawBlocks = Array.isArray(report.blocks) ? report.blocks : [];
  return {
    generatedAt: report.generatedAt ?? null,
    overallOutcome: report.overallOutcome ?? null,
    overallRiskLevel: report.overallRiskLevel ?? null,
    inspectionCount: report.inspectionCount ?? rawBlocks.length,
    blocks: rawBlocks.map((rawBlock) => {
      const block = asRecord(rawBlock);
      const rawItems = Array.isArray(block.items) ? block.items : [];
      return {
        inspectionId: block.inspectionId ?? null,
        name: block.name ?? null,
        category: block.category ?? null,
        asset: asRecord(block.asset),
        area: block.area ?? null,
        technicianName: block.technicianName ?? null,
        completedAt: block.completedAt ?? null,
        riskLevel: block.riskLevel ?? null,
        outcome: block.outcome ?? null,
        items: rawItems.map((rawItem) => {
          const item = asRecord(rawItem);
          const findings = Array.isArray(item.findings) ? item.findings : [];
          const evidence = Array.isArray(item.evidence) ? item.evidence : [];
          return {
            itemText: item.itemText ?? null,
            sansClause: item.sansClause ?? null,
            outcome: item.outcome ?? null,
            comment: item.comment ?? null,
            naReason: item.naReason ?? null,
            findings,
            evidence: evidence.map((rawEvidence) => {
              const file = asRecord(rawEvidence);
              const evidenceId = optionalText(file.id);
              return {
                id: evidenceId,
                fileName: file.file_name ?? null,
                mimeType: file.mime_type ?? null,
                locationText: file.location_text ?? null,
                captureTimestamp: file.capture_timestamp ?? null,
                gpsLat: file.gps_lat ?? null,
                gpsLng: file.gps_lng ?? null,
                url: evidenceId
                  ? `/api/client-signoff/${encodeURIComponent(token)}/evidence/${encodeURIComponent(evidenceId)}`
                  : null,
              };
            }),
          };
        }),
      };
    }),
  };
}

async function clientSignoffEvidence(request: Request, token: string, evidenceId: string) {
  const result = await getPool().query(
    `SELECT ef.file_path, ef.mime_type
     FROM client_signoff_links csl
     JOIN service_reports sr ON sr.id = csl.target_id AND csl.target_type = 'service_report'
     JOIN evidence_files ef ON ef.id = $2
     WHERE csl.token_hash = $1
       AND sr.report_type = 'site_survey'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(COALESCE(sr.report_payload->'blocks', '[]'::jsonb)) block,
              jsonb_array_elements(COALESCE(block->'items', '[]'::jsonb)) item,
              jsonb_array_elements(COALESCE(item->'evidence', '[]'::jsonb)) evidence
         WHERE evidence->>'id' = ef.id::text
       )
     LIMIT 1`,
    [hashToken(token), evidenceId],
  );
  const row = result.rows[0];
  if (!row?.file_path) return json({ error: "Evidence file not found" }, { status: 404 });
  try {
    const buffer = await readFile(row.file_path as string);
    return new Response(buffer, {
      headers: {
        "content-type": row.mime_type || "application/octet-stream",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch {
    return json({ error: "Evidence file is unavailable" }, { status: 404 });
  }
}

async function clientSignoffSubmit(request: Request, token: string) {
  const body = await readJson(request);
  const signerName = requireText(body.signerName, "Signer name");
  const signerRole = optionalText(body.signerRole);
  const signatureData = asRecord(body.signatureData);
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const link = await client.query(
      `SELECT id, target_type, target_id, status, expires_at
       FROM client_signoff_links
       WHERE token_hash = $1
       FOR UPDATE`,
      [hashToken(token)],
    );
    const row = link.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return json({ error: "Sign-off link not found" }, { status: 404 });
    }
    if (row.status !== "active") {
      await client.query("ROLLBACK");
      return json({ error: "Sign-off link is not active" }, { status: 409 });
    }
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      await client.query("ROLLBACK");
      return json({ error: "Sign-off link expired" }, { status: 410 });
    }

    const inserted = await client.query(
      `INSERT INTO client_signatures (
        signoff_link_id, target_type, target_id, signer_name, signer_role, signature_data
       )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      RETURNING id`,
      [
        row.id,
        row.target_type,
        row.target_id,
        signerName,
        signerRole,
        JSON.stringify(signatureData),
      ],
    );

    if (row.target_type === "service_report") {
      await client.query(
        `UPDATE service_reports
         SET status = 'approved',
             approved_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [row.target_id],
      );
    } else if (row.target_type === "quote") {
      const quote = await client.query(
        `SELECT status
         FROM quotes
         WHERE id = $1
         FOR UPDATE`,
        [row.target_id],
      );
      const quoteRow = quote.rows[0];
      if (!quoteRow) {
        await client.query("ROLLBACK");
        return json({ error: "Quote not found" }, { status: 404 });
      }
      if (!["sent_to_client", "accepted"].includes(quoteRow.status)) {
        await client.query("ROLLBACK");
        return json(
          { error: "Quote must be sent to the client before it can be accepted" },
          { status: 409 },
        );
      }
      await client.query(
        `UPDATE quotes
         SET status = 'accepted',
             decided_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [row.target_id],
      );
    } else {
      await client.query(
        `UPDATE job_cards
         SET status = 'signed',
             signed_by_name = $2,
             signed_at = now()
         WHERE id = $1`,
        [row.target_id, signerName],
      );
    }
    await client.query(
      `UPDATE client_signoff_links
       SET status = 'submitted',
           updated_at = now()
       WHERE id = $1`,
      [row.id],
    );
    await audit(client, "client_signoff_submitted", row.target_type, row.target_id, {
      signoffLinkId: row.id,
      signatureId: inserted.rows[0].id,
      signerName,
    });
    await client.query("COMMIT");
    return json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function approvalRequests(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  if (request.method === "POST") {
    const body = await readJson(request);
    const result = await getPool().query(
      `INSERT INTO approval_requests (
        requested_by, assigned_to, action_type, entity_type, entity_id, title, summary, payload
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id`,
      [
        auth.user.id,
        optionalText(body.assignedTo),
        requireText(body.actionType, "Action type"),
        requireText(body.entityType, "Entity type"),
        optionalText(body.entityId),
        requireText(body.title, "Title"),
        optionalText(body.summary),
        JSON.stringify(asRecord(body.payload)),
      ],
    );
    await getPool().query(
      `INSERT INTO agent_actions (
        requested_by, approval_request_id, action_type, entity_type, entity_id, status, input
       )
       VALUES ($1, $2, $3, $4, $5, 'pending_approval', $6::jsonb)`,
      [
        auth.user.id,
        result.rows[0].id,
        requireText(body.actionType, "Action type"),
        requireText(body.entityType, "Entity type"),
        optionalText(body.entityId),
        JSON.stringify(asRecord(body.payload)),
      ],
    );
    await audit(
      getPool(),
      "create_approval_request",
      "approval_request",
      result.rows[0].id,
      {},
      auth.user,
    );
    return json({ ok: true, approvalRequestId: result.rows[0].id }, { status: 201 });
  }

  const rows = await getPool().query(`
    SELECT ar.id, ar.action_type, ar.entity_type, ar.entity_id, ar.status, ar.title, ar.summary,
      requester.name AS requested_by_name, assignee.name AS assigned_to_name, ar.created_at, ar.decided_at
    FROM approval_requests ar
    LEFT JOIN app_users requester ON requester.id = ar.requested_by
    LEFT JOIN app_users assignee ON assignee.id = ar.assigned_to
    ORDER BY ar.created_at DESC
    LIMIT 200
  `);
  return json({ approvals: rows.rows });
}

async function approvalRequestDecision(request: Request, approvalId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = await readJson(request);
  const status = requireOneOf(body.status, "Status", ["approved", "rejected", "cancelled"]);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT id, action_type, entity_type, entity_id, payload, status
       FROM approval_requests
       WHERE id = $1
       FOR UPDATE`,
      [approvalId],
    );
    const approval = current.rows[0] as
      | {
          id: string;
          action_type: string;
          entity_type: string;
          entity_id: string | null;
          payload: unknown;
          status: string;
        }
      | undefined;
    if (!approval) {
      await client.query("ROLLBACK");
      return json({ error: "Approval request not found" }, { status: 404 });
    }

    await client.query(
      `UPDATE approval_requests
       SET status = $1, decided_by = $2, decided_at = now()
       WHERE id = $3`,
      [status, auth.user.id, approvalId],
    );
    await client.query(
      `UPDATE agent_actions
       SET status = CASE WHEN $1 = 'approved' THEN 'approved' WHEN $1 = 'rejected' THEN 'rejected' ELSE status END,
         updated_at = now()
       WHERE approval_request_id = $2`,
      [status, approvalId],
    );

    if (status === "approved") {
      const executor = approvalExecutors[approval.action_type];
      if (executor) {
        await executor({
          client,
          authUser: auth.user,
          approvalId,
          approval,
          payload: asRecord(approval.payload),
        });
        await client.query(
          `UPDATE approval_requests
           SET status = 'executed'
           WHERE id = $1`,
          [approvalId],
        );
        await client.query(
          `UPDATE agent_actions
           SET status = 'executed',
               output = $2::jsonb,
               updated_at = now()
           WHERE approval_request_id = $1`,
          [
            approvalId,
            JSON.stringify({
              executed: true,
              actionType: approval.action_type,
              recipient: optionalText(asRecord(approval.payload).recipient),
            }),
          ],
        );
      }
    }

    await audit(client, `approval_${status}`, "approval_request", approvalId, {}, auth.user);
    await client.query("COMMIT");
    return json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function quoteSupport(request: Request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  const [organizations, sites, parts, templates] = await Promise.all([
    getPool().query("SELECT id, name FROM organizations ORDER BY name LIMIT 250"),
    getPool().query(
      `SELECT s.id, s.organization_id, s.name, s.address,
        count(sa.id)::int AS asset_count
       FROM sites s
       LEFT JOIN site_assets sa ON sa.site_id = s.id
       GROUP BY s.id
       ORDER BY s.name
       LIMIT 500`,
    ),
    getPool().query(
      `SELECT id, part_code, description, category, manufacturer, system_family,
        default_unit_cost_cents, default_unit_price_cents
       FROM parts
       WHERE active = true
       ORDER BY category, part_code
       LIMIT 500`,
    ),
    listQuoteTemplates(getPool()),
  ]);

  return json({
    organizations: organizations.rows,
    sites: sites.rows,
    parts: parts.rows,
    templates: templates.rows,
  });
}

async function quoteTemplates(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  if (request.method === "POST") {
    const body = await readJson(request);
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const created = await createQuoteTemplateRecord(client, auth.user.id, body);
      await audit(
        client,
        "create_quote_template",
        "quote_template",
        created.templateId,
        {
          sourceQuoteId: optionalText(body.sourceQuoteId),
          requestedBy: auth.user.email,
        },
        auth.user,
      );
      await client.query("COMMIT");
      return json({ ok: true, ...created }, { status: 201 });
    } catch (error) {
      await client.query("ROLLBACK");
      const response = responseFromError(error);
      if (response) return response;
      throw error;
    } finally {
      client.release();
    }
  }

  const rows = await listQuoteTemplates(getPool());
  return json({ templates: rows.rows });
}

async function quotes(request: Request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  if (request.method === "POST") {
    const body = await readJson(request);
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const draft = await createQuoteDraftRecord(client, auth.user.id, body);
      const quoteId = draft.quoteId;
      const quoteRecord = await client.query("SELECT * FROM quotes WHERE id = $1", [quoteId]);
      await audit(
        client,
        "create_quote",
        "quote",
        quoteId,
        { organizationId: draft.organizationId, siteId: draft.siteId },
        auth.user,
      );
      await client.query("COMMIT");
      return json({ ok: true, quote: quoteRecord.rows[0] }, { status: 201 });
    } catch (error) {
      await client.query("ROLLBACK");
      const response = responseFromError(error);
      if (response) return response;
      throw error;
    } finally {
      client.release();
    }
  }

  const rows = await getPool().query(`
    WITH latest_validation AS (
      SELECT DISTINCT ON (quote_id) quote_id, status, summary, created_at
      FROM quote_validations
      ORDER BY quote_id, created_at DESC
    )
    SELECT q.id, q.quote_number, q.status, q.currency, q.total_value_cents,
      q.total_cost_cents, q.margin_cents, q.margin_percent, q.valid_until,
      q.created_at, q.updated_at, o.name AS organization_name, s.name AS site_name,
      u.name AS created_by_name, lv.status AS validation_status,
      lv.summary AS validation_summary, lv.created_at AS validation_at
    FROM quotes q
    JOIN organizations o ON o.id = q.organization_id
    JOIN sites s ON s.id = q.site_id
    LEFT JOIN app_users u ON u.id = q.created_by
    LEFT JOIN latest_validation lv ON lv.quote_id = q.id
    ORDER BY q.updated_at DESC
    LIMIT 150
  `);
  return json({
    quotes: rows.rows.map((row) => ({
      ...row,
      attention: quoteAttention(row.status, row.validation_status),
    })),
  });
}

async function quoteDetail(request: Request, quoteId: string) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  if (request.method === "PATCH") {
    const body = await readJson(request);
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const current = await client.query("SELECT status FROM quotes WHERE id = $1 FOR UPDATE", [
        quoteId,
      ]);
      if (!current.rows[0]) {
        await client.query("ROLLBACK");
        return json({ error: "Quote not found" }, { status: 404 });
      }
      if (!["draft", "pending_technical_review"].includes(current.rows[0].status)) {
        await client.query("ROLLBACK");
        return json(
          { error: "Only draft or technical-review quotes can be edited" },
          { status: 409 },
        );
      }
      await client.query(
        `UPDATE quotes
         SET valid_until = COALESCE($2, valid_until),
           client_reference = $3,
           notes = $4,
           updated_at = now()
         WHERE id = $1`,
        [
          quoteId,
          optionalText(body.validUntil),
          optionalString(body.clientReference),
          optionalString(body.notes),
        ],
      );
      if (Array.isArray(body.lines)) await replaceQuoteLines(client, quoteId, body.lines);
      else await refreshQuoteEmbedding(client, quoteId);
      await audit(client, "update_quote", "quote", quoteId, {}, auth.user);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  const quote = await getPool().query(
    `SELECT q.*, o.name AS organization_name, s.name AS site_name, s.address AS site_address,
      creator.name AS created_by_name, approver.name AS approved_by_name
     FROM quotes q
     JOIN organizations o ON o.id = q.organization_id
     JOIN sites s ON s.id = q.site_id
     LEFT JOIN app_users creator ON creator.id = q.created_by
     LEFT JOIN app_users approver ON approver.id = q.approved_by
     WHERE q.id = $1`,
    [quoteId],
  );
  if (!quote.rows[0]) return json({ error: "Quote not found" }, { status: 404 });

  const [lines, validations, audits, assets] = await Promise.all([
    getPool().query(
      `SELECT qli.*, p.manufacturer, p.system_family, p.category
       FROM quote_line_items qli
       LEFT JOIN parts p ON p.id = qli.part_id
       WHERE qli.quote_id = $1
       ORDER BY qli.position, qli.created_at`,
      [quoteId],
    ),
    getPool().query(
      `SELECT qv.*, u.name AS actor_name
       FROM quote_validations qv
       LEFT JOIN app_users u ON u.id = qv.actor_id
       WHERE qv.quote_id = $1
       ORDER BY qv.created_at DESC`,
      [quoteId],
    ),
    getPool().query(
      `SELECT ae.action, ae.metadata, ae.created_at, u.name AS actor_name
       FROM audit_events ae
       LEFT JOIN app_users u ON u.id = ae.actor_id
       WHERE ae.entity_type = 'quote' AND ae.entity_id = $1
       ORDER BY ae.created_at DESC
       LIMIT 50`,
      [quoteId],
    ),
    getPool().query(
      `SELECT id, asset_type, manufacturer, model, system_family, notes
       FROM site_assets
       WHERE site_id = $1
       ORDER BY created_at DESC`,
      [quote.rows[0].site_id],
    ),
  ]);

  return json({
    quote: quote.rows[0],
    lines: lines.rows,
    validations: validations.rows,
    auditEvents: audits.rows,
    siteAssets: assets.rows,
  });
}

async function quoteStatus(request: Request, quoteId: string) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  const body = await readJson(request);
  const nextStatus = requireOneOf(body.status, "Status", quoteStatuses);

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT id, status FROM quotes WHERE id = $1 FOR UPDATE", [
      quoteId,
    ]);
    const quote = current.rows[0] as { id: string; status: QuoteStatus } | undefined;
    if (!quote) {
      await client.query("ROLLBACK");
      return json({ error: "Quote not found" }, { status: 404 });
    }
    if (!allowedQuoteTransitions[quote.status].includes(nextStatus)) {
      await client.query("ROLLBACK");
      return json(
        { error: `Cannot move quote from ${quote.status} to ${nextStatus}` },
        { status: 400 },
      );
    }

    if (nextStatus === "approved_internal") {
      const validation = await client.query(
        `SELECT status FROM quote_validations
         WHERE quote_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [quoteId],
      );
      if (validation.rows[0]?.status !== "green") {
        await audit(
          client,
          "quote_approval_blocked",
          "quote",
          quoteId,
          { latestValidationStatus: validation.rows[0]?.status ?? null },
          auth.user,
        );
        await client.query("COMMIT");
        return json(
          { error: "A green Steve technical validation is required before approval" },
          { status: 409 },
        );
      }
    }
    if (nextStatus === "sent_to_client") {
      const structureIssue = await quoteStructureIssue(client, quoteId);
      if (structureIssue) {
        await client.query("ROLLBACK");
        return json({ error: structureIssue }, { status: 409 });
      }
    }

    await client.query(
      `UPDATE quotes
       SET status = $2,
         approved_by = CASE WHEN $2 = 'approved_internal' THEN $3 ELSE approved_by END,
         approved_at = CASE WHEN $2 = 'approved_internal' THEN now() ELSE approved_at END,
         sent_at = CASE WHEN $2 = 'sent_to_client' THEN now() ELSE sent_at END,
         decided_at = CASE WHEN $2 IN ('accepted', 'rejected') THEN now() ELSE decided_at END,
         updated_at = now()
       WHERE id = $1`,
      [quoteId, nextStatus, auth.user.id],
    );
    await audit(
      client,
      "change_quote_status",
      "quote",
      quoteId,
      { from: quote.status, to: nextStatus },
      auth.user,
    );
    await client.query("COMMIT");
    return json({ ok: true, status: nextStatus });
  } catch (error) {
    await client.query("ROLLBACK");
    const response = responseFromError(error);
    if (response) return response;
    throw error;
  } finally {
    client.release();
  }
}

async function validateQuote(request: Request, quoteId: string) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const quote = await client.query(
      `SELECT q.id, q.quote_number, q.site_id, q.organization_id, s.name AS site_name, o.name AS organization_name
       FROM quotes q
       JOIN sites s ON s.id = q.site_id
       JOIN organizations o ON o.id = q.organization_id
      WHERE q.id = $1`,
      [quoteId],
    );
    if (!quote.rows[0]) {
      await client.query("ROLLBACK");
      return json({ error: "Quote not found" }, { status: 404 });
    }

    const [lines, assets, rag] = await Promise.all([
      client.query(
        `SELECT qli.id, qli.part_code, qli.description, p.manufacturer, p.system_family
         FROM quote_line_items qli
         LEFT JOIN parts p ON p.id = qli.part_id
         WHERE qli.quote_id = $1
         ORDER BY qli.position`,
        [quoteId],
      ),
      client.query(
        `SELECT id, asset_type, manufacturer, model, system_family, notes
         FROM site_assets
         WHERE site_id = $1
         ORDER BY created_at DESC
         LIMIT 25`,
        [quote.rows[0].site_id],
      ),
      client.query(
        `SELECT id, entity_type, entity_id, content, metadata,
          ts_rank(search_vector, plainto_tsquery('english', $1)) AS score
         FROM embedding_documents
         WHERE search_vector @@ plainto_tsquery('english', $1)
           AND (
             metadata->>'siteId' = $2
             OR metadata->>'organizationId' = $3
             OR content ILIKE $4
           )
         ORDER BY score DESC, updated_at DESC
         LIMIT 8`,
        [
          `${quote.rows[0].site_name} fire panel detector assets`,
          quote.rows[0].site_id,
          quote.rows[0].organization_id,
          `%${quote.rows[0].site_name}%`,
        ],
      ),
    ]);

    const installedFamilies = new Set<string>();
    const evidence: Record<string, unknown>[] = [];
    for (const asset of assets.rows) {
      const family =
        optionalText(asset.system_family)?.toLowerCase() ??
        quoteFamilyFromText(`${asset.manufacturer} ${asset.model} ${asset.notes}`);
      if (family && family !== "generic" && family !== "service") installedFamilies.add(family);
      evidence.push({ source: "site_asset", ...asset });
    }
    for (const row of rag.rows) {
      const family = quoteFamilyFromText(row.content);
      if (family) installedFamilies.add(family);
      evidence.push({
        source: "rag",
        entityType: row.entity_type,
        entityId: row.entity_id,
        content: typeof row.content === "string" ? row.content.slice(0, 600) : "",
      });
    }

    const flagged: { lineId: string; partFamily: string; installedFamilies: string[] }[] = [];
    for (const line of lines.rows) {
      const partFamily =
        optionalText(line.system_family)?.toLowerCase() ??
        quoteFamilyFromText(`${line.part_code} ${line.description} ${line.manufacturer}`);
      if (
        partFamily &&
        !["generic", "service"].includes(partFamily) &&
        installedFamilies.size > 0 &&
        !installedFamilies.has(partFamily)
      ) {
        flagged.push({
          lineId: line.id,
          partFamily,
          installedFamilies: Array.from(installedFamilies),
        });
      }
    }

    const status = flagged.length ? "red" : installedFamilies.size ? "green" : "amber";
    const summary = flagged.length
      ? `Warning: quoted ${flagged.map((item) => item.partFamily).join(", ")} parts conflict with installed ${Array.from(installedFamilies).join(", ")} site context.`
      : installedFamilies.size
        ? `Green: quoted parts match known ${Array.from(installedFamilies).join(", ")} site context.`
        : "Amber: no structured site asset or matching RAG context was found. Add site asset context before approval.";

    const toolCallId = await logSteveTool(client, "quote_technical_validation", {
      quoteId,
      installedFamilies: Array.from(installedFamilies),
      lineCount: lines.rows.length,
    });
    const validation = await client.query(
      `INSERT INTO quote_validations (
        quote_id, actor_id, status, summary, evidence, implicated_line_item_ids, tool_call_id
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::uuid[], $7)
       RETURNING *`,
      [
        quoteId,
        auth.user.id,
        status,
        summary,
        JSON.stringify(evidence),
        flagged.map((item) => item.lineId),
        toolCallId,
      ],
    );
    await completeSteveTool(client, toolCallId, {
      status,
      summary,
      flagged,
      evidenceCount: evidence.length,
    });
    await audit(
      client,
      "run_quote_validation",
      "quote",
      quoteId,
      { status, validationId: validation.rows[0].id },
      auth.user,
    );
    await client.query("COMMIT");
    return json({ ok: true, validation: validation.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function steveOverview(request: Request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  const steve = await getSteveProfile();

  const doctrine = await getPool().query(
    `SELECT id, entity_type, content, metadata, created_at
     FROM embedding_documents
     WHERE owner_agent_id = $1 AND entity_type = 'operating_doctrine'
     ORDER BY created_at DESC
     LIMIT 1`,
    [steve.profileId],
  );

  const kpis = await getPool().query(`
    WITH open_deals AS (
      SELECT d.*
      FROM deals d
      JOIN pipeline_stages s ON s.id = d.stage_id
      WHERE s.name NOT IN ('Won', 'Lost') AND d.status = 'open'
    ),
    new_leads AS (
      SELECT count(*)::int AS count
      FROM deals
      WHERE created_at >= current_date
    ),
    missing_bant AS (
      SELECT count(*)::int AS count
      FROM open_deals d
      WHERE NOT EXISTS (
        SELECT 1
        FROM embedding_documents ed
        WHERE ed.entity_id = d.id
          AND ed.content ILIKE '%BANT%'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM communications c
        WHERE c.deal_id = d.id
          AND (c.body ILIKE '%BANT%' OR c.summary ILIKE '%BANT%')
      )
    ),
    ready_meddic AS (
      SELECT count(*)::int AS count
      FROM open_deals d
      WHERE (d.description IS NOT NULL OR d.service_interest IS NOT NULL)
        AND d.value_cents > 0
        AND NOT EXISTS (
          SELECT 1
          FROM embedding_documents ed
          WHERE ed.entity_id = d.id
            AND ed.content ILIKE '%MEDDIC%'
        )
    ),
    stale AS (
      SELECT count(*)::int AS count
      FROM open_deals
      WHERE COALESCE(last_activity_at, created_at) < now() - interval '7 days'
    ),
    pipeline AS (
      SELECT
        COALESCE(sum(value_cents)::int, 0) AS value_cents,
        count(*)::int AS deals
      FROM open_deals
    ),
    quotes AS (
      SELECT
        count(*) FILTER (WHERE s.name ILIKE '%quote%')::int AS active_quotes,
        COALESCE(sum(d.value_cents) FILTER (WHERE s.name ILIKE '%quote%'), 0)::int AS quote_value_cents
      FROM deals d
      JOIN pipeline_stages s ON s.id = d.stage_id
    ),
    projects_done AS (
      SELECT
        count(*) FILTER (WHERE updated_at >= date_trunc('week', now()))::int AS completed_week,
        count(*) FILTER (WHERE updated_at >= date_trunc('month', now()))::int AS completed_month
      FROM projects
      WHERE status = 'completed'
    ),
    billing AS (
      SELECT
        COALESCE(sum(total_cents) FILTER (WHERE status IN ('sent', 'overdue')), 0)::int AS outstanding_cents,
        COALESCE(sum(total_cents) FILTER (WHERE status = 'paid'), 0)::int AS paid_cents,
        count(*) FILTER (WHERE status = 'overdue')::int AS overdue_invoices
      FROM invoices
    ),
    blocked AS (
      SELECT count(*)::int AS count FROM tasks WHERE status = 'blocked'
    ),
    overdue_tasks AS (
      SELECT count(*)::int AS count
      FROM tasks
      WHERE status IN ('open', 'blocked') AND due_at < now()
    ),
    pending_recs AS (
      SELECT count(*)::int AS count FROM ai_recommendations WHERE status = 'pending'
    )
    SELECT
      (SELECT count FROM new_leads) AS new_leads_today,
      (SELECT count FROM missing_bant) AS leads_missing_bant,
      (SELECT count FROM ready_meddic) AS leads_ready_meddic,
      (SELECT count FROM stale) AS stale_leads,
      (SELECT value_cents FROM pipeline) AS pipeline_value_cents,
      (SELECT deals FROM pipeline) AS open_deals,
      (SELECT active_quotes FROM quotes) AS active_quotes,
      (SELECT quote_value_cents FROM quotes) AS quote_value_cents,
      COALESCE((SELECT completed_week FROM projects_done), 0) AS projects_completed_week,
      COALESCE((SELECT completed_month FROM projects_done), 0) AS projects_completed_month,
      (SELECT outstanding_cents FROM billing) AS outstanding_invoice_cents,
      (SELECT paid_cents FROM billing) AS paid_invoice_cents,
      (SELECT overdue_invoices FROM billing) AS overdue_invoices,
      (SELECT count FROM blocked) AS blocked_tasks,
      (SELECT count FROM overdue_tasks) AS overdue_tasks,
      (SELECT count FROM pending_recs) AS pending_recommendations
  `);

  const ownerWorkload = await getPool().query(`
    SELECT
      u.id,
      u.name,
      u.email,
      count(t.id) FILTER (WHERE t.status IN ('open', 'blocked'))::int AS active_tasks,
      count(t.id) FILTER (WHERE t.status = 'blocked')::int AS blocked_tasks,
      count(t.id) FILTER (WHERE t.status IN ('open', 'blocked') AND t.due_at < now())::int AS overdue_tasks,
      count(a.id) FILTER (WHERE a.created_at >= current_date)::int AS activity_today
    FROM app_users u
    LEFT JOIN tasks t ON t.owner_id = u.id
    LEFT JOIN activities a ON a.actor_id = u.id
    WHERE u.role IN ('admin', 'staff')
    GROUP BY u.id
    ORDER BY u.name
  `);

  const blockedWork = await getPool().query(`
    SELECT t.id, t.title, t.priority, t.due_at, u.name AS owner_name,
      o.name AS organization_name, d.title AS deal_title, p.name AS project_name
    FROM tasks t
    LEFT JOIN app_users u ON u.id = t.owner_id
    LEFT JOIN organizations o ON o.id = t.organization_id
    LEFT JOIN deals d ON d.id = t.deal_id
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.status = 'blocked'
    ORDER BY t.due_at ASC NULLS LAST, t.updated_at DESC
    LIMIT 10
  `);

  const overdueFollowUps = await getPool().query(`
    SELECT t.id, t.title, t.priority, t.due_at, u.name AS owner_name,
      o.name AS organization_name, d.title AS deal_title
    FROM tasks t
    LEFT JOIN app_users u ON u.id = t.owner_id
    LEFT JOIN organizations o ON o.id = t.organization_id
    LEFT JOIN deals d ON d.id = t.deal_id
    WHERE t.status IN ('open', 'blocked')
      AND t.due_at < now()
      AND (
        t.title ILIKE '%follow%'
        OR t.title ILIKE '%qualify%'
        OR t.description ILIKE '%BANT%'
        OR t.description ILIKE '%lead%'
      )
    ORDER BY t.due_at ASC
    LIMIT 10
  `);

  const quoteDelays = await getPool().query(`
    SELECT d.id, d.title, d.value_cents, d.currency, d.updated_at, s.name AS stage_name,
      u.name AS owner_name, o.name AS organization_name
    FROM deals d
    JOIN pipeline_stages s ON s.id = d.stage_id
    LEFT JOIN app_users u ON u.id = d.owner_id
    LEFT JOIN organizations o ON o.id = d.organization_id
    WHERE s.name ILIKE '%quote%'
      AND d.updated_at < now() - interval '5 days'
    ORDER BY d.updated_at ASC
    LIMIT 10
  `);

  const recommendations = await getPool().query(`
    SELECT r.id, r.recommendation_type, r.title, r.body, r.requires_approval, r.created_at,
      d.title AS deal_title, p.name AS project_name, o.name AS organization_name
    FROM ai_recommendations r
    LEFT JOIN deals d ON d.id = r.deal_id
    LEFT JOIN projects p ON p.id = r.project_id
    LEFT JOIN organizations o ON o.id = r.organization_id
    WHERE r.status = 'pending'
    ORDER BY r.created_at DESC
    LIMIT 12
  `);

  const escalations = await getPool().query(`
    SELECT action, entity_type, entity_id, metadata, created_at
    FROM audit_events
    WHERE action IN ('steve_escalation', 'steve_approval_gate', 'steve_management_review')
    ORDER BY created_at DESC
    LIMIT 12
  `);

  return json({
    profile: {
      displayName: steve.displayName,
      persona: steve.persona,
      authorityModel: steve.authorityModel,
      defaultContext: steve.defaultContext,
    },
    doctrine: doctrine.rows[0] ?? null,
    kpis: kpis.rows[0],
    ownerWorkload: ownerWorkload.rows,
    blockedWork: blockedWork.rows,
    overdueFollowUps: overdueFollowUps.rows,
    quoteDelays: quoteDelays.rows,
    recommendations: recommendations.rows,
    escalations: escalations.rows,
  });
}

function steveDoctrineAnswer(question: string, doctrine: string, context: Record<string, unknown>) {
  const lower = question.toLowerCase();
  const parts = [];
  if (/\b(bant|qualif|lead|mellissa)\b/.test(lower)) {
    parts.push(
      "Mellissa should own daily lead follow-up, qualification, BANT completion, warm lead nurturing, and lead administration unless the lead is explicitly owned elsewhere.",
    );
  }
  if (/\b(meddic|discover|pain|project)\b/.test(lower)) {
    parts.push(
      "Use MEDDIC once a real project or pain point exists, after BANT is captured. Missing BANT or MEDDIC data is a process gap Steve should flag.",
    );
  }
  if (/\b(quote|quotation|technical|vusi|site visit|delivery|onboarding)\b/.test(lower)) {
    parts.push(
      "Vusi should own technical sales, quotation preparation or revision, site visit guidance, onboarding, delivery, and most client-facing operational decisions.",
    );
  }
  if (/\b(nextgrid|energy|renewable|george)\b/.test(lower)) {
    parts.push(
      "George should receive Nextgrid, renewable, energy-related, and selected operations support tasks.",
    );
  }
  if (/\b(kiril|ceo|finance|payment|complex|escalat|approval)\b/.test(lower)) {
    parts.push(
      "Kiril remains CEO and final escalation point for complex deals, complex quote revisions, finance/payment decisions, and executive oversight.",
    );
  }
  if (/\b(kpi|report|daily|weekly|pipeline|billing|cash|revenue)\b/.test(lower)) {
    parts.push(
      `Current snapshot: ${context.openDeals ?? 0} open deals, ${context.leadsMissingBant ?? 0} leads missing BANT, ${context.staleLeads ?? 0} stale leads, and ${context.overdueTasks ?? 0} overdue tasks.`,
    );
  }
  if (parts.length === 0) {
    parts.push(
      "Steve should follow the STI Risk lifecycle: lead generation, BANT, MEDDIC discovery where there is a real pain or project, quotation, acceptance, onboarding, delivery, commissioning/training/handover, and aftersales nurture.",
    );
  }
  return {
    answer: parts.join(" "),
    doctrineExcerpt: doctrine.slice(0, 700),
  };
}

async function steveAsk(request: Request) {
  const auth = await requireSteveAdminAccess(request);
  if (auth.response) return auth.response;

  const body = await readJson(request);
  const question = requireText(body.question, "Question");
  const steve = await getSteveProfile();
  const toolCallId = await logSteveTool(getPool(), "ask_steve", {
    question,
    requestedBy: auth.user.email,
  });

  const doctrine = await getPool().query(
    `SELECT content, metadata
     FROM embedding_documents
     WHERE owner_agent_id = $1 AND entity_type = 'operating_doctrine'
     ORDER BY created_at DESC
     LIMIT 1`,
    [steve.profileId],
  );

  const matches = await getPool().query(
    `SELECT entity_type, entity_id, content, metadata
     FROM embedding_documents
     WHERE search_vector @@ plainto_tsquery('english', $1)
     ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC
     LIMIT 6`,
    [question],
  );

  const snapshot = await getPool().query(`
    WITH open_deals AS (
      SELECT d.*
      FROM deals d
      JOIN pipeline_stages s ON s.id = d.stage_id
      WHERE s.name NOT IN ('Won', 'Lost') AND d.status = 'open'
    )
    SELECT
      (SELECT count(*)::int FROM open_deals) AS open_deals,
      (SELECT count(*)::int FROM open_deals WHERE COALESCE(last_activity_at, created_at) < now() - interval '7 days') AS stale_leads,
      (SELECT count(*)::int FROM tasks WHERE status IN ('open', 'blocked') AND due_at < now()) AS overdue_tasks,
      (SELECT count(*)::int FROM ai_recommendations WHERE status = 'pending') AS pending_recommendations,
      (SELECT count(*)::int FROM open_deals d WHERE NOT EXISTS (
        SELECT 1 FROM embedding_documents ed WHERE ed.entity_id = d.id AND ed.content ILIKE '%BANT%'
      )) AS leads_missing_bant
  `);

  const doctrineText = (doctrine.rows[0]?.content as string | undefined) ?? "";
  const response = steveDoctrineAnswer(question, doctrineText, {
    openDeals: snapshot.rows[0]?.open_deals,
    staleLeads: snapshot.rows[0]?.stale_leads,
    overdueTasks: snapshot.rows[0]?.overdue_tasks,
    leadsMissingBant: snapshot.rows[0]?.leads_missing_bant,
  });

  await completeSteveTool(getPool(), toolCallId, {
    answer: response.answer,
    matches: matches.rows.length,
  });
  await audit(getPool(), "steve_answer", "agent_profile", steve.profileId, { question }, auth.user);

  return json({
    ok: true,
    answer: response.answer,
    doctrineExcerpt: response.doctrineExcerpt,
    memory: matches.rows,
    kpiSnapshot: snapshot.rows[0],
  });
}

async function steveAction(request: Request) {
  const auth = await requireSteveAdminAccess(request);
  if (auth.response) return auth.response;

  const body = await readJson(request);
  const action = requireText(body.action, "Action");
  const steve = await getSteveProfile();
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const toolCallId = await logSteveTool(client, action, {
      ...body,
      requestedBy: auth.user.email,
    });

    if (approvalGatedSteveActions.has(action)) {
      const title = optionalText(body.title) ?? `Approval required: ${action.replaceAll("_", " ")}`;
      const recommendation = await client.query(
        `INSERT INTO ai_recommendations (
          deal_id, contact_id, organization_id, project_id, task_id,
          recommendation_type, title, body, requires_approval, payload
         )
         VALUES ($1, $2, $3, $4, $5, 'approval_gate', $6, $7, true, $8::jsonb)
         RETURNING id`,
        [
          body.dealId ?? null,
          body.contactId ?? null,
          body.organizationId ?? null,
          body.projectId ?? null,
          body.taskId ?? null,
          title,
          optionalText(body.body) ??
            "Steve identified an approval-gated action. Staff must approve or edit before execution.",
          JSON.stringify({ requestedAction: action, requestedBy: auth.user.email }),
        ],
      );
      await audit(
        client,
        "steve_approval_gate",
        "ai_recommendation",
        recommendation.rows[0].id,
        { action, requestedBy: auth.user.email },
        steve.user,
      );
      await completeSteveTool(client, toolCallId, {
        gated: true,
        recommendationId: recommendation.rows[0].id,
      });
      await client.query("COMMIT");
      return json({ ok: true, gated: true, recommendationId: recommendation.rows[0].id });
    }

    if (action === "create_draft_quote") {
      const draft = await createQuoteDraftRecord(client, steve.user.id, body);
      const quote = await client.query("SELECT * FROM quotes WHERE id = $1", [draft.quoteId]);
      await audit(
        client,
        "steve_create_draft_quote",
        "quote",
        draft.quoteId,
        {
          organizationId: draft.organizationId,
          siteId: draft.siteId,
          requestedBy: auth.user.email,
        },
        steve.user,
      );
      await completeSteveTool(client, toolCallId, {
        quoteId: draft.quoteId,
        quoteNumber: draft.quoteNumber,
      });
      await client.query("COMMIT");
      return json({
        ok: true,
        quoteId: draft.quoteId,
        quoteNumber: draft.quoteNumber,
        quote: quote.rows[0],
      });
    }

    if (action === "create_quote_template") {
      const created = await createQuoteTemplateRecord(client, steve.user.id, body);
      await audit(
        client,
        "steve_create_quote_template",
        "quote_template",
        created.templateId,
        { requestedBy: auth.user.email, name: optionalText(body.name) ?? created.templateName },
        steve.user,
      );
      await completeSteveTool(client, toolCallId, {
        templateId: created.templateId,
        templateName: created.templateName,
      });
      await client.query("COMMIT");
      return json({
        ok: true,
        templateId: created.templateId,
        templateName: created.templateName,
      });
    }

    if (action === "create_draft_project") {
      const draft = await createProjectDraftRecord(client, steve.user.id, body);
      const project = await client.query("SELECT * FROM projects WHERE id = $1", [draft.projectId]);
      await audit(
        client,
        "steve_create_draft_project",
        "project",
        draft.projectId,
        { dealId: draft.dealId, requestedBy: auth.user.email },
        steve.user,
      );
      await completeSteveTool(client, toolCallId, {
        projectId: draft.projectId,
      });
      await client.query("COMMIT");
      return json({
        ok: true,
        projectId: draft.projectId,
        project: project.rows[0],
      });
    }

    if (action === "create_task" || action === "assign_task") {
      const title = requireText(body.title, "Task title");
      const description = optionalText(body.description);
      const owner = await resolveSteveOwner(
        client,
        `${title} ${description ?? ""}`,
        optionalText(body.ownerEmail) ?? undefined,
      );
      const board = await ensureTaskBoard(client);
      const backlog = board.stages.find((stage) => stage.name === "Backlog") ?? board.stages[0];
      const task = await client.query(
        `INSERT INTO tasks (
          board_id, stage_id, project_id, deal_id, organization_id, owner_id,
          title, description, priority, due_at, source
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'medium'), $10, 'steve')
         RETURNING id`,
        [
          board.boardId,
          backlog.id,
          body.projectId ?? null,
          body.dealId ?? null,
          body.organizationId ?? null,
          owner.ownerId,
          title,
          description,
          optionalText(body.priority),
          optionalText(body.dueAt),
        ],
      );
      await client.query(
        `INSERT INTO embedding_documents (entity_type, entity_id, owner_agent_id, content, metadata)
         VALUES ('task', $1, $2, $3, $4::jsonb)`,
        [
          task.rows[0].id,
          steve.profileId,
          [title, description, owner.reason].filter(Boolean).join("\n"),
          JSON.stringify({ source: "steve", delegatedTo: owner.ownerEmail, reason: owner.reason }),
        ],
      );
      await audit(
        client,
        "steve_create_task",
        "task",
        task.rows[0].id,
        { delegatedTo: owner.ownerEmail, reason: owner.reason, requestedBy: auth.user.email },
        steve.user,
      );
      await completeSteveTool(client, toolCallId, {
        taskId: task.rows[0].id,
        delegatedTo: owner.ownerEmail,
      });
      await client.query("COMMIT");
      return json({
        ok: true,
        taskId: task.rows[0].id,
        delegatedTo: owner.ownerEmail,
        delegatedName: owner.ownerName,
        reason: owner.reason,
      });
    }

    if (action === "create_recommendation" || action === "log_management_review") {
      const title = requireText(body.title, "Recommendation title");
      const recommendation = await client.query(
        `INSERT INTO ai_recommendations (
          deal_id, contact_id, organization_id, project_id, task_id,
          recommendation_type, title, body, requires_approval, payload
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9::jsonb)
         RETURNING id`,
        [
          body.dealId ?? null,
          body.contactId ?? null,
          body.organizationId ?? null,
          body.projectId ?? null,
          body.taskId ?? null,
          action === "log_management_review" ? "management_review" : "steve_recommendation",
          title,
          requireText(body.body, "Recommendation body"),
          JSON.stringify({ source: "steve", requestedBy: auth.user.email }),
        ],
      );
      await audit(
        client,
        action === "log_management_review" ? "steve_management_review" : "steve_recommendation",
        "ai_recommendation",
        recommendation.rows[0].id,
        { requestedBy: auth.user.email },
        steve.user,
      );
      await completeSteveTool(client, toolCallId, {
        recommendationId: recommendation.rows[0].id,
      });
      await client.query("COMMIT");
      return json({ ok: true, recommendationId: recommendation.rows[0].id });
    }

    if (action === "add_task_comment") {
      const taskId = requireText(body.taskId, "Task id");
      const comment = requireText(body.body, "Comment");
      const result = await client.query(
        "INSERT INTO task_comments (task_id, author_id, body) VALUES ($1, $2, $3) RETURNING id",
        [taskId, steve.user.id, comment],
      );
      await client.query("UPDATE tasks SET updated_at = now() WHERE id = $1", [taskId]);
      await audit(
        client,
        "steve_task_comment",
        "task",
        taskId,
        { commentId: result.rows[0].id, requestedBy: auth.user.email },
        steve.user,
      );
      await completeSteveTool(client, toolCallId, { commentId: result.rows[0].id });
      await client.query("COMMIT");
      return json({ ok: true, commentId: result.rows[0].id });
    }

    if (action === "log_escalation") {
      const title = requireText(body.title, "Escalation title");
      const escalationBody = requireText(body.body, "Escalation body");
      const owner = await resolveSteveOwner(
        client,
        `${title} ${escalationBody}`,
        "kiril@stirisk.co.za",
      );
      const board = await ensureTaskBoard(client);
      const backlog = board.stages.find((stage) => stage.name === "Backlog") ?? board.stages[0];
      const task = await client.query(
        `INSERT INTO tasks (
          board_id, stage_id, project_id, deal_id, organization_id, owner_id,
          title, description, priority, due_at, source
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'critical', now() + interval '1 day', 'steve_escalation')
         RETURNING id`,
        [
          board.boardId,
          backlog.id,
          body.projectId ?? null,
          body.dealId ?? null,
          body.organizationId ?? null,
          owner.ownerId,
          title,
          escalationBody,
        ],
      );
      const recommendation = await client.query(
        `INSERT INTO ai_recommendations (
          deal_id, organization_id, project_id, task_id, recommendation_type, title, body, requires_approval, payload
         )
         VALUES ($1, $2, $3, $4, 'escalation', $5, $6, true, $7::jsonb)
         RETURNING id`,
        [
          body.dealId ?? null,
          body.organizationId ?? null,
          body.projectId ?? null,
          task.rows[0].id,
          title,
          escalationBody,
          JSON.stringify({
            requestedBy: auth.user.email,
            notesUrl: optionalText(body.notesUrl),
            callUrl: optionalText(body.callUrl),
            documentUrl: optionalText(body.documentUrl),
          }),
        ],
      );
      await audit(
        client,
        "steve_escalation",
        "task",
        task.rows[0].id,
        {
          recommendationId: recommendation.rows[0].id,
          escalatedTo: owner.ownerEmail,
          requestedBy: auth.user.email,
        },
        steve.user,
      );
      await completeSteveTool(client, toolCallId, {
        taskId: task.rows[0].id,
        recommendationId: recommendation.rows[0].id,
      });
      await client.query("COMMIT");
      return json({
        ok: true,
        taskId: task.rows[0].id,
        recommendationId: recommendation.rows[0].id,
        escalatedTo: owner.ownerEmail,
      });
    }

    await completeSteveTool(client, toolCallId, { error: "Unsupported Steve action" }, "rejected");
    await client.query("ROLLBACK");
    return json({ error: "Unsupported Steve action" }, { status: 404 });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function reportsSummary(request: Request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  const pool = getPool();
  const [pipeline, statuses, sources, months, owners, revenue, opportunities, quotations, serviceDelivery] = await Promise.all([
    pool.query(`
    SELECT s.name, count(d.id)::int AS deals, COALESCE(sum(d.value_cents)::int, 0) AS value_cents
    FROM pipeline_stages s
    LEFT JOIN deals d ON d.stage_id = s.id
    GROUP BY s.id
    HAVING count(d.id) > 0
    ORDER BY s.position
  `),
    pool.query(`
    SELECT status, count(*)::int AS deals, COALESCE(sum(value_cents)::int, 0) AS value_cents
    FROM deals
    GROUP BY status
    ORDER BY deals DESC
  `),
    pool.query(`
    SELECT source, count(*)::int AS deals
    FROM deals
    GROUP BY source
    ORDER BY deals DESC
  `),
    pool.query(`
    SELECT to_char(date_trunc('month', created_at), 'Mon YYYY') AS month,
      count(*)::int AS deals,
      COALESCE(sum(value_cents)::int, 0) AS value_cents
    FROM deals
    GROUP BY date_trunc('month', created_at)
    ORDER BY date_trunc('month', created_at)
  `),
    pool.query(`
    SELECT u.name, count(d.id)::int AS deals, COALESCE(sum(d.value_cents)::int, 0) AS value_cents
    FROM deals d
    LEFT JOIN app_users u ON u.id = d.owner_id
    GROUP BY u.name
    ORDER BY deals DESC
    LIMIT 10
  `),
    pool.query(`
      SELECT
        COALESCE((SELECT sum(total_value_cents)::int FROM quotes WHERE status IN ('sent_to_client', 'accepted')), 0) AS quoted_value_cents,
        COALESCE((SELECT sum(total_cents)::int FROM invoices WHERE status <> 'void'), 0) AS invoiced_value_cents,
        COALESCE((SELECT sum(amount_cents)::int FROM invoice_payments), 0) AS collected_value_cents
    `),
    pool.query(`
      SELECT count(*)::int AS count, COALESCE(sum(value_cents)::int, 0) AS value_cents
      FROM deals
      WHERE status NOT IN ('won', 'lost', 'cancelled')
    `),
    pool.query(`
      SELECT
        count(*) FILTER (WHERE status IN ('sent_to_client', 'accepted', 'rejected'))::int AS issued,
        COALESCE(sum(total_value_cents) FILTER (WHERE status IN ('sent_to_client', 'accepted', 'rejected'))::int, 0) AS issued_value_cents,
        count(*) FILTER (WHERE status = 'accepted')::int AS won,
        count(*) FILTER (WHERE status IN ('accepted', 'rejected'))::int AS decided
      FROM quotes
    `),
    pool.query(`
      SELECT
        count(*) FILTER (WHERE status NOT IN ('complete', 'invoiced', 'cancelled'))::int AS open,
        count(*) FILTER (WHERE status IN ('complete', 'invoiced'))::int AS completed,
        count(*)::int AS total
      FROM work_items
    `),
  ]);

  const quoteMetrics = quotations.rows[0] ?? {};
  const serviceMetrics = serviceDelivery.rows[0] ?? {};

  return json({
    pipeline: pipeline.rows,
    statuses: statuses.rows,
    sources: sources.rows,
    months: months.rows,
    owners: owners.rows,
    kpis: {
      revenue: revenue.rows[0] ?? { quoted_value_cents: 0, invoiced_value_cents: 0, collected_value_cents: 0 },
      opportunities: opportunities.rows[0] ?? { count: 0, value_cents: 0 },
      quotations: {
        ...quoteMetrics,
        win_rate: Number(quoteMetrics.decided ?? 0) > 0
          ? Number(quoteMetrics.won ?? 0) / Number(quoteMetrics.decided)
          : null,
      },
      serviceDelivery: { ...serviceMetrics, csat: null, csatStatus: "not_available_in_schema" },
    },
  });
}

type InspectionFinding = {
  location?: string | null;
  issueDescription: string;
  remediationAction?: string | null;
  quantity?: number | null;
  materials?: string | null;
  confidence?: number | null;
};

type DocumentationCompliance = {
  result: "plausible_match" | "unclear" | "mismatch";
  rationale: string;
  error: string | null;
};

function isDocumentationCategory(category: unknown) {
  return optionalText(category)?.toLowerCase().startsWith("01 documentation") ?? false;
}

async function checkDocumentationPhotoCompliance(
  files: File[],
  itemText: string,
): Promise<DocumentationCompliance> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey)
    return {
      result: "unclear",
      rationale: "AI compliance check unavailable; GEMINI_API_KEY is not configured.",
      error: "GEMINI_API_KEY is not configured",
    };
  const model = process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash";
  const imageParts = [];
  for (const file of files) {
    imageParts.push({
      inline_data: {
        mime_type: file.type || "application/octet-stream",
        data: Buffer.from(await file.arrayBuffer()).toString("base64"),
      },
    });
  }
  const prompt = [
    "Assess whether the supplied photo(s) plausibly show the documentation described by the checklist item.",
    "This is an advisory evidence check only. Do not decide whether the technician's inspection outcome is correct.",
    'Return JSON only in this shape: {"result":"plausible_match"|"unclear"|"mismatch","rationale":"short explanation"}.',
    "Use plausible_match when the image reasonably appears to show the named document, unclear when the image is too poor or ambiguous to tell, and mismatch when it clearly shows something else.",
    `Checklist item: ${itemText}`,
  ].join("\n\n");
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(25_000),
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: "You are a cautious document-evidence reviewer. Never invent readable content that is not visible.",
              },
            ],
          },
          contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 300,
            response_mime_type: "application/json",
          },
        }),
      },
    );
    const body = asRecord(await response.json());
    if (!response.ok)
      return {
        result: "unclear",
        rationale: "AI compliance check could not be completed.",
        error: JSON.stringify(body).slice(0, 500),
      };
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    const content = asRecord(asRecord(candidates[0]).content);
    const text = (Array.isArray(content.parts) ? content.parts : [])
      .map((part) => optionalText(asRecord(part).text))
      .filter(Boolean)
      .join("\n");
    const parsed = extractJsonObject(text);
    const result = optionalText(parsed?.result);
    const rationale = optionalText(parsed?.rationale);
    if (!["plausible_match", "unclear", "mismatch"].includes(result ?? "") || !rationale) {
      return {
        result: "unclear",
        rationale: "AI returned an unusable compliance assessment.",
        error: "Invalid Gemini compliance response",
      };
    }
    return { result: result as DocumentationCompliance["result"], rationale, error: null };
  } catch (error) {
    return {
      result: "unclear",
      rationale: "AI compliance check could not be completed.",
      error: error instanceof Error ? error.message : "Gemini request failed",
    };
  }
}

async function structureInspectionComment(comment: string, context: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey)
    return { findings: [] as InspectionFinding[], error: "GEMINI_API_KEY is not configured" };
  const model = process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash";
  const prompt = [
    "Extract discrete fire-system fault/remediation findings from the technician comment below.",
    'Return JSON only in this shape: {"findings":[{"location":string|null,"issueDescription":string,"remediationAction":string|null,"quantity":number|null,"materials":string|null,"confidence":number|null}]}',
    "Do not invent facts. Keep quantities/materials null when not stated. If there is no concrete fault or remediation, return an empty findings array.",
    `Checklist item context: ${context}`,
    `Technician comment: ${comment}`,
  ].join("\n\n");
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: "You are a careful technical inspection data-structuring assistant. The source technician comment remains authoritative.",
              },
            ],
          },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 800,
            response_mime_type: "application/json",
          },
        }),
      },
    );
    const body = asRecord(await response.json());
    if (!response.ok)
      return { findings: [] as InspectionFinding[], error: JSON.stringify(body).slice(0, 500) };
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    const content = asRecord(asRecord(candidates[0]).content);
    const text = (Array.isArray(content.parts) ? content.parts : [])
      .map((part) => optionalText(asRecord(part).text))
      .filter(Boolean)
      .join("\n");
    const parsed = extractJsonObject(text);
    const findings = Array.isArray(parsed?.findings)
      ? parsed.findings.map((raw) => {
          const finding = asRecord(raw);
          return {
            location: optionalText(finding.location),
            issueDescription:
              optionalText(finding.issueDescription ?? finding.issue_description) ??
              "Unspecified issue",
            remediationAction: optionalText(
              finding.remediationAction ?? finding.remediation_action,
            ),
            quantity: optionalNumber(finding.quantity),
            materials: optionalText(finding.materials),
            confidence: optionalNumber(finding.confidence),
          };
        })
      : [];
    return {
      findings,
      error: findings.length || parsed ? null : "Gemini returned no structured findings",
    };
  } catch (error) {
    return {
      findings: [] as InspectionFinding[],
      error: error instanceof Error ? error.message : "Gemini request failed",
    };
  }
}

function reportRiskRank(level: string) {
  return ({ low: 1, medium: 2, high: 3, critical: 4 } as Record<string, number>)[level] ?? 1;
}

function worstReportRisk(levels: string[]) {
  return levels.reduce(
    (worst, level) => (reportRiskRank(level) > reportRiskRank(worst) ? level : worst),
    "low",
  );
}

async function buildInspectionReportPayload(
  client: pg.Pool | pg.PoolClient,
  inspectionIds: string[],
  runAi: boolean,
) {
  const inspections = await client.query(
    `SELECT i.id, i.organization_id, i.site_id, i.work_item_id, i.asset_id, i.area_id,
      i.started_at, i.completed_at, i.risk_level, i.computed_risk_level, i.outcome, i.status,
      i.checklist_template_id, i.checklist_template_version, ct.name AS template_name,
      ct.category AS template_category, a.name AS asset_name, a.asset_tag, a.asset_type,
      a.manufacturer, a.model, s.name AS site_name, o.name AS organization_name,
      ar.name AS area_name, u.name AS technician_name,
      isig.signer_name, isig.signature_data, isig.signed_at
     FROM inspections i
     JOIN checklist_templates ct ON ct.id = i.checklist_template_id
     LEFT JOIN assets a ON a.id = i.asset_id
     LEFT JOIN sites s ON s.id = i.site_id
     LEFT JOIN organizations o ON o.id = i.organization_id
     LEFT JOIN areas ar ON ar.id = i.area_id
     LEFT JOIN app_users u ON u.id = i.technician_user_id
     LEFT JOIN inspection_signatures isig ON isig.id = i.signature_id
     WHERE i.id = ANY($1::uuid[]) AND i.status = 'completed'
     ORDER BY i.started_at, ct.category, ct.name`,
    [inspectionIds],
  );
  if (!inspections.rows.length)
    throw Object.assign(new Error("No completed inspections found"), { status: 409 });
  const blocks = [];
  for (const inspection of inspections.rows) {
    const itemRows = await client.query(
      `SELECT cti.id, cti.position, cti.item_text, cti.sans_clause, cti.response_type,
        cti.required, cti.photo_required, cti.risk_weight,
        iir.id AS response_id, iir.outcome, iir.comment, iir.na_reason, iir.numeric_value,
        iir.ai_processed, iir.ai_processing_error, iir.ai_compliance_result,
        iir.ai_compliance_rationale, iir.ai_compliance_checked_at
       FROM checklist_template_items cti
       LEFT JOIN inspection_item_responses iir
         ON iir.checklist_template_item_id = cti.id AND iir.inspection_id = $1
       WHERE cti.template_id = $2 ORDER BY cti.position`,
      [inspection.id, inspection.checklist_template_id],
    );
    const items = [];
    for (const item of itemRows.rows) {
      if (
        runAi &&
        item.response_id &&
        item.response_type === "freeform" &&
        item.comment &&
        String(item.comment).trim().length >= 20 &&
        !item.ai_processed
      ) {
        const ai = await structureInspectionComment(
          String(item.comment),
          `${item.item_text}${item.sans_clause ? `; SANS clause ${item.sans_clause}` : ""}`,
        );
        await client.query(
          "DELETE FROM inspection_response_findings WHERE inspection_item_response_id = $1",
          [item.response_id],
        );
        for (const finding of ai.findings) {
          await client.query(
            `INSERT INTO inspection_response_findings (
              inspection_item_response_id, location, issue_description, remediation_action,
              quantity, materials, ai_model, ai_confidence, raw_payload
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
            [
              item.response_id,
              finding.location,
              finding.issueDescription,
              finding.remediationAction,
              finding.quantity,
              finding.materials,
              process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash",
              finding.confidence,
              JSON.stringify(finding),
            ],
          );
        }
        await client.query(
          "UPDATE inspection_item_responses SET ai_processed = true, ai_processed_at = now(), ai_processing_error = $2 WHERE id = $1",
          [item.response_id, ai.error],
        );
        item.ai_processed = true;
        item.ai_processing_error = ai.error;
      }
      const [findings, evidence] = await Promise.all([
        item.response_id
          ? client.query(
              "SELECT id, location, issue_description, remediation_action, quantity, materials, ai_confidence FROM inspection_response_findings WHERE inspection_item_response_id = $1 ORDER BY created_at",
              [item.response_id],
            )
          : { rows: [] },
        item.response_id
          ? client.query(
              "SELECT id, file_name, mime_type, inspection_item_response_id, capture_timestamp, gps_lat, gps_lng, location_text, file_path FROM evidence_files WHERE inspection_item_response_id = $1 ORDER BY created_at",
              [item.response_id],
            )
          : { rows: [] },
      ]);
      items.push({
        id: item.id,
        position: item.position,
        itemText: item.item_text,
        sansClause: item.sans_clause,
        responseType: item.response_type,
        required: item.required,
        photoRequired: item.photo_required,
        outcome: item.outcome,
        comment: item.comment,
        naReason: item.na_reason,
        numericValue: item.numeric_value,
        aiProcessed: item.ai_processed,
        aiProcessingError: item.ai_processing_error,
        aiComplianceResult: item.ai_compliance_result,
        aiComplianceRationale: item.ai_compliance_rationale,
        aiComplianceCheckedAt: item.ai_compliance_checked_at,
        findings: findings.rows,
        evidence: evidence.rows,
      });
    }
    blocks.push({
      inspectionId: inspection.id,
      templateId: inspection.checklist_template_id,
      templateVersion: inspection.checklist_template_version,
      name: inspection.template_name,
      category: inspection.template_category,
      asset: {
        id: inspection.asset_id,
        name: inspection.asset_name,
        tag: inspection.asset_tag,
        type: inspection.asset_type,
        manufacturer: inspection.manufacturer,
        model: inspection.model,
      },
      area: inspection.area_name,
      technicianName: inspection.technician_name,
      startedAt: inspection.started_at,
      completedAt: inspection.completed_at,
      riskLevel: inspection.risk_level,
      computedRiskLevel: inspection.computed_risk_level,
      outcome: inspection.outcome,
      signature: inspection.signer_name
        ? {
            signerName: inspection.signer_name,
            signatureData: inspection.signature_data,
            signedAt: inspection.signed_at,
          }
        : null,
      items,
    });
  }
  const first = inspections.rows[0];
  const overallOutcome = blocks.some((block) => block.outcome === "fail") ? "fail" : "pass";
  return {
    generatedAt: new Date().toISOString(),
    organization: { id: first.organization_id, name: first.organization_name },
    site: { id: first.site_id, name: first.site_name },
    workItemId: first.work_item_id,
    overallOutcome,
    overallRiskLevel: worstReportRisk(blocks.map((block) => block.riskLevel)),
    inspectionCount: blocks.length,
    blocks,
  };
}

async function inspectionReports(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  if (request.method === "GET") {
    const rows = await getPool().query(
      `SELECT sr.id, sr.title, sr.status, sr.report_type, sr.created_at, sr.updated_at,
        sr.report_payload->>'overallOutcome' AS overall_outcome,
        sr.report_payload->>'overallRiskLevel' AS overall_risk_level,
        o.name AS organization_name, s.name AS site_name
       FROM service_reports sr
       LEFT JOIN organizations o ON o.id = sr.organization_id
       LEFT JOIN sites s ON s.id = sr.site_id
       WHERE sr.report_type = 'site_survey'
       ORDER BY sr.updated_at DESC LIMIT 200`,
    );
    return json({ reports: rows.rows });
  }
  const body = asRecord(await readJson(request));
  const rawIds = Array.isArray(body.inspectionIds) ? body.inspectionIds : [];
  const inspectionIds = rawIds
    .map((id) => optionalText(id))
    .filter((id): id is string => Boolean(id));
  if (!inspectionIds.length && optionalText(body.assetId)) {
    const selected = await getPool().query(
      "SELECT id FROM inspections WHERE asset_id = $1 AND status = 'completed' ORDER BY started_at",
      [optionalText(body.assetId)],
    );
    inspectionIds.push(...selected.rows.map((row) => row.id as string));
  }
  if (!inspectionIds.length)
    return json({ error: "Select at least one completed inspection" }, { status: 400 });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const payload = await buildInspectionReportPayload(client, inspectionIds, true);
    const title = optionalText(body.title) ?? `${payload.site.name ?? "Site"} survey report`;
    const inserted = await client.query(
      `INSERT INTO service_reports (
        organization_id, site_id, work_item_id, report_type, status, title, summary, report_payload, created_by
      ) VALUES ($1, $2, $3, 'site_survey', 'draft', $4, $5, $6::jsonb, $7)
      RETURNING id, status, created_at`,
      [
        payload.organization.id,
        payload.site.id,
        payload.workItemId,
        title,
        `${payload.inspectionCount} inspection block(s) · ${payload.overallOutcome} · ${payload.overallRiskLevel} risk`,
        JSON.stringify(payload),
        auth.user.id,
      ],
    );
    await client.query(
      "UPDATE inspections SET service_report_id = $2, updated_at = now() WHERE id = ANY($1::uuid[])",
      [inspectionIds, inserted.rows[0].id],
    );
    await audit(
      client,
      "generate_site_survey_report",
      "service_report",
      inserted.rows[0].id,
      { inspectionIds, ai: "gemini" },
      auth.user,
    );
    await client.query("COMMIT");
    return json({ ok: true, report: { ...inserted.rows[0], ...payload } }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function consultingStages(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  if (request.method === "GET") {
    const visitId = new URL(request.url).searchParams.get("siteVisitId");
    const result = await getPool().query(
      `SELECT css.*, sr.title AS report_title, sr.status AS report_status,
        o.name AS organization_name, s.name AS site_name
       FROM consulting_solutioning_stages css
       JOIN site_visits sv ON sv.id = css.site_visit_id
       LEFT JOIN service_reports sr ON sr.id = css.service_report_id
       LEFT JOIN organizations o ON o.id = sv.organization_id
       LEFT JOIN sites s ON s.id = sv.site_id
       WHERE ($1::uuid IS NULL OR css.site_visit_id = $1::uuid)
       ORDER BY css.created_at DESC`,
      [visitId],
    );
    return json({ stages: result.rows });
  }

  const body = asRecord(await readJson(request));
  const siteVisitId = requireText(body.siteVisitId, "Site visit");
  const stageType = requireOneOf(body.stageType, "Stage type", [
    "consulting",
    "solutioning",
  ] as const);
  const tier = requireOneOf(body.tier, "Tier", ["level_1", "level_2", "level_3"] as const);
  const visit = await getPool().query(
    "SELECT container_id, project_id FROM site_visits WHERE id = $1",
    [siteVisitId],
  );
  if (!visit.rows[0]) return json({ error: "Site visit not found" }, { status: 404 });
  const projectId = optionalText(body.projectId) ?? visit.rows[0].project_id;
  const result = await getPool().query(
    `INSERT INTO consulting_solutioning_stages
      (site_visit_id, project_id, container_id, stage_type, tier, status, price_cents, currency, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'draft'), $7, COALESCE($8, 'ZAR'), $9, $10)
     RETURNING *`,
    [
      siteVisitId,
      projectId,
      visit.rows[0].container_id,
      stageType,
      tier,
      optionalText(body.status),
      optionalNumber(body.priceCents),
      optionalText(body.currency),
      optionalText(body.notes),
      auth.user.id,
    ],
  );
  await audit(
    getPool(),
    "create_consulting_solutioning_stage",
    "consulting_solutioning_stage",
    result.rows[0].id,
    {},
    auth.user,
  );
  return json({ ok: true, stage: result.rows[0] }, { status: 201 });
}

async function consultingStageDetail(request: Request, stageId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  if (request.method === "GET") {
    const result = await getPool().query(
      "SELECT * FROM consulting_solutioning_stages WHERE id = $1",
      [stageId],
    );
    if (!result.rows[0]) return json({ error: "Consulting stage not found" }, { status: 404 });
    return json({ stage: result.rows[0] });
  }
  const body = asRecord(await readJson(request));
  const status =
    body.status === undefined
      ? null
      : requireOneOf(body.status, "Status", [
          "draft",
          "in_progress",
          "delivered",
          "pending_charge",
          "charged",
          "waived",
          "cancelled",
        ] as const);
  const result = await getPool().query(
    `UPDATE consulting_solutioning_stages
     SET project_id = COALESCE($2, project_id), status = COALESCE($3, status),
       service_report_id = COALESCE($4, service_report_id), quote_id = COALESCE($5, quote_id),
       invoice_id = COALESCE($6, invoice_id), price_cents = COALESCE($7, price_cents),
       notes = COALESCE($8, notes), delivered_at = CASE WHEN $3 IN ('delivered','pending_charge','charged','waived') THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
       charged_at = CASE WHEN $3 = 'charged' THEN COALESCE(charged_at, now()) ELSE charged_at END,
       waived_at = CASE WHEN $3 = 'waived' THEN COALESCE(waived_at, now()) ELSE waived_at END,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      stageId,
      optionalText(body.projectId),
      status,
      optionalText(body.serviceReportId),
      optionalText(body.quoteId),
      optionalText(body.invoiceId),
      optionalNumber(body.priceCents),
      optionalText(body.notes),
    ],
  );
  if (!result.rows[0]) return json({ error: "Consulting stage not found" }, { status: 404 });
  await audit(
    getPool(),
    "update_consulting_solutioning_stage",
    "consulting_solutioning_stage",
    stageId,
    { status },
    auth.user,
  );
  return json({ ok: true, stage: result.rows[0] });
}

async function buildConsultingReport(
  client: pg.Pool | pg.PoolClient,
  stageId: string,
  userId: string,
) {
  const stageResult = await client.query(
    `SELECT css.*, sv.organization_id, sv.site_id, sv.work_item_id, sv.building_id, sv.floor_id, sv.area_id,
      sv.capture_mode, sv.status AS visit_status, sv.notes AS visit_notes, sv.metadata AS visit_metadata,
      sv.started_at, sv.submitted_at, sv.reviewed_at, o.name AS organization_name, s.name AS site_name,
      c.name AS container_name, p.name AS project_name
     FROM consulting_solutioning_stages css
     JOIN site_visits sv ON sv.id = css.site_visit_id
     LEFT JOIN organizations o ON o.id = sv.organization_id
     LEFT JOIN sites s ON s.id = sv.site_id
     LEFT JOIN containers c ON c.id = css.container_id
     LEFT JOIN projects p ON p.id = css.project_id
     WHERE css.id = $1`,
    [stageId],
  );
  const stage = stageResult.rows[0];
  if (!stage) throw Object.assign(new Error("Consulting stage not found"), { status: 404 });
  const [area, measurements, assets, evidence, workItem, findings] = await Promise.all([
    stage.area_id
      ? client.query(
          `SELECT a.*, t.standard_code, t.standard_name FROM areas a LEFT JOIN taxonomies t ON t.id = a.taxonomy_id WHERE a.id = $1`,
          [stage.area_id],
        )
      : { rows: [] },
    client.query(`SELECT * FROM area_measurements WHERE site_visit_id = $1 ORDER BY created_at`, [
      stage.site_visit_id,
    ]),
    client.query(
      `SELECT a.*, t.standard_code AS technology_code, t.standard_name AS technology_name FROM assets a LEFT JOIN taxonomies t ON t.id = a.taxonomy_id WHERE a.site_id = $1 AND ($2::uuid IS NULL OR a.area_id = $2::uuid) ORDER BY a.name`,
      [stage.site_id, stage.area_id],
    ),
    client.query(
      `SELECT id, file_name, mime_type, evidence_type, notes, area_id, area_measurement_id,
        audio_duration, recording_format, location_text, capture_timestamp, capture_phase, created_at
       FROM evidence_files WHERE site_visit_id = $1 ORDER BY created_at`,
      [stage.site_visit_id],
    ),
    stage.work_item_id
      ? client.query(
          `SELECT id, title, status, scope, work_type, priority, due_at, completed_at
           FROM work_items WHERE id = $1`,
          [stage.work_item_id],
        )
      : { rows: [] },
    client.query(
      `SELECT f.id, f.location, f.issue_description, f.remediation_action, f.quantity,
        f.materials, f.ai_confidence, f.raw_payload, i.id AS inspection_id,
        i.work_item_id, i.outcome, i.risk_level, cti.item_text
       FROM inspection_response_findings f
       JOIN inspection_item_responses iir ON iir.id = f.inspection_item_response_id
       JOIN inspections i ON i.id = iir.inspection_id
       JOIN checklist_template_items cti ON cti.id = iir.checklist_template_item_id
       WHERE i.site_id = $1
         AND ($2::uuid IS NULL OR i.work_item_id = $2::uuid)
         AND i.status = 'completed'
       ORDER BY f.created_at`,
      [stage.site_id, stage.work_item_id],
    ),
  ]);
  const evidenceByPhase = {
    before: evidence.rows.filter((entry) => entry.capture_phase === "before"),
    during: evidence.rows.filter((entry) => entry.capture_phase === "during"),
    after: evidence.rows.filter((entry) => entry.capture_phase === "after"),
    unclassified: evidence.rows.filter(
      (entry) => !["before", "during", "after"].includes(entry.capture_phase),
    ),
  };
  const structuredFindings = findings.rows.map((finding) => {
    const rawPayload = asRecord(finding.raw_payload);
    return {
      id: finding.id,
      inspectionId: finding.inspection_id,
      itemText: finding.item_text,
      noteType: optionalText(rawPayload.noteType) ?? "Fault Found",
      location: finding.location,
      issueDescription: finding.issue_description,
      remediationAction: finding.remediation_action,
      quantity: finding.quantity,
      materials: finding.materials,
      aiConfidence: finding.ai_confidence,
      outcome: finding.outcome,
      riskLevel: finding.risk_level,
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    organization: { id: stage.organization_id, name: stage.organization_name },
    site: { id: stage.site_id, name: stage.site_name },
    container: { id: stage.container_id, name: stage.container_name },
    project: stage.project_id ? { id: stage.project_id, name: stage.project_name } : null,
    workItem: workItem.rows[0] ?? null,
    stage: {
      id: stage.id,
      stageType: stage.stage_type,
      tier: stage.tier,
      status: stage.status,
      priceCents: stage.price_cents,
      currency: stage.currency,
    },
    siteVisit: {
      id: stage.site_visit_id,
      captureMode: stage.capture_mode,
      status: stage.visit_status,
      notes: stage.visit_notes,
      metadata: stage.visit_metadata,
      startedAt: stage.started_at,
      submittedAt: stage.submitted_at,
      reviewedAt: stage.reviewed_at,
    },
    area: area.rows[0] ?? null,
    measurements: measurements.rows,
    assets: assets.rows,
    evidence: evidence.rows,
    evidenceByPhase,
    structuredFindings,
    reportType: "consulting",
    assembly: {
      evidencePhases: ["before", "during", "after"],
      findings: "structured",
      pricingVisibility: "coordinator_only",
    },
    preparedBy: userId,
  };
}

async function consultingStageReport(request: Request, stageId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const payload = await buildConsultingReport(client, stageId, auth.user.id);
    const inserted = await client.query(
      `INSERT INTO service_reports (organization_id, site_id, project_id, report_type, status, title, summary, report_payload, created_by, site_visit_id)
       VALUES ($1, $2, $3, 'consulting', 'draft', $4, $5, $6::jsonb, $7, $8) RETURNING id, status, created_at`,
      [
        payload.organization.id,
        payload.site.id,
        payload.project?.id ?? null,
        `${payload.site.name ?? "Site"} ${payload.stage.stageType} report`,
        `${payload.stage.tier} · ${payload.siteVisit.status}`,
        JSON.stringify(payload),
        auth.user.id,
        payload.siteVisit.id,
      ],
    );
    await refreshServiceReportEmbedding(client, inserted.rows[0].id, payload);
    await client.query(
      "UPDATE consulting_solutioning_stages SET service_report_id = $2, updated_at = now() WHERE id = $1",
      [stageId, inserted.rows[0].id],
    );
    await audit(
      client,
      "generate_consulting_report",
      "service_report",
      inserted.rows[0].id,
      { stageId },
      auth.user,
    );
    await client.query("COMMIT");
    return json(
      {
        ok: true,
        report: {
          id: inserted.rows[0].id,
          reportType: "consulting",
          ...inserted.rows[0],
          ...payload,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function consultingReportDetail(request: Request, reportId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const result = await getPool().query(
    "SELECT id, title, report_type, status, summary, report_payload, created_at, updated_at FROM service_reports WHERE id = $1 AND report_type = 'consulting'",
    [reportId],
  );
  if (!result.rows[0]) return json({ error: "Consulting report not found" }, { status: 404 });
  return json({
    report: {
      id: result.rows[0].id,
      title: result.rows[0].title,
      reportType: result.rows[0].report_type,
      status: result.rows[0].status,
      summary: result.rows[0].summary,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
      ...asRecord(result.rows[0].report_payload),
    },
  });
}

async function inspectionReportDetail(request: Request, reportId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const result = await getPool().query(
    `SELECT id, title, report_type, status, summary, report_payload, organization_id, site_id,
      work_item_id, created_by, created_at, updated_at
     FROM service_reports WHERE id = $1 AND report_type = 'site_survey'`,
    [reportId],
  );
  const row = result.rows[0];
  if (!row) return json({ error: "Survey report not found" }, { status: 404 });
  return json({
    report: {
      id: row.id,
      title: row.title,
      reportType: row.report_type,
      status: row.status,
      summary: row.summary,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...asRecord(row.report_payload),
    },
  });
}

async function inspectionEvidenceFile(request: Request, evidenceId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const result = await getPool().query(
    "SELECT file_path, mime_type FROM evidence_files WHERE id = $1",
    [evidenceId],
  );
  const row = result.rows[0];
  if (!row?.file_path) return json({ error: "Evidence file not found" }, { status: 404 });
  try {
    const buffer = await readFile(row.file_path as string);
    return new Response(buffer, {
      headers: {
        "content-type": row.mime_type || "application/octet-stream",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch {
    return json({ error: "Evidence file is unavailable" }, { status: 404 });
  }
}

async function schedule(request: Request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  const rows = await getPool().query(`
    SELECT t.id, t.title, t.priority, t.status, t.due_at,
      u.name AS owner_name, o.name AS organization_name, p.name AS project_name, d.title AS deal_title
    FROM tasks t
    LEFT JOIN app_users u ON u.id = t.owner_id
    LEFT JOIN organizations o ON o.id = t.organization_id
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN deals d ON d.id = t.deal_id
    WHERE t.status IN ('open', 'blocked') AND t.due_at IS NOT NULL
    ORDER BY
      CASE
        WHEN t.due_at::date = CURRENT_DATE THEN 0
        WHEN t.due_at > now() THEN 1
        ELSE 2
      END,
      CASE WHEN t.due_at < now() THEN t.due_at END DESC,
      t.due_at ASC
    LIMIT 100
  `);

  return json({ tasks: rows.rows });
}

async function settingsSummary(request: Request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  const pipelineStages = await getPool().query(`
    SELECT s.id, s.name, s.position, s.is_terminal, count(d.id)::int AS deals
    FROM pipeline_stages s
    LEFT JOIN deals d ON d.stage_id = s.id
    GROUP BY s.id
    ORDER BY s.position
  `);

  const taskStages = await getPool().query(`
    SELECT ts.id, ts.name, ts.position, ts.is_terminal, tb.name AS board_name, count(t.id)::int AS tasks
    FROM task_stages ts
    JOIN task_boards tb ON tb.id = ts.board_id
    LEFT JOIN tasks t ON t.stage_id = ts.id
    GROUP BY ts.id, tb.name, tb.created_at
    ORDER BY tb.created_at, ts.position
  `);

  const imports = await getPool().query(`
    SELECT id, source, leads_file, deals_file, leads_imported, deals_imported,
      organizations_imported, contacts_imported, created_at
    FROM pipedrive_import_batches
    ORDER BY created_at DESC
    LIMIT 5
  `);

  const users = await getPool().query(`
    SELECT id, name, email, role, auth_provider, created_at
    FROM app_users
    ORDER BY created_at
  `);

  return json({
    pipelineStages: pipelineStages.rows,
    taskStages: taskStages.rows,
    imports: imports.rows,
    users: users.rows,
  });
}

async function fetchMessengerStatus() {
  const url = process.env.MESSENGER_STATUS_URL || "http://messenger:3010/readyz";
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    const body = await response.json().catch(() => ({}));
    return {
      reachable: true,
      httpStatus: response.status,
      ...asRecord(body),
    };
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : "Messenger status unavailable",
    };
  }
}

async function whatsappOperations(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  const [messenger, summary, outbox] = await Promise.all([
    fetchMessengerStatus(),
    getPool().query(`
      SELECT
        count(*) FILTER (WHERE status = 'pending')::int AS pending,
        count(*) FILTER (WHERE status = 'claimed')::int AS claimed,
        count(*) FILTER (WHERE status = 'retryable_failed')::int AS retryable_failed,
        count(*) FILTER (WHERE status = 'failed')::int AS failed,
        min(next_attempt_at) FILTER (WHERE status IN ('pending', 'retryable_failed', 'failed')) AS next_outbox_attempt_at
      FROM whatsapp_outbox
      WHERE status IN ('pending', 'claimed', 'retryable_failed', 'failed')
    `),
    getPool().query(`
      SELECT id, recipient, left(message_body, 220) AS message_body, status, attempt_count,
        provider_message_id, error, metadata, created_at, updated_at, next_attempt_at, sent_at
      FROM whatsapp_outbox
      WHERE status IN ('pending', 'claimed', 'retryable_failed', 'failed')
      ORDER BY
        CASE status
          WHEN 'failed' THEN 0
          WHEN 'retryable_failed' THEN 1
          WHEN 'pending' THEN 2
          ELSE 3
        END,
        updated_at DESC
      LIMIT 20
    `),
  ]);

  const nextRetryAt =
    optionalText(messenger.nextRetryAt) ??
    (summary.rows[0]?.next_outbox_attempt_at
      ? new Date(summary.rows[0].next_outbox_attempt_at).toISOString()
      : null);
  const deliveryStatus = optionalText(messenger.deliveryStatus) ?? "unknown";
  const canSend = Boolean(messenger.reachable) && deliveryStatus === "connected";
  const warning =
    deliveryStatus === "restricted"
      ? "WhatsApp outbound restricted. Inbound still active."
      : deliveryStatus === "qr_required"
        ? "WhatsApp session needs QR relinking."
        : deliveryStatus === "degraded"
          ? "WhatsApp Messenger is degraded. Check transport logs."
          : !messenger.reachable
            ? "WhatsApp Messenger status is unreachable."
            : null;

  return json({
    messenger,
    canSend,
    warning,
    nextRetryAt,
    counts: summary.rows[0] ?? {},
    outbox: outbox.rows,
  });
}

async function whatsappOutboxRetry(request: Request, outboxId: string) {
  const auth = await requireUser(request, ["admin"]);
  if (auth.response) return auth.response;

  const body = await readJson(request);
  const force = body.force === true;
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT id, status, next_attempt_at, error, metadata
       FROM whatsapp_outbox
       WHERE id = $1
       FOR UPDATE`,
      [outboxId],
    );
    const row = current.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return json({ error: "Outbox message not found" }, { status: 404 });
    }
    if (!["failed", "retryable_failed"].includes(row.status)) {
      await client.query("ROLLBACK");
      return json({ error: "Only failed WhatsApp messages can be retried" }, { status: 409 });
    }

    const nextAttemptAt = row.next_attempt_at ? new Date(row.next_attempt_at) : null;
    if (!force && nextAttemptAt && nextAttemptAt.getTime() > Date.now()) {
      await client.query("ROLLBACK");
      return json(
        {
          error: "Retry is not available yet",
          nextRetryAt: nextAttemptAt.toISOString(),
        },
        { status: 409 },
      );
    }

    const metadata = {
      manualRetry: {
        requestedBy: auth.user.id,
        requestedAt: new Date().toISOString(),
        previousStatus: row.status,
        previousError: row.error ?? null,
        forced: force,
      },
    };
    const updated = await client.query(
      `UPDATE whatsapp_outbox
       SET status = 'pending',
           claimed_by = NULL,
           lease_until = NULL,
           error = NULL,
           next_attempt_at = now(),
           metadata = metadata || $2::jsonb,
           updated_at = now()
       WHERE id = $1
       RETURNING id, status, next_attempt_at, updated_at`,
      [outboxId, JSON.stringify(metadata)],
    );
    await audit(
      client,
      force ? "whatsapp_outbound_retry_forced" : "whatsapp_outbound_retry_requested",
      "whatsapp_outbox",
      outboxId,
      metadata,
      auth.user,
    );
    await client.query("COMMIT");
    return json({ ok: true, outbox: updated.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function whatsappApprovedUsers(request: Request) {
  const auth = await requireUser(request, ["admin"]);
  if (auth.response) return auth.response;

  if (request.method === "POST") {
    const body = await readJson(request);
    const digits = phoneDigits(body.phoneE164 ?? body.phone);
    const phoneE164 = phoneE164FromDigits(digits);
    if (!phoneE164) return json({ error: "Phone number is required" }, { status: 400 });
    const userId = requireText(body.userId, "User id");
    const user = await getPool().query(
      "SELECT id, role FROM app_users WHERE id = $1 AND role IN ('admin', 'staff', 'agent')",
      [userId],
    );
    if (!user.rows[0]) return json({ error: "Staff user not found" }, { status: 404 });
    const fallbackTier = whatsAppTierForRole(user.rows[0].role as User["role"]);
    const tier = body.permissionTier
      ? requireOneOf(body.permissionTier, "Permission tier", ["agent", "staff", "admin"] as const)
      : fallbackTier;
    const actions = normalizeAllowedActions(body.allowedActions, tier);
    const result = await getPool().query(
      `INSERT INTO whatsapp_approved_users (
        phone_e164, user_id, status, permission_tier, allowed_actions, created_by, metadata
       )
       VALUES ($1, $2, COALESCE($3, 'active'), $4, $5::jsonb, $6, $7::jsonb)
       ON CONFLICT (phone_e164) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         status = EXCLUDED.status,
         permission_tier = EXCLUDED.permission_tier,
         allowed_actions = EXCLUDED.allowed_actions,
         metadata = whatsapp_approved_users.metadata || EXCLUDED.metadata,
         updated_at = now()
       RETURNING id, phone_e164, user_id, status, permission_tier, allowed_actions, created_at, updated_at`,
      [
        phoneE164,
        userId,
        optionalText(body.status),
        tier,
        JSON.stringify(actions),
        auth.user.id,
        JSON.stringify(asRecord(body.metadata)),
      ],
    );
    await audit(
      getPool(),
      "upsert_whatsapp_approved_user",
      "app_user",
      userId,
      { approvalId: result.rows[0].id, phoneE164, permissionTier: tier },
      auth.user,
    );
    return json({ approval: result.rows[0] }, { status: 201 });
  }

  const rows = await getPool().query(`
    SELECT
      wau.id,
      wau.phone_e164,
      wau.status,
      wau.permission_tier,
      wau.allowed_actions,
      wau.metadata,
      wau.created_at,
      wau.updated_at,
      u.id AS user_id,
      u.name,
      u.email,
      u.role
    FROM whatsapp_approved_users wau
    JOIN app_users u ON u.id = wau.user_id
    ORDER BY wau.updated_at DESC, wau.created_at DESC
  `);
  return json({ approvals: rows.rows });
}

async function whatsappApprovedUserDetail(request: Request, approvalId: string) {
  const auth = await requireUser(request, ["admin"]);
  if (auth.response) return auth.response;

  if (request.method === "PATCH") {
    const body = await readJson(request);
    const status = body.status
      ? requireOneOf(body.status, "Status", ["active", "revoked"] as const)
      : null;
    const tier = body.permissionTier
      ? requireOneOf(body.permissionTier, "Permission tier", ["agent", "staff", "admin"] as const)
      : null;
    const existing = await getPool().query(
      "SELECT permission_tier FROM whatsapp_approved_users WHERE id = $1",
      [approvalId],
    );
    if (!existing.rows[0]) return json({ error: "Approval not found" }, { status: 404 });
    const effectiveTier =
      tier ?? (existing.rows[0].permission_tier as WhatsAppPermissionTier | undefined) ?? "staff";
    const actions = body.allowedActions
      ? normalizeAllowedActions(body.allowedActions, effectiveTier)
      : null;
    const result = await getPool().query(
      `UPDATE whatsapp_approved_users
       SET status = COALESCE($2, status),
           permission_tier = COALESCE($3, permission_tier),
           allowed_actions = COALESCE($4::jsonb, allowed_actions),
           metadata = metadata || $5::jsonb,
           updated_at = now()
       WHERE id = $1
       RETURNING id, phone_e164, user_id, status, permission_tier, allowed_actions, created_at, updated_at`,
      [
        approvalId,
        status,
        tier,
        actions ? JSON.stringify(actions) : null,
        JSON.stringify(asRecord(body.metadata)),
      ],
    );
    await audit(
      getPool(),
      "update_whatsapp_approved_user",
      "app_user",
      result.rows[0].user_id,
      { approvalId, status, permissionTier: tier },
      auth.user,
    );
    return json({ approval: result.rows[0] });
  }

  return json({ error: "Not found" }, { status: 404 });
}

async function semanticSearch(request: Request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  const body = await readJson(request);
  const q = requireText(body.query, "Query");
  const result = await getPool().query(
    `SELECT entity_type, entity_id, content, metadata
     FROM embedding_documents
     WHERE search_vector @@ plainto_tsquery('english', $1)
     ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC
     LIMIT 12`,
    [q],
  );
  return json({ ok: true, results: result.rows });
}

function getWhatsAppWebhookSecret() {
  return process.env.WHATSAPP_WEBHOOK_SECRET;
}

function getMessengerApiToken() {
  return process.env.MESSENGER_API_TOKEN || "";
}

function verifyMessengerRequest(request: Request) {
  const expected = getMessengerApiToken();
  const header = request.headers.get("authorization") ?? "";
  const actual = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return Boolean(expected && actual && constantTimeEqual(actual, expected));
}

function sourceInstanceId(source: string) {
  return source.includes(":") ? source.split(":").slice(1).join(":") : source;
}

function normalizeWhatsAppJid(value: string | null) {
  const jid = value?.trim().toLowerCase();
  return jid && jid.includes("@") ? jid : null;
}

function phoneDigitsFromJid(jid: string | null) {
  if (!jid) return null;
  const normalized = normalizeWhatsAppJid(jid);
  if (normalized && !normalized.endsWith("@s.whatsapp.net")) return null;
  const localPart = jid.split("@")[0] ?? "";
  const digits = localPart.replace(/\D/g, "");
  return digits || null;
}

function phoneDigits(value: unknown) {
  if (typeof value !== "string") return null;
  if (value.includes("@")) return phoneDigitsFromJid(value);
  return value.replace(/\D/g, "") || null;
}

function phoneE164FromDigits(digits: string | null) {
  if (!digits) return null;
  if (digits.startsWith("0")) return `+27${digits.slice(1)}`;
  return `+${digits}`;
}

function whatsAppPhoneFromPayload(body: Record<string, unknown>) {
  return (
    phoneDigits(body.phone) ??
    phoneDigits(body.from) ??
    phoneDigits(body.chatId) ??
    phoneDigitsFromJid(optionalText(body.from) ?? optionalText(body.chatId))
  );
}

function whatsAppJidsFromPayload(body: Record<string, unknown>) {
  return [
    optionalText(body.from),
    optionalText(body.chatId),
    optionalText(body.sender),
    optionalText(body.phone),
  ]
    .map(normalizeWhatsAppJid)
    .filter((jid): jid is string => Boolean(jid));
}

const defaultWhatsAppActions: Record<WhatsAppPermissionTier, string[]> = {
  agent: ["create_recommendation", "queue_whatsapp_response"],
  staff: [
    "create_recommendation",
    "create_task",
    "add_task_comment",
    "log_communication",
    "queue_whatsapp_response",
  ],
  admin: [
    "create_recommendation",
    "create_task",
    "add_task_comment",
    "log_communication",
    "queue_whatsapp_response",
  ],
};

function normalizeAllowedActions(value: unknown, tier: WhatsAppPermissionTier) {
  if (!Array.isArray(value) || value.length === 0) return defaultWhatsAppActions[tier];
  const allowed = new Set(defaultWhatsAppActions[tier]);
  return value.filter((item): item is string => typeof item === "string" && allowed.has(item));
}

function whatsAppTierForRole(role: User["role"]): WhatsAppPermissionTier {
  if (role === "admin") return "admin";
  if (role === "agent") return "agent";
  return "staff";
}

async function resolveApprovedWhatsAppUser(
  client: pg.Pool | pg.PoolClient,
  phoneOrJid: string | null,
  candidateJids: string[] = phoneOrJid ? [phoneOrJid] : [],
): Promise<WhatsAppApprovedUser | null> {
  const digits = phoneDigits(phoneOrJid) ?? phoneDigitsFromJid(phoneOrJid);
  const normalizedJids = [...new Set(candidateJids.map(normalizeWhatsAppJid).filter(Boolean))];
  if (!digits && normalizedJids.length === 0) return null;
  const result = await client.query(
    `
    SELECT
      wau.id,
      wau.phone_e164,
      wau.status,
      wau.permission_tier,
      wau.allowed_actions,
      u.id AS user_id,
      u.email,
      u.name,
      u.role
    FROM whatsapp_approved_users wau
    JOIN app_users u ON u.id = wau.user_id
    WHERE ($1::text IS NOT NULL AND regexp_replace(wau.phone_e164, '\\D', '', 'g') = $1)
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(
           CASE
             WHEN jsonb_typeof(wau.metadata->'whatsappJids') = 'array' THEN wau.metadata->'whatsappJids'
             ELSE '[]'::jsonb
           END
         ) AS approved_jid(value)
         WHERE lower(approved_jid.value) = ANY($2::text[])
       )
    LIMIT 1
  `,
    [digits, normalizedJids],
  );
  const row = result.rows[0];
  if (!row) return null;
  const tier = requireOneOf(row.permission_tier, "Permission tier", [
    "agent",
    "staff",
    "admin",
  ] as const);
  return {
    approvalId: row.id as string,
    phoneE164: row.phone_e164 as string,
    status: row.status as "active" | "revoked",
    permissionTier: tier,
    allowedActions: normalizeAllowedActions(row.allowed_actions, tier),
    user: {
      id: row.user_id as string,
      email: row.email as string,
      name: row.name as string,
      role: row.role as User["role"],
    },
  };
}

function canWhatsAppUser(approved: WhatsAppApprovedUser, action: string) {
  return approved.status === "active" && approved.allowedActions.includes(action);
}

function isWhatsAppApprovalGated(input: string, output: string) {
  const text = `${input}\n${output}`.toLowerCase();
  return /\b(price|pricing|quote|quotation|invoice|payment|discount|contract|legal|liability|refund|cancel|delete|archive|won|lost|fire certificate|compliance certificate|guarantee|promise|approve|approval|escalat|complain)\b/.test(
    text,
  );
}

function whatsAppSummary(text: string | null, type: string | null) {
  if (text) return text.slice(0, 240);
  return `WhatsApp ${type ?? "message"} received without extractable text.`;
}

async function findWhatsAppContact(
  client: pg.PoolClient,
  from: string | null,
): Promise<{ contactId: string | null; organizationId: string | null; dealId: string | null }> {
  const phone = phoneDigitsFromJid(from);
  if (!phone) return { contactId: null, organizationId: null, dealId: null };

  const result = await client.query(
    `
    SELECT c.id AS contact_id, c.organization_id, d.id AS deal_id
    FROM contacts c
    LEFT JOIN deals d ON d.primary_contact_id = c.id AND d.status = 'open'
    WHERE regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') = $1
    ORDER BY d.updated_at DESC NULLS LAST, c.updated_at DESC
    LIMIT 1
  `,
    [phone],
  );

  return {
    contactId: (result.rows[0]?.contact_id as string | undefined) ?? null,
    organizationId: (result.rows[0]?.organization_id as string | undefined) ?? null,
    dealId: (result.rows[0]?.deal_id as string | undefined) ?? null,
  };
}

async function logWhatsAppInbound(
  verified: Extract<SignedWebhookVerification, { ok: true }>,
  payload: WhatsAppInboundPayload,
) {
  const sourceInstance = sourceInstanceId(verified.source);
  const instanceId = optionalText(payload.instanceId) ?? sourceInstance;
  const messageId = optionalText(payload.messageId) ?? verified.idempotencyKey;
  const chatId = requireText(payload.chatId, "Chat id");
  const from = optionalText(payload.from) ?? chatId;
  const to = optionalText(payload.to);
  const pushName = optionalText(payload.pushName);
  const type = optionalText(payload.type) ?? "unknown";
  const text = optionalText(payload.text);
  const raw = payload.raw ?? payload;
  const eventTimestamp = optionalNumber(payload.timestamp);
  const createdAt = eventTimestamp
    ? new Date(eventTimestamp < 10_000_000_000 ? eventTimestamp * 1000 : eventTimestamp)
    : new Date();

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const links = await findWhatsAppContact(client, from);
    const approved = await resolveApprovedWhatsAppUser(client, from, [from, chatId]);
    const conversation = await client.query(
      `INSERT INTO whatsapp_conversations (
        instance_id, chat_id, contact_id, organization_id, deal_id, display_name,
        approved_user_id, staff_user_id, last_message_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (instance_id, chat_id) DO UPDATE SET
         contact_id = COALESCE(EXCLUDED.contact_id, whatsapp_conversations.contact_id),
         organization_id = COALESCE(EXCLUDED.organization_id, whatsapp_conversations.organization_id),
         deal_id = COALESCE(EXCLUDED.deal_id, whatsapp_conversations.deal_id),
         display_name = COALESCE(EXCLUDED.display_name, whatsapp_conversations.display_name),
         approved_user_id = COALESCE(EXCLUDED.approved_user_id, whatsapp_conversations.approved_user_id),
         staff_user_id = COALESCE(EXCLUDED.staff_user_id, whatsapp_conversations.staff_user_id),
         last_message_at = EXCLUDED.last_message_at,
         updated_at = now()
       RETURNING id, contact_id, organization_id, deal_id, approved_user_id, staff_user_id`,
      [
        instanceId,
        chatId,
        links.contactId,
        links.organizationId,
        links.dealId,
        pushName,
        approved?.approvalId ?? null,
        approved?.user.id ?? null,
        createdAt,
      ],
    );
    const conversationRow = conversation.rows[0];

    const inbound = await client.query(
      `INSERT INTO inbound_events (
        source, source_event_id, contact_id, organization_id, deal_id, payload, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       RETURNING id`,
      [
        verified.source,
        messageId,
        conversationRow.contact_id,
        conversationRow.organization_id,
        conversationRow.deal_id,
        JSON.stringify({ ...payload, raw }),
        createdAt,
      ],
    );

    const communication = await client.query(
      `INSERT INTO communications (
        deal_id, contact_id, organization_id, direction, channel, subject, body, summary, created_at
       )
       VALUES ($1, $2, $3, 'inbound', 'whatsapp', $4, $5, $6, $7)
       RETURNING id`,
      [
        conversationRow.deal_id,
        conversationRow.contact_id,
        conversationRow.organization_id,
        `WhatsApp from ${pushName ?? from}`,
        text,
        whatsAppSummary(text, type),
        createdAt,
      ],
    );

    await client.query(
      `INSERT INTO embedding_documents (entity_type, entity_id, content, metadata)
       VALUES ('whatsapp_message', $1, $2, $3::jsonb)`,
      [
        inbound.rows[0].id,
        [pushName, from, type, text].filter(Boolean).join("\n") || whatsAppSummary(null, type),
        JSON.stringify({ channel: "whatsapp", instanceId, chatId, messageId }),
      ],
    );

    await audit(client, "whatsapp_inbound_received", "inbound_event", inbound.rows[0].id, {
      instanceId,
      chatId,
      messageId,
      type,
      from,
      to,
      approvedUserId: approved?.approvalId ?? null,
      staffUserId: approved?.user.id ?? null,
    });
    await client.query("COMMIT");

    return {
      instanceId,
      chatId,
      from,
      to,
      pushName,
      type,
      text,
      conversationId: conversationRow.id as string,
      contactId: (conversationRow.contact_id as string | null) ?? null,
      organizationId: (conversationRow.organization_id as string | null) ?? null,
      dealId: (conversationRow.deal_id as string | null) ?? null,
      inboundEventId: inbound.rows[0].id as string,
      communicationId: communication.rows[0].id as string,
      approvedUser: approved,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function whatsappContext(message: string) {
  const result = await getPool().query(
    `SELECT entity_type, entity_id, content, metadata
     FROM embedding_documents
     WHERE search_vector @@ plainto_tsquery('english', $1)
     ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC
     LIMIT 6`,
    [message],
  );
  return result.rows;
}

async function generateWhatsAppReply(message: string, contextRows: pg.QueryResultRow[]) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { reply: null, error: "GEMINI_API_KEY is not configured" };

  const model = process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash";
  const context = contextRows
    .map((row, index) => `${index + 1}. ${row.entity_type}: ${String(row.content).slice(0, 1200)}`)
    .join("\n\n");
  const prompt = [
    "Incoming WhatsApp message:",
    message,
    "",
    "Relevant CRM context:",
    context || "No matching CRM context found.",
    "",
    "Draft one concise WhatsApp reply for STI Risk. Do not make pricing, contract, compliance, finance, warranty, or scheduling commitments. If the user asks for a governed action, say the team will review and follow up.",
  ].join("\n");

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: "You are STI Risk's CRM communication assistant. You may draft short, helpful WhatsApp replies, but the CRM remains authoritative and approval-gated business actions must not be executed in chat.",
              },
            ],
          },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 300 },
        }),
      },
    );
    const body = asRecord(await response.json());
    if (!response.ok) {
      const error = JSON.stringify(body).slice(0, 500);
      return { reply: null, error };
    }
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    const content = asRecord(asRecord(candidates[0]).content);
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const reply = parts
      .map((part) => optionalText(asRecord(part).text))
      .filter(Boolean)
      .join("\n")
      .trim();
    return { reply: reply || null, error: reply ? null : "Gemini returned an empty response" };
  } catch (error) {
    return { reply: null, error: error instanceof Error ? error.message : "Gemini request failed" };
  }
}

async function finalizeWhatsAppResponse(
  logged: Awaited<ReturnType<typeof logWhatsAppInbound>>,
  ai: { reply: string | null; error: string | null },
  contextRows: pg.QueryResultRow[],
) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const toolCall = await client.query(
      `INSERT INTO tool_calls (source, tool_name, request, response, status)
       VALUES ('whatsapp', 'gemini_whatsapp_reply', $1::jsonb, $2::jsonb, $3)
       RETURNING id`,
      [
        JSON.stringify({
          inboundEventId: logged.inboundEventId,
          message: logged.text,
          contextMatches: contextRows.length,
        }),
        JSON.stringify({ reply: ai.reply, error: ai.error }),
        ai.reply ? "completed" : "failed",
      ],
    );

    if (!logged.text || !ai.reply || isWhatsAppApprovalGated(logged.text, ai.reply)) {
      const recommendation = await client.query(
        `INSERT INTO ai_recommendations (
          deal_id, contact_id, organization_id, recommendation_type, title, body, requires_approval, payload
         )
         VALUES ($1, $2, $3, 'whatsapp_reply_review', $4, $5, true, $6::jsonb)
         RETURNING id`,
        [
          logged.dealId,
          logged.contactId,
          logged.organizationId,
          ai.reply
            ? "Approval required before WhatsApp reply"
            : "WhatsApp reply requires staff review",
          ai.reply ??
            "A WhatsApp message was received, but the CRM could not generate an auto-sendable response.",
          JSON.stringify({
            channel: "whatsapp",
            inboundEventId: logged.inboundEventId,
            conversationId: logged.conversationId,
            toolCallId: toolCall.rows[0].id,
            error: ai.error,
          }),
        ],
      );
      await audit(
        client,
        "whatsapp_ai_response_requires_review",
        "ai_recommendation",
        recommendation.rows[0].id,
        { inboundEventId: logged.inboundEventId, reason: ai.error ?? "approval_gated" },
      );
      await client.query("COMMIT");
      return { recommendationId: recommendation.rows[0].id as string, outboxId: null };
    }

    const communication = await client.query(
      `INSERT INTO communications (
        deal_id, contact_id, organization_id, direction, channel, subject, body, summary
       )
       VALUES ($1, $2, $3, 'outbound', 'whatsapp', $4, $5, $6)
       RETURNING id`,
      [
        logged.dealId,
        logged.contactId,
        logged.organizationId,
        `WhatsApp reply to ${logged.pushName ?? logged.from}`,
        ai.reply,
        ai.reply.slice(0, 240),
      ],
    );

    const outbox = await client.query(
      `INSERT INTO whatsapp_outbox (
        conversation_id, source_inbound_event_id, communication_id, recipient, message_body, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id`,
      [
        logged.conversationId,
        logged.inboundEventId,
        communication.rows[0].id,
        logged.chatId,
        ai.reply,
        JSON.stringify({ toolCallId: toolCall.rows[0].id, instanceId: logged.instanceId }),
      ],
    );

    await audit(client, "whatsapp_ai_response_generated", "whatsapp_outbox", outbox.rows[0].id, {
      inboundEventId: logged.inboundEventId,
      communicationId: communication.rows[0].id,
    });
    await client.query("COMMIT");
    return { recommendationId: null, outboxId: outbox.rows[0].id as string };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function recordWhatsAppAgentFailure(
  logged: Awaited<ReturnType<typeof logWhatsAppInbound>>,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : "WhatsApp agent failed";
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const toolCall = await client.query(
      `INSERT INTO tool_calls (source, tool_name, request, response, status)
       VALUES ('whatsapp_n8n', 'agent_turn', $1::jsonb, $2::jsonb, 'failed')
       RETURNING id`,
      [
        JSON.stringify({
          inboundEventId: logged.inboundEventId,
          conversationId: logged.conversationId,
          message: logged.text,
        }),
        JSON.stringify({ error: message }),
      ],
    );
    const recommendation = await client.query(
      `INSERT INTO ai_recommendations (
        deal_id, contact_id, organization_id, recommendation_type, title, body, requires_approval, payload
       )
       VALUES ($1, $2, $3, 'whatsapp_agent_failure', $4, $5, true, $6::jsonb)
       RETURNING id`,
      [
        logged.dealId,
        logged.contactId,
        logged.organizationId,
        "WhatsApp agent turn failed",
        `A WhatsApp message was received but the n8n agent could not process it: ${message}`,
        JSON.stringify({
          inboundEventId: logged.inboundEventId,
          conversationId: logged.conversationId,
          toolCallId: toolCall.rows[0].id,
        }),
      ],
    );
    await audit(client, "whatsapp_agent_failure", "ai_recommendation", recommendation.rows[0].id, {
      inboundEventId: logged.inboundEventId,
      error: message,
    });
    await client.query("COMMIT");
    return { recommendationId: recommendation.rows[0].id as string, error: message };
  } catch (failure) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw failure;
  } finally {
    client.release();
  }
}

async function whatsappInbound(request: Request) {
  const rawBody = await request.text();
  const verified = await verifySignedWebhook(request, rawBody, {
    secret: getWhatsAppWebhookSecret(),
    sourcePrefix: "whatsapp-messenger:",
    secretLabel: "WHATSAPP_WEBHOOK_SECRET",
  });
  if (!verified.ok) return verified.response;

  const payload = JSON.parse(rawBody || "{}") as WhatsAppInboundPayload;
  const logged = await logWhatsAppInbound(verified, payload);
  let agentResult: Record<string, unknown> | null = null;
  let failure: Awaited<ReturnType<typeof recordWhatsAppAgentFailure>> | null = null;
  try {
    agentResult = await whatsappAgentRequest({
      inboundEventId: logged.inboundEventId,
      communicationId: logged.communicationId,
      conversationId: logged.conversationId,
      contactId: logged.contactId,
      organizationId: logged.organizationId,
      dealId: logged.dealId,
      instanceId: logged.instanceId,
      chatId: logged.chatId,
      from: logged.from,
      to: logged.to,
      pushName: logged.pushName,
      type: logged.type,
      message: logged.text,
      approvedUser: logged.approvedUser
        ? {
            approvalId: logged.approvedUser.approvalId,
            phoneE164: logged.approvedUser.phoneE164,
            permissionTier: logged.approvedUser.permissionTier,
            allowedActions: logged.approvedUser.allowedActions,
            user: logged.approvedUser.user,
          }
        : null,
    });
  } catch (error) {
    failure = await recordWhatsAppAgentFailure(logged, error);
  }
  const responseBody = {
    ok: true,
    inboundEventId: logged.inboundEventId,
    agent: agentResult,
    agentFailure: failure,
  };

  await getPool().query(
    `INSERT INTO webhook_idempotency_keys (source, idempotency_key, request_hash, response_status, response_body)
     VALUES ($1, $2, $3, 200, $4::jsonb)`,
    [
      verified.source,
      verified.idempotencyKey,
      crypto.createHash("sha256").update(rawBody).digest("hex"),
      JSON.stringify(responseBody),
    ],
  );

  return json(responseBody, { status: 202 });
}

async function messengerOutboxClaim(request: Request) {
  if (!verifyMessengerRequest(request)) return forbidden();
  const body = await readJson(request);
  const instanceId = requireText(body.instanceId, "Instance id");
  const limit = Math.min(Math.max(Number(body.limit ?? 5), 1), 20);
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      `WITH candidates AS (
        SELECT id
        FROM whatsapp_outbox
        WHERE (
          (status IN ('pending', 'retryable_failed') AND next_attempt_at <= now())
          OR (status = 'claimed' AND lease_until < now())
        )
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      )
      UPDATE whatsapp_outbox o
      SET status = 'claimed',
          claimed_by = $2,
          lease_until = now() + interval '90 seconds',
          attempt_count = attempt_count + 1,
          updated_at = now()
      FROM candidates
      WHERE o.id = candidates.id
      RETURNING o.id, o.recipient, o.message_body, o.attempt_count, o.metadata`,
      [limit, instanceId],
    );
    for (const row of result.rows) {
      await audit(client, "whatsapp_outbound_claimed", "whatsapp_outbox", row.id, {
        instanceId,
        attemptCount: row.attempt_count,
      });
    }
    await client.query("COMMIT");
    return json({
      messages: result.rows.map((row) => ({
        id: row.id,
        recipient: row.recipient,
        messageBody: row.message_body,
        attemptCount: row.attempt_count,
        metadata: row.metadata ?? {},
      })),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function messengerOutboxResult(request: Request, outboxId: string) {
  if (!verifyMessengerRequest(request)) return forbidden();
  const body = await readJson(request);
  const status = requireOneOf(body.status, "Status", [
    "sent",
    "failed",
    "retryable_failed",
  ] as const);
  const providerMessageId = optionalText(body.providerMessageId);
  const error = optionalText(body.error);
  const metadata = asRecord(body.metadata);
  const nextRetryAt = optionalText(body.nextRetryAt) ?? optionalText(metadata.nextRetryAt);

  const result = await getPool().query(
    `UPDATE whatsapp_outbox
     SET status = $2,
         provider_message_id = COALESCE($3, provider_message_id),
         error = $4,
         metadata = metadata || $5::jsonb,
         lease_until = NULL,
         next_attempt_at = CASE
           WHEN $6::timestamptz IS NOT NULL THEN $6::timestamptz
           WHEN $2 = 'retryable_failed' THEN now() + interval '30 seconds'
           ELSE next_attempt_at
         END,
         sent_at = CASE
           WHEN $2 = 'sent' THEN now()
           WHEN $2 IN ('failed', 'retryable_failed') THEN NULL
           ELSE sent_at
         END,
         updated_at = now()
     WHERE id = $1
     RETURNING id, communication_id`,
    [outboxId, status, providerMessageId, error, JSON.stringify(metadata), nextRetryAt],
  );
  if (!result.rows[0]) return json({ error: "Outbox message not found" }, { status: 404 });

  await audit(
    getPool(),
    status === "sent" ? "whatsapp_outbound_sent" : "whatsapp_outbound_failed",
    "whatsapp_outbox",
    outboxId,
    { providerMessageId, error, status },
  );
  return json({ ok: true });
}

async function automationEvent(request: Request) {
  const rawBody = await request.text();
  const verified = await verifyWebhook(request, rawBody);
  if (!verified.ok) return verified.response;

  const payload = JSON.parse(rawBody || "{}");
  const summary =
    optionalText(payload.summary) ?? optionalText(payload.message) ?? "Automation event";
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const inbound = await client.query(
      `INSERT INTO inbound_events (
        source, source_event_id, contact_id, organization_id, deal_id, project_id, task_id, payload
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id`,
      [
        verified.source,
        optionalText(payload.eventId) ?? crypto.randomUUID(),
        payload.contactId ?? null,
        payload.organizationId ?? null,
        payload.dealId ?? null,
        payload.projectId ?? null,
        payload.taskId ?? null,
        JSON.stringify(payload),
      ],
    );

    await client.query(
      `INSERT INTO communications (
        deal_id, contact_id, organization_id, project_id, task_id, direction, channel, subject, body, summary
       )
       VALUES ($1, $2, $3, $4, $5, 'internal', $6, $7, $8, $9)`,
      [
        payload.dealId ?? null,
        payload.contactId ?? null,
        payload.organizationId ?? null,
        payload.projectId ?? null,
        payload.taskId ?? null,
        verified.source,
        optionalText(payload.title) ?? "Automation event",
        optionalText(payload.body) ?? summary,
        summary,
      ],
    );

    await client.query(
      `INSERT INTO embedding_documents (entity_type, entity_id, content, metadata)
       VALUES ('automation_event', $1, $2, $3::jsonb)`,
      [
        inbound.rows[0].id,
        [payload.title, summary, payload.body].filter(Boolean).join("\n"),
        JSON.stringify({ source: verified.source, eventId: payload.eventId ?? null }),
      ],
    );

    if (payload.recommendation?.title && payload.recommendation?.body) {
      await client.query(
        `INSERT INTO ai_recommendations (
          deal_id, contact_id, organization_id, project_id, task_id,
          recommendation_type, title, body, confidence, payload
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 0.6), $10::jsonb)`,
        [
          payload.dealId ?? null,
          payload.contactId ?? null,
          payload.organizationId ?? null,
          payload.projectId ?? null,
          payload.taskId ?? null,
          payload.recommendation.type ?? "automation_suggestion",
          payload.recommendation.title,
          payload.recommendation.body,
          payload.recommendation.confidence ?? null,
          JSON.stringify(payload.recommendation.payload ?? {}),
        ],
      );
    }

    const responseBody = { ok: true, inboundEventId: inbound.rows[0].id };
    await client.query(
      `INSERT INTO webhook_idempotency_keys (source, idempotency_key, request_hash, response_status, response_body)
       VALUES ($1, $2, $3, 200, $4::jsonb)`,
      [
        verified.source,
        verified.idempotencyKey,
        crypto.createHash("sha256").update(rawBody).digest("hex"),
        JSON.stringify(responseBody),
      ],
    );
    await audit(client, "automation_event", "inbound_event", inbound.rows[0].id, {
      source: verified.source,
    });
    await client.query("COMMIT");
    return json(responseBody);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function verifySignedWebhook(
  request: Request,
  rawBody: string,
  options: { secret?: string; sourcePrefix?: string; secretLabel: string },
): Promise<SignedWebhookVerification> {
  const secret = options.secret;
  if (!secret)
    return {
      ok: false,
      response: json({ error: `${options.secretLabel} is not configured` }, { status: 503 }),
    };

  const timestamp = request.headers.get("x-sti-timestamp");
  const signature = request.headers.get("x-sti-signature");
  const idempotencyKey = request.headers.get("x-sti-idempotency-key");
  const source = request.headers.get("x-sti-source");
  if (!timestamp || !signature || !idempotencyKey || !source) {
    return { ok: false, response: unauthorized() };
  }

  if (options.sourcePrefix && !source.startsWith(options.sourcePrefix)) {
    return { ok: false, response: forbidden() };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
    return { ok: false, response: json({ error: "Webhook timestamp expired" }, { status: 401 }) };
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  if (
    expected.length !== provided.length ||
    !crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"))
  ) {
    return { ok: false, response: unauthorized() };
  }

  const previous = await getPool().query(
    "SELECT response_status, response_body FROM webhook_idempotency_keys WHERE source = $1 AND idempotency_key = $2",
    [source, idempotencyKey],
  );
  if (previous.rows[0]) {
    return {
      ok: false,
      response: json({ error: "Webhook idempotency key replayed" }, { status: 409 }),
    };
  }

  return { ok: true, source, idempotencyKey };
}

async function verifyWebhook(request: Request, rawBody: string) {
  return verifySignedWebhook(request, rawBody, {
    secret: process.env.WEBHOOK_SECRET,
    secretLabel: "WEBHOOK_SECRET",
  });
}

async function handleWebhook(request: Request) {
  const rawBody = await request.text();
  const verified = await verifyWebhook(request, rawBody);
  if (!verified.ok) return verified.response;

  const payload = JSON.parse(rawBody || "{}");
  const lead = await createLead({ ...payload, source: payload.source ?? verified.source });
  const body = { ok: true, lead };
  await getPool().query(
    `INSERT INTO webhook_idempotency_keys (source, idempotency_key, request_hash, response_status, response_body)
     VALUES ($1, $2, $3, 200, $4::jsonb)`,
    [
      verified.source,
      verified.idempotencyKey,
      crypto.createHash("sha256").update(rawBody).digest("hex"),
      JSON.stringify(body),
    ],
  );
  return json(body);
}

async function hermesTool(request: Request, toolName: string) {
  const rawBody = await request.text();
  const verified = await verifyWebhook(request, rawBody);
  if (!verified.ok) return verified.response;

  const body = JSON.parse(rawBody || "{}");
  await getPool().query(
    "INSERT INTO tool_calls (source, tool_name, request, status) VALUES ($1, $2, $3::jsonb, 'received')",
    [verified.source, toolName, JSON.stringify(body)],
  );

  if (toolName === "create_recommendation") {
    const result = await getPool().query(
      `INSERT INTO ai_recommendations (
        deal_id, contact_id, organization_id, project_id, task_id,
        recommendation_type, title, body, payload
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       RETURNING id`,
      [
        body.dealId ?? null,
        body.contactId ?? null,
        body.organizationId ?? null,
        body.projectId ?? null,
        body.taskId ?? null,
        body.recommendationType ?? "agent_suggestion",
        requireText(body.title, "Title"),
        requireText(body.body, "Body"),
        JSON.stringify(body.payload ?? {}),
      ],
    );
    return json({ ok: true, recommendationId: result.rows[0].id });
  }

  if (toolName === "semantic_search") {
    const q = requireText(body.query, "Query");
    const result = await getPool().query(
      `SELECT entity_type, entity_id, content, metadata
       FROM embedding_documents
       WHERE search_vector @@ plainto_tsquery('english', $1)
       ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC
       LIMIT 10`,
      [q],
    );
    return json({ ok: true, results: result.rows });
  }

  if (
    toolName === "lead_capture" ||
    toolName === "create_deal" ||
    toolName === "find_or_create_contact"
  ) {
    const lead = await createLead({ ...body, source: `hermes_${toolName}` });
    return json({ ok: true, lead });
  }

  return json({ error: "Unsupported Hermes tool" }, { status: 404 });
}

export async function isStaffRequestAuthenticated(request: Request) {
  try {
    return Boolean(await getSessionUser(request));
  } catch {
    return false;
  }
}

function getStaffAgentConfig() {
  return {
    webhookUrl:
      process.env.N8N_AGENT_WEBHOOK_URL || "http://n8n:5678/webhook/sti-risk/staff-agent/chat",
    statusUrl: process.env.N8N_AGENT_STATUS_URL || "http://n8n:5678/healthz",
    token: process.env.N8N_AGENT_TOKEN || "",
  };
}

type AuthResult = { user: User } | { response: Response };

async function requireSteveAdminAccess(request: Request): Promise<AuthResult> {
  const auth = await requireUser(request, ["admin"]);
  if (auth.response) return auth;
  if (!isSteveAdminUser(auth.user)) {
    return {
      response: json(
        { error: "Steve access is limited to Kiril and the super admin" },
        { status: 403 },
      ),
    };
  }
  return auth;
}

function getWhatsAppAgentConfig() {
  const { token } = getStaffAgentConfig();
  return {
    webhookUrl:
      process.env.N8N_WHATSAPP_AGENT_WEBHOOK_URL ||
      "http://n8n:5678/webhook/sti-risk/whatsapp-agent/chat",
    statusUrl: process.env.N8N_AGENT_STATUS_URL || "http://n8n:5678/healthz",
    token,
  };
}

function staffAgentHeaders(user: User) {
  const { token } = getStaffAgentConfig();
  return {
    "content-type": "application/json",
    "X-STI-Agent-Token": token,
    "X-STI-Staff-User": user.id,
  };
}

async function staffAgentRequest<T>(payload: Record<string, unknown>, user: User): Promise<T> {
  const { token, webhookUrl } = getStaffAgentConfig();
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: staffAgentHeaders(user),
    body: JSON.stringify({ ...payload, agentToken: token }),
    signal: AbortSignal.timeout(45_000),
  });
  const text = await response.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text };
    }
  }
  if (!response.ok) {
    const errorBody = body as { error?: { message?: string } | string };
    const message =
      errorBody?.error?.message ||
      errorBody?.error ||
      `Steve request failed with ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

async function whatsappAgentRequest(payload: Record<string, unknown>) {
  const { token, webhookUrl } = getWhatsAppAgentConfig();
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-STI-Agent-Token": token,
    },
    body: JSON.stringify({ ...payload, agentToken: token }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text };
    }
  }
  if (!response.ok) {
    const errorBody = body as { error?: { message?: string } | string };
    const message =
      errorBody?.error?.message ||
      errorBody?.error ||
      `WhatsApp agent request failed with ${response.status}`;
    throw new Error(message);
  }
  return body as Record<string, unknown>;
}

function titleFromMessage(content: string) {
  const cleaned = content.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New chat";
  return cleaned.length > 52 ? `${cleaned.slice(0, 52)}...` : cleaned;
}

async function chatContextSummary(user: User) {
  const [
    kpis,
    tasks,
    deals,
    contacts,
    projects,
    growthCampaigns,
    growthRecommendations,
    recommendations,
    microsoft,
  ] = await Promise.all([
    getPool().query(`
      SELECT
        count(*) FILTER (WHERE role IN ('admin', 'staff', 'agent'))::int AS active_staff,
        (SELECT count(*)::int FROM tasks WHERE status IN ('open', 'blocked')) AS active_tasks,
        (SELECT count(*)::int FROM tasks WHERE status IN ('open', 'blocked') AND due_at < now()) AS overdue_tasks,
        (SELECT COALESCE(sum(value_cents)::int, 0) FROM deals WHERE status = 'open') AS open_deal_value_cents,
        (SELECT count(*)::int FROM deals WHERE status = 'open') AS open_deals,
        (SELECT count(*)::int FROM contacts WHERE do_not_contact = true) AS do_not_contact_contacts,
        (SELECT count(*)::int FROM projects WHERE status IN ('planned', 'active', 'on_hold')) AS open_projects,
        (SELECT count(*)::int FROM lemlist_campaigns WHERE status = 'active') AS active_growth_campaigns
      FROM app_users
    `),
    getPool().query(
      `
      SELECT t.title, t.priority, t.status, t.due_at, u.name AS owner_name, o.name AS organization_name
      FROM tasks t
      LEFT JOIN app_users u ON u.id = t.owner_id
      LEFT JOIN organizations o ON o.id = t.organization_id
      WHERE t.status IN ('open', 'blocked')
      ORDER BY t.due_at ASC NULLS LAST, t.updated_at DESC
      LIMIT 8
    `,
    ),
    getPool().query(`
      SELECT d.title, d.value_cents, s.name AS stage_name, o.name AS organization_name, u.name AS owner_name
      FROM deals d
      LEFT JOIN pipeline_stages s ON s.id = d.stage_id
      LEFT JOIN organizations o ON o.id = d.organization_id
      LEFT JOIN app_users u ON u.id = d.owner_id
      WHERE d.status = 'open'
      ORDER BY d.updated_at DESC
      LIMIT 8
    `),
    getPool().query(`
      SELECT c.id, c.first_name, c.last_name, c.email, c.lifecycle_stage, c.consent_status,
        c.do_not_contact, o.name AS organization_name, u.name AS owner_name
      FROM contacts c
      LEFT JOIN organizations o ON o.id = c.organization_id
      LEFT JOIN app_users u ON u.id = c.owner_id
      ORDER BY c.updated_at DESC
      LIMIT 8
    `),
    getPool().query(`
      SELECT p.id, p.name, p.status, p.priority, p.due_on, p.budget_cents,
        o.name AS organization_name, d.title AS deal_title
      FROM projects p
      LEFT JOIN organizations o ON o.id = p.organization_id
      LEFT JOIN deals d ON d.id = p.deal_id
      ORDER BY p.updated_at DESC
      LIMIT 8
    `),
    getPool().query(`
      SELECT id, lemlist_campaign_id, name, status, purpose, segment, metrics_snapshot, last_synced_at
      FROM lemlist_campaigns
      ORDER BY updated_at DESC
      LIMIT 8
    `),
    getPool().query(`
      SELECT id, recommendation_type, title, body, status, created_at
      FROM ai_recommendations
      WHERE recommendation_type IN (
        'campaign_enrollment', 'quote_follow_up', 'dormant_reactivation',
        'partner_outreach', 'reply_handling', 'campaign_intelligence'
      )
      ORDER BY created_at DESC
      LIMIT 8
    `),
    getPool().query(`
      SELECT title, body
      FROM ai_recommendations
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT 5
    `),
    microsoftAgentMemory(user),
  ]);

  return [
    "Agent role: Steve, STI Risk platform intelligence and operations assistant.",
    "Rules: read platform context freely, use signed STI Risk tool APIs for writes, and treat direct database access as read-only. Direct writes are limited to internal tasks, task comments, internal communication notes, and quote template drafts. Deal/contact/project/growth changes must become approval-first recommendations for staff review. Do not send outreach, enroll contacts, change pricing, make finance decisions, or perform destructive actions automatically.",
    "Microsoft 365 rules: if Microsoft Graph is connected for the signed-in user, Steve may read that user's Outlook/OneDrive context and create Outlook email drafts for that user. Steve must not send email automatically; created drafts must be reviewed by the user in Outlook or the STI Risk OS before sending.",
    `Current user: ${user.name} <${user.email}> (${user.role}).`,
    `Microsoft 365 capability memory for current user: ${JSON.stringify(microsoft)}`,
    `Operational snapshot: ${JSON.stringify(kpis.rows[0] ?? {})}`,
    `Priority tasks: ${JSON.stringify(tasks.rows)}`,
    `Open deals: ${JSON.stringify(deals.rows)}`,
    `Recent contacts: ${JSON.stringify(contacts.rows)}`,
    `Projects: ${JSON.stringify(projects.rows)}`,
    `Growth campaigns: ${JSON.stringify(growthCampaigns.rows)}`,
    `Growth recommendations: ${JSON.stringify(growthRecommendations.rows)}`,
    `Pending recommendations: ${JSON.stringify(recommendations.rows)}`,
  ].join("\n");
}

function attachmentPrompt(rows: pg.QueryResultRow[]) {
  if (!rows.length) return "";
  const parts = rows.map((row) => {
    const extracted =
      typeof row.extracted_text === "string" ? row.extracted_text.slice(0, 5000) : "";
    return `Attachment: ${row.original_name} (${row.mime_type}, ${row.size_bytes} bytes)\n${extracted || "No text extraction available; use the filename and metadata only."}`;
  });
  return `\n\nUploaded documents for this turn:\n${parts.join("\n\n")}`;
}

function isOneDriveUploadRequest(content: string) {
  const lower = content.toLowerCase();
  return (
    (lower.includes("onedrive") || lower.includes("one drive")) &&
    /\b(upload|post|save|store|put|add)\b/.test(lower)
  );
}

function requestedOneDriveFolder(content: string) {
  const match =
    content.match(/(?:folder|directory)\s+(?:called|named|as|to|for)?\s*["']([^"']+)["']/i) ??
    content.match(/(?:folder|directory)\s+(?:called|named|as|to|for)?\s+([^.,\n]+)/i);
  return match?.[1]?.trim();
}

async function uploadChatAttachmentsToOneDrive(
  user: User,
  attachmentRows: pg.QueryResultRow[],
  folderPath?: string,
) {
  const uploaded = [];
  for (const row of attachmentRows) {
    const storedPath = optionalText(row.stored_path);
    if (!storedPath || storedPath.startsWith("microsoft-graph:")) continue;
    const buffer = await readFile(storedPath);
    const driveItem = await uploadBufferToOneDrive(
      user,
      buffer,
      String(row.original_name),
      folderPath,
      optionalText(row.mime_type),
    );
    uploaded.push({
      attachmentId: row.id,
      name: row.original_name,
      driveItemId: driveItem.id ?? null,
      webUrl: driveItem.webUrl ?? null,
    });
    await getPool().query(
      `UPDATE staff_chat_attachments
       SET metadata = metadata || $1::jsonb
       WHERE id = $2`,
      [JSON.stringify({ oneDriveUpload: uploaded.at(-1) }), row.id],
    );
  }
  return uploaded;
}

async function staffChatSessions(request: Request) {
  const auth = await requireSteveAdminAccess(request);
  if (auth.response) return auth.response;

  if (request.method === "POST") {
    const body = await readJson(request);
    const title = optionalText(body.title) ?? "New chat";
    const result = await getPool().query(
      `INSERT INTO staff_chat_sessions (user_id, title)
       VALUES ($1, $2)
       RETURNING id, title, status, created_at, updated_at, last_message_at`,
      [auth.user.id, title],
    );
    await audit(
      getPool(),
      "create_steve_chat_session",
      "staff_chat_session",
      result.rows[0].id,
      {},
      auth.user,
    );
    return json({ session: result.rows[0] }, { status: 201 });
  }

  const rows = await getPool().query(
    `
    SELECT s.id, s.title, s.status, s.created_at, s.updated_at, s.last_message_at,
      (
        SELECT m.content
        FROM staff_chat_messages m
        WHERE m.session_id = s.id
        ORDER BY m.created_at DESC
        LIMIT 1
      ) AS last_message
    FROM staff_chat_sessions s
    WHERE s.user_id = $1 AND s.status = 'active'
    ORDER BY COALESCE(s.last_message_at, s.updated_at, s.created_at) DESC
    LIMIT 50
  `,
    [auth.user.id],
  );
  return json({ sessions: rows.rows });
}

async function staffChatEntities(request: Request) {
  const auth = await requireSteveAdminAccess(request);
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const requestedType = (url.searchParams.get("type") ?? "").trim();
  const pattern = `%${query}%`;
  const result = await getPool().query(
    `SELECT * FROM (
       SELECT 'customer'::text AS type, o.id, o.name AS label,
         COALESCE(o.industry, 'Client organization') AS subtitle,
         '/staff/clients?organization=' || o.id::text AS href
       FROM organizations o
       WHERE ($1 = '' OR o.name ILIKE $2)
       UNION ALL
       SELECT 'project', p.id, p.name,
         COALESCE(o.name, initcap(replace(p.status, '_', ' '))),
         '/staff/projects?project=' || p.id::text
       FROM projects p
       LEFT JOIN organizations o ON o.id = p.organization_id
       WHERE ($1 = '' OR p.name ILIKE $2 OR o.name ILIKE $2)
       UNION ALL
       SELECT 'site', s.id, s.name,
         COALESCE(o.name, s.address, 'Client site'),
         '/staff/assets-risk?site=' || s.id::text
       FROM sites s
       JOIN organizations o ON o.id = s.organization_id
       WHERE ($1 = '' OR s.name ILIKE $2 OR s.address ILIKE $2 OR o.name ILIKE $2)
       UNION ALL
       SELECT 'invoice', i.id, COALESCE(i.invoice_number, 'Draft invoice'),
         concat_ws(' · ', o.name, initcap(i.status),
           to_char(i.total_cents / 100.0, 'FM999G999G990D00')),
         '/staff/billing?invoice=' || i.id::text
       FROM invoices i
       LEFT JOIN organizations o ON o.id = i.organization_id
       WHERE ($1 = '' OR i.invoice_number ILIKE $2 OR o.name ILIKE $2)
       UNION ALL
       SELECT 'quote', q.id, q.quote_number,
         concat_ws(' · ', o.name, initcap(replace(q.status, '_', ' '))),
         '/staff/quotes/' || q.id::text
       FROM quotes q
       JOIN organizations o ON o.id = q.organization_id
       WHERE ($1 = '' OR q.quote_number ILIKE $2 OR o.name ILIKE $2)
     ) entities
     WHERE ($3 = '' OR type = $3)
     ORDER BY
       CASE type WHEN 'customer' THEN 1 WHEN 'project' THEN 2 WHEN 'site' THEN 3 WHEN 'invoice' THEN 4 ELSE 5 END,
       label
     LIMIT 30`,
    [query, pattern, requestedType],
  );
  return json({ entities: result.rows });
}

async function staffChatSessionDetail(request: Request, sessionId: string) {
  const auth = await requireSteveAdminAccess(request);
  if (auth.response) return auth.response;

  if (request.method === "PATCH") {
    const body = await readJson(request);
    const status = requireOneOf(body.status, "Status", ["active", "archived"] as const);
    const result = await getPool().query(
      `UPDATE staff_chat_sessions
       SET status = $1, updated_at = now()
       WHERE id = $2 AND user_id = $3 AND status <> 'deleted'
       RETURNING id, title, status, created_at, updated_at, last_message_at`,
      [status, sessionId, auth.user.id],
    );
    if (!result.rows[0]) return json({ error: "Chat session not found" }, { status: 404 });
    await audit(
      getPool(),
      status === "archived" ? "archive_steve_chat_session" : "restore_steve_chat_session",
      "staff_chat_session",
      sessionId,
      {},
      auth.user,
    );
    return json({ session: result.rows[0] });
  }

  if (request.method === "DELETE") {
    const result = await getPool().query(
      `UPDATE staff_chat_sessions
       SET status = 'deleted', updated_at = now()
       WHERE id = $1 AND user_id = $2 AND status <> 'deleted'
       RETURNING id`,
      [sessionId, auth.user.id],
    );
    if (!result.rows[0]) return json({ error: "Chat session not found" }, { status: 404 });
    await audit(
      getPool(),
      "delete_steve_chat_session",
      "staff_chat_session",
      sessionId,
      {},
      auth.user,
    );
    return json({ ok: true });
  }

  return json({ error: "Not found" }, { status: 404 });
}

async function staffChatMessages(request: Request, sessionId: string) {
  const auth = await requireSteveAdminAccess(request);
  if (auth.response) return auth.response;

  const session = await getPool().query(
    "SELECT id, title, status FROM staff_chat_sessions WHERE id = $1 AND user_id = $2 AND status <> 'deleted'",
    [sessionId, auth.user.id],
  );
  if (!session.rows[0]) return json({ error: "Chat session not found" }, { status: 404 });
  if (request.method === "POST" && session.rows[0].status !== "active") {
    return json({ error: "Chat session is archived" }, { status: 409 });
  }

  if (request.method === "GET") {
    const [messages, attachments] = await Promise.all([
      getPool().query(
        `
        SELECT id, role, content, metadata, created_at
        FROM staff_chat_messages
        WHERE session_id = $1
        ORDER BY created_at
      `,
        [sessionId],
      ),
      getPool().query(
        `
        SELECT id, message_id, original_name, mime_type, size_bytes, status, created_at
        FROM staff_chat_attachments
        WHERE session_id = $1
        ORDER BY created_at
      `,
        [sessionId],
      ),
    ]);
    return json({
      session: session.rows[0],
      messages: messages.rows,
      attachments: attachments.rows,
    });
  }

  const body = await readJson(request);
  const content = requireText(body.content, "Message");
  const attachmentIds = Array.isArray(body.attachmentIds)
    ? body.attachmentIds.filter((value: unknown) => typeof value === "string")
    : [];
  const entityReferences = Array.isArray(body.entityReferences)
    ? body.entityReferences
        .filter(
          (value: unknown) =>
            value &&
            typeof value === "object" &&
            typeof (value as Record<string, unknown>).id === "string" &&
            typeof (value as Record<string, unknown>).type === "string" &&
            typeof (value as Record<string, unknown>).label === "string",
        )
        .slice(0, 12)
    : [];
  if (content.length > 12000) return json({ error: "Message is too long" }, { status: 400 });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const userMessage = await client.query(
      `INSERT INTO staff_chat_messages (session_id, role, content, metadata)
       VALUES ($1, 'user', $2, $3::jsonb)
       RETURNING id, role, content, metadata, created_at`,
      [sessionId, content, JSON.stringify({ attachmentIds, entityReferences })],
    );
    const attachmentRows = attachmentIds.length
      ? await client.query(
          `
          SELECT id, original_name, mime_type, size_bytes, extracted_text
          , stored_path
          FROM staff_chat_attachments
          WHERE session_id = $1 AND uploader_id = $2 AND id = ANY($3::uuid[])
        `,
          [sessionId, auth.user.id, attachmentIds],
        )
      : { rows: [] };
    if (attachmentRows.rows.length) {
      await client.query(
        "UPDATE staff_chat_attachments SET message_id = $1 WHERE id = ANY($2::uuid[]) AND session_id = $3",
        [userMessage.rows[0].id, attachmentRows.rows.map((row) => row.id), sessionId],
      );
    }
    await client.query(
      `UPDATE staff_chat_sessions
       SET title = CASE WHEN title IN ('New chat', 'New Hermes chat') THEN $1 ELSE title END,
           updated_at = now(),
           last_message_at = now()
       WHERE id = $2`,
      [titleFromMessage(content), sessionId],
    );
    await client.query("COMMIT");

    if (attachmentRows.rows.length && isOneDriveUploadRequest(content)) {
      let assistantContent: string;
      let uploadError: string | null = null;
      let uploaded: Record<string, unknown>[] = [];
      try {
        uploaded = await uploadChatAttachmentsToOneDrive(
          auth.user,
          attachmentRows.rows,
          requestedOneDriveFolder(content),
        );
        assistantContent = uploaded.length
          ? [
              `Uploaded ${uploaded.length} attachment${uploaded.length === 1 ? "" : "s"} to OneDrive.`,
              ...uploaded.map((item) =>
                item.webUrl
                  ? `- ${item.name}: ${item.webUrl}`
                  : `- ${item.name}: uploaded to OneDrive`,
              ),
            ].join("\n")
          : "I could not find a local chat attachment to upload to OneDrive.";
      } catch (error) {
        uploadError = error instanceof Error ? error.message : "OneDrive upload failed";
        assistantContent = `I could not upload the attachment to OneDrive. ${uploadError}`;
      }

      const assistant = await getPool().query(
        `INSERT INTO staff_chat_messages (session_id, role, content, metadata)
         VALUES ($1, 'assistant', $2, $3::jsonb)
         RETURNING id, role, content, metadata, created_at`,
        [
          sessionId,
          assistantContent,
          JSON.stringify({
            agent: "steve_microsoft_graph",
            action: "upload_chat_attachments_to_onedrive",
            uploaded,
            uploadError,
          }),
        ],
      );
      await getPool().query(
        "UPDATE staff_chat_sessions SET updated_at = now(), last_message_at = now() WHERE id = $1",
        [sessionId],
      );
      await audit(
        getPool(),
        "steve_chat_onedrive_upload",
        "staff_chat_session",
        sessionId,
        {
          userMessageId: userMessage.rows[0].id,
          assistantMessageId: assistant.rows[0].id,
          attachmentCount: attachmentRows.rows.length,
          uploadedCount: uploaded.length,
          uploadError,
        },
        auth.user,
      );
      return json({
        userMessage: userMessage.rows[0],
        assistantMessage: assistant.rows[0],
        agentError: uploadError,
      });
    }

    const context = await chatContextSummary(auth.user);
    const referencePrompt = entityReferences.length
      ? `\n\nThe user explicitly referenced these platform records:\n${entityReferences
          .map(
            (reference: Record<string, unknown>) =>
              `- ${reference.type}: ${reference.label} (record id: ${reference.id})`,
          )
          .join(
            "\n",
          )}\nUse these exact records as context; do not guess a different record with a similar name.`
      : "";
    const fullMessage = `${content}${referencePrompt}${attachmentPrompt(attachmentRows.rows)}`;
    const history = await getPool().query(
      `SELECT role, content, created_at
       FROM staff_chat_messages
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT 12`,
      [sessionId],
    );
    let agent: {
      sessionId?: string;
      message: { role: "assistant"; content: string };
      usage?: Record<string, unknown>;
      retrievedDocuments?: unknown[];
      actionResult?: Record<string, unknown> | null;
      requestedAction?: string | null;
    } | null = null;
    let agentError: string | null = null;
    try {
      agent = await staffAgentRequest<{
        sessionId?: string;
        message: { role: "assistant"; content: string };
        usage?: Record<string, unknown>;
        retrievedDocuments?: unknown[];
      }>(
        {
          sessionId,
          user: auth.user,
          message: fullMessage,
          history: history.rows.reverse(),
          attachments: attachmentRows.rows.map((row) => ({
            id: row.id,
            originalName: row.original_name,
            mimeType: row.mime_type,
            sizeBytes: row.size_bytes,
            extractedText:
              typeof row.extracted_text === "string" ? row.extracted_text.slice(0, 5000) : "",
          })),
          context,
        },
        auth.user,
      );
    } catch (error) {
      agentError = error instanceof Error ? error.message : "Steve unavailable";
    }

    const assistantContent =
      agent?.message?.content ||
      `Steve is temporarily unavailable. ${agentError || "Please try again shortly."}`;

    const assistant = await getPool().query(
      `INSERT INTO staff_chat_messages (session_id, role, content, metadata)
       VALUES ($1, 'assistant', $2, $3::jsonb)
       RETURNING id, role, content, metadata, created_at`,
      [
        sessionId,
        assistantContent,
        JSON.stringify({
          agent: "steve_n8n_gemini",
          agentSessionId: agent?.sessionId ?? sessionId,
          usage: agent?.usage ?? null,
          retrievedDocuments: agent?.retrievedDocuments ?? [],
          actionResult: agent?.actionResult ?? null,
          requestedAction: agent?.requestedAction ?? null,
          agentError,
        }),
      ],
    );
    await getPool().query(
      "UPDATE staff_chat_sessions SET updated_at = now(), last_message_at = now() WHERE id = $1",
      [sessionId],
    );
    await audit(
      getPool(),
      "steve_chat_turn",
      "staff_chat_session",
      sessionId,
      {
        userMessageId: userMessage.rows[0].id,
        assistantMessageId: assistant.rows[0].id,
        agentError,
      },
      auth.user,
    );
    return json({
      userMessage: userMessage.rows[0],
      assistantMessage: assistant.rows[0],
      agentError,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function staffChatStatus(request: Request) {
  const auth = await requireSteveAdminAccess(request);
  if (auth.response) return auth.response;

  try {
    const { statusUrl } = getStaffAgentConfig();
    const response = await fetch(statusUrl);
    const body = response.ok ? await response.json() : {};
    return json({ ok: response.ok, agent: { provider: "steve_n8n_gemini", status: body } });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Steve unavailable" },
      { status: 503 },
    );
  }
}

async function staffAgentUserFromBody(body: Record<string, unknown>) {
  const user = asRecord(body.user);
  const userId = optionalText(body.userId) ?? optionalText(user.id);
  if (!userId) return null;
  const result = await getPool().query(
    "SELECT id, email, name, role FROM app_users WHERE id = $1 AND role IN ('admin', 'staff', 'agent')",
    [userId],
  );
  const row = result.rows[0];
  return row
    ? ({
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
      } as User)
    : null;
}

async function internalStaffAgentContext(request: Request) {
  if (!verifyInternalAgentRequest(request)) return forbidden();
  const body = asRecord(await readJson(request));
  const user = await staffAgentUserFromBody(body);
  if (!user) return json({ error: "Valid staff user is required" }, { status: 400 });
  const message = optionalText(body.message) ?? "";
  const [context, microsoft, rag, deals, contacts, growth, projects, tasks] = await Promise.all([
    chatContextSummary(user),
    microsoftAgentMemory(user),
    message
      ? getPool().query(
          `SELECT entity_type, entity_id, content, metadata
           FROM embedding_documents
           WHERE search_vector @@ plainto_tsquery('english', $1)
           ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC
           LIMIT 8`,
          [message],
        )
      : Promise.resolve({ rows: [] }),
    getPool().query(`
      SELECT d.id, d.title, d.value_cents, d.currency, d.status, s.name AS stage_name,
        o.name AS organization_name, u.name AS owner_name, d.updated_at
      FROM deals d
      LEFT JOIN pipeline_stages s ON s.id = d.stage_id
      LEFT JOIN organizations o ON o.id = d.organization_id
      LEFT JOIN app_users u ON u.id = d.owner_id
      WHERE d.status = 'open'
      ORDER BY d.updated_at DESC
      LIMIT 20
    `),
    getPool().query(`
      SELECT c.id, c.first_name, c.last_name, c.email, c.lifecycle_stage, c.consent_status,
        c.do_not_contact, c.updated_at, o.name AS organization_name, u.name AS owner_name
      FROM contacts c
      LEFT JOIN organizations o ON o.id = c.organization_id
      LEFT JOIN app_users u ON u.id = c.owner_id
      ORDER BY c.updated_at DESC
      LIMIT 20
    `),
    getPool().query(`
      SELECT id, recommendation_type, title, body, status, created_at
      FROM ai_recommendations
      WHERE recommendation_type IN (
        'campaign_enrollment', 'quote_follow_up', 'dormant_reactivation',
        'partner_outreach', 'reply_handling', 'campaign_intelligence'
      )
      ORDER BY created_at DESC
      LIMIT 20
    `),
    getPool().query(`
      SELECT p.id, p.name, p.status, p.priority, p.due_on, p.budget_cents,
        o.name AS organization_name, d.title AS deal_title
      FROM projects p
      LEFT JOIN organizations o ON o.id = p.organization_id
      LEFT JOIN deals d ON d.id = p.deal_id
      ORDER BY p.updated_at DESC
      LIMIT 20
    `),
    getPool().query(`
      SELECT t.id, t.title, t.description, t.priority, t.status, t.due_at,
        u.name AS owner_name, o.name AS organization_name, d.title AS deal_title, p.name AS project_name
      FROM tasks t
      LEFT JOIN app_users u ON u.id = t.owner_id
      LEFT JOIN organizations o ON o.id = t.organization_id
      LEFT JOIN deals d ON d.id = t.deal_id
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.status IN ('open', 'blocked')
      ORDER BY t.due_at ASC NULLS LAST, t.updated_at DESC
      LIMIT 20
    `),
  ]);

  await audit(
    getPool(),
    "steve_chat_context_loaded",
    "app_user",
    user.id,
    {
      messageLength: message.length,
      ragMatches: rag.rows.length,
    },
    user,
  );

  return json({
    ok: true,
    user,
    context,
    microsoft,
    ragResults: rag.rows,
    deals: deals.rows,
    contacts: contacts.rows,
    growthRecommendations: growth.rows,
    projects: projects.rows,
    tasks: tasks.rows,
    allowedActions: [
      "create_recommendation",
      "create_task",
      "create_quote_template",
      "add_task_comment",
      "log_communication",
      "propose_deal_update",
      "propose_contact_update",
      "propose_project_update",
      "propose_growth_action",
      "read_microsoft_recent_emails",
      "read_microsoft_recent_docs",
      "create_microsoft_email_draft",
    ],
    policy:
      "Direct writes are limited to internal tasks, quote templates, comments, communication notes, and Microsoft Outlook draft creation for the signed-in user. Deal, contact, project, and growth changes must be approval recommendations. Microsoft email may be drafted but not sent automatically.",
  });
}

async function internalStaffAgentActions(request: Request) {
  if (!verifyInternalAgentRequest(request)) return forbidden();
  const body = asRecord(await readJson(request));
  const user = await staffAgentUserFromBody(body);
  if (!user) return json({ error: "Valid staff user is required" }, { status: 400 });
  const action = requireOneOf(body.action, "Action", [
    "create_recommendation",
    "create_task",
    "create_quote_template",
    "add_task_comment",
    "log_communication",
    "propose_deal_update",
    "propose_contact_update",
    "propose_project_update",
    "propose_growth_action",
    "read_microsoft_recent_emails",
    "read_microsoft_recent_docs",
    "create_microsoft_email_draft",
  ] as const);
  const payload = asRecord(body.payload);
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const toolCall = await client.query(
      `INSERT INTO tool_calls (source, tool_name, request, status)
       VALUES ('steve_chat', $1, $2::jsonb, 'received')
       RETURNING id`,
      [action, JSON.stringify({ userId: user.id, payload })],
    );

    let response: Record<string, unknown>;
    if (action === "read_microsoft_recent_emails") {
      const top = Math.min(25, Math.max(1, Number(payload.top ?? 10)));
      const data = await microsoftGraphRequest<{ value?: Record<string, unknown>[] }>(
        user,
        `/me/mailFolders/inbox/messages?$top=${top}&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,bodyPreview,isRead,webLink,importance`,
      );
      response = { emails: data.value ?? [] };
      await audit(
        client,
        "steve_chat_read_microsoft_emails",
        "app_user",
        user.id,
        { top, count: (data.value ?? []).length },
        user,
      );
    } else if (action === "read_microsoft_recent_docs") {
      const top = Math.min(25, Math.max(1, Number(payload.top ?? 10)));
      const data = await microsoftGraphRequest<{ value?: Record<string, unknown>[] }>(
        user,
        `/me/drive/recent?$top=${top}`,
      );
      response = { docs: data.value ?? [] };
      await audit(
        client,
        "steve_chat_read_microsoft_docs",
        "app_user",
        user.id,
        { top, count: (data.value ?? []).length },
        user,
      );
    } else if (action === "create_microsoft_email_draft") {
      const draft = await createMicrosoftEmailDraft(user, payload);
      response = { draft };
      await audit(
        client,
        "steve_chat_create_microsoft_email_draft",
        "app_user",
        user.id,
        { graphMessageId: draft.id ?? null },
        user,
      );
    } else if (action === "create_task") {
      const board = await ensureTaskBoard(client);
      const backlog = board.stages.find((stage) => stage.name === "Backlog") ?? board.stages[0];
      const requestedOwnerEmail = optionalText(payload.ownerEmail);
      const requestedOwnerName = optionalText(payload.ownerName);
      const requestedOwner =
        requestedOwnerEmail || requestedOwnerName
          ? await client.query(
              `SELECT id FROM app_users
             WHERE role IN ('admin', 'staff')
               AND (($1::text IS NOT NULL AND lower(email) = lower($1))
                 OR ($2::text IS NOT NULL AND lower(name) = lower($2)))
             ORDER BY CASE WHEN $1::text IS NOT NULL AND lower(email) = lower($1) THEN 0 ELSE 1 END
             LIMIT 1`,
              [requestedOwnerEmail, requestedOwnerName],
            )
          : null;
      const result = await client.query(
        `INSERT INTO tasks (
          board_id, stage_id, project_id, deal_id, organization_id, owner_id,
          title, description, priority, due_at, source
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'medium'), $10, 'steve_chat')
         RETURNING id`,
        [
          board.boardId,
          backlog.id,
          payload.projectId ?? null,
          payload.dealId ?? null,
          payload.organizationId ?? null,
          optionalText(payload.ownerId) ?? requestedOwner?.rows[0]?.id ?? user.id,
          requireText(payload.title, "Task title"),
          optionalText(payload.description),
          optionalText(payload.priority),
          optionalText(payload.dueAt),
        ],
      );
      response = { taskId: result.rows[0].id };
      await audit(client, "steve_chat_create_task", "task", result.rows[0].id, {}, user);
    } else if (action === "create_quote_template") {
      const result = await client.query(
        `INSERT INTO quote_templates (
          name, description, organization_id, site_id, source_quote_id,
          created_by, updated_by, template_data, active
         )
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7::jsonb, true)
         RETURNING id, name`,
        [
          optionalText(payload.name) ?? optionalText(payload.templateName) ?? "Quotation template",
          optionalText(payload.description) ??
            optionalText(payload.notes) ??
            optionalText(payload.body) ??
            "Quotation template",
          payload.organizationId ?? null,
          payload.siteId ?? null,
          optionalText(payload.sourceQuoteId),
          user.id,
          JSON.stringify({
            ...payload,
            name:
              optionalText(payload.name) ??
              optionalText(payload.templateName) ??
              "Quotation template",
          }),
        ],
      );
      response = { templateId: result.rows[0].id, templateName: result.rows[0].name };
      await audit(
        client,
        "steve_chat_create_quote_template",
        "quote_template",
        result.rows[0].id,
        {},
        user,
      );
    } else if (action === "add_task_comment") {
      const taskId = requireText(payload.taskId, "Task id");
      const result = await client.query(
        "INSERT INTO task_comments (task_id, author_id, body) VALUES ($1, $2, $3) RETURNING id",
        [taskId, user.id, requireText(payload.body, "Comment")],
      );
      await client.query("UPDATE tasks SET updated_at = now() WHERE id = $1", [taskId]);
      response = { commentId: result.rows[0].id };
      await audit(
        client,
        "steve_chat_add_task_comment",
        "task",
        taskId,
        {
          commentId: result.rows[0].id,
        },
        user,
      );
    } else if (action === "log_communication") {
      const bodyText = requireText(payload.body, "Body");
      const result = await client.query(
        `INSERT INTO communications (
          deal_id, contact_id, organization_id, project_id, task_id,
          direction, channel, subject, body, summary
         )
         VALUES ($1, $2, $3, $4, $5, 'internal', 'steve_chat', $6, $7, $8)
         RETURNING id`,
        [
          payload.dealId ?? null,
          payload.contactId ?? null,
          payload.organizationId ?? null,
          payload.projectId ?? null,
          payload.taskId ?? null,
          optionalText(payload.subject) ?? "Steve note",
          bodyText,
          optionalText(payload.summary) ?? bodyText.slice(0, 240),
        ],
      );
      response = { communicationId: result.rows[0].id };
      await audit(
        client,
        "steve_chat_log_communication",
        "communication",
        result.rows[0].id,
        {},
        user,
      );
    } else {
      const recommendationType =
        action === "create_recommendation"
          ? (optionalText(payload.recommendationType) ?? "steve_chat_recommendation")
          : action;
      const title =
        optionalText(payload.title) ?? `${action.replaceAll("_", " ")} requires approval`;
      const recommendationBody =
        optionalText(payload.body) ??
        "Steve proposed a platform change that requires staff review before execution.";
      const result = await client.query(
        `INSERT INTO ai_recommendations (
          deal_id, contact_id, organization_id, project_id, task_id,
          recommendation_type, title, body, requires_approval, payload
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9::jsonb)
         RETURNING id`,
        [
          payload.dealId ?? null,
          payload.contactId ?? null,
          payload.organizationId ?? null,
          payload.projectId ?? null,
          payload.taskId ?? null,
          recommendationType,
          title,
          recommendationBody,
          JSON.stringify({
            source: "steve_chat",
            requestedAction: action,
            requestedBy: user.email,
            proposedChange: asRecord(payload.proposedChange),
            metadata: asRecord(payload.metadata),
          }),
        ],
      );
      response = { recommendationId: result.rows[0].id, approvalRequired: true };
      await audit(
        client,
        "steve_chat_create_recommendation",
        "ai_recommendation",
        result.rows[0].id,
        { requestedAction: action },
        user,
      );
    }

    await client.query(
      "UPDATE tool_calls SET response = $1::jsonb, status = 'completed' WHERE id = $2",
      [JSON.stringify(response), toolCall.rows[0].id],
    );
    await client.query("COMMIT");
    return json({ ok: true, ...response }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function textFromUpload(buffer: Buffer, mimeType: string, filename: string) {
  const lower = filename.toLowerCase();
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text.split("\u0000").join("").slice(0, 24000) || null;
    } catch {
      return null;
    } finally {
      await parser.destroy();
    }
  }
  const textLike =
    mimeType.startsWith("text/") ||
    ["application/json", "text/csv"].includes(mimeType) ||
    /\.(txt|md|csv|json|log)$/i.test(lower);
  if (!textLike) return null;
  return buffer.toString("utf8").split("\u0000").join("").slice(0, 24000);
}

async function staffChatUpload(request: Request) {
  const auth = await requireSteveAdminAccess(request);
  if (auth.response) return auth.response;

  const form = await request.formData();
  const sessionId = String(form.get("sessionId") ?? "");
  if (!sessionId) return json({ error: "sessionId is required" }, { status: 400 });
  const session = await getPool().query(
    "SELECT id FROM staff_chat_sessions WHERE id = $1 AND user_id = $2",
    [sessionId, auth.user.id],
  );
  if (!session.rows[0]) return json({ error: "Chat session not found" }, { status: 404 });

  const files = form.getAll("files").filter((item): item is File => item instanceof File);
  if (!files.length) return json({ error: "No files uploaded" }, { status: 400 });
  if (files.length > 5) return json({ error: "Upload up to 5 files at a time" }, { status: 400 });

  const uploadDir = process.env.CHAT_UPLOAD_DIR || path.resolve(process.cwd(), "uploads/chat");
  await mkdir(uploadDir, { recursive: true });

  const saved = [];
  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) {
      return json({ error: `${file.name} exceeds the 20MB limit` }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const id = crypto.randomUUID();
    const extension = path
      .extname(file.name)
      .replace(/[^a-zA-Z0-9.]/g, "")
      .slice(0, 12);
    const storedPath = path.join(uploadDir, `${id}${extension}`);
    await writeFile(storedPath, buffer);
    const extractedText = await textFromUpload(
      buffer,
      file.type || "application/octet-stream",
      file.name,
    );
    const result = await getPool().query(
      `INSERT INTO staff_chat_attachments (
        id, session_id, uploader_id, original_name, stored_path, mime_type, size_bytes, extracted_text, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       RETURNING id, original_name, mime_type, size_bytes, status, created_at`,
      [
        id,
        sessionId,
        auth.user.id,
        file.name,
        storedPath,
        file.type || "application/octet-stream",
        file.size,
        extractedText,
        JSON.stringify({ extracted: Boolean(extractedText) }),
      ],
    );
    saved.push(result.rows[0]);
  }
  await audit(
    getPool(),
    "upload_steve_chat_attachment",
    "staff_chat_session",
    sessionId,
    { count: saved.length },
    auth.user,
  );
  return json({ attachments: saved }, { status: 201 });
}

type ChecklistResponseType = "pass_fail_na" | "pass_fail_defective" | "freeform" | "numeric";
type InspectionRiskLevel = "low" | "medium" | "high" | "critical";

const checklistResponseTypes: ChecklistResponseType[] = [
  "pass_fail_na",
  "pass_fail_defective",
  "freeform",
  "numeric",
];
const inspectionRiskLevels: InspectionRiskLevel[] = ["low", "medium", "high", "critical"];

function checklistRiskLevel(weight: number): InspectionRiskLevel {
  if (weight >= 4) return "critical";
  if (weight === 3) return "high";
  if (weight === 2) return "medium";
  return "low";
}

function checklistItemsInput(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("At least one checklist item is required");
  }
  if (value.length > 250) throw new Error("Checklist templates are limited to 250 items");

  return value.map((rawItem, index) => {
    const item = asRecord(rawItem);
    const responseType = optionalText(item.responseType ?? item.response_type) ?? "pass_fail_na";
    if (!checklistResponseTypes.includes(responseType as ChecklistResponseType)) {
      throw new Error(`Invalid response type for checklist item ${index + 1}`);
    }
    const riskWeight = optionalNumber(item.riskWeight ?? item.risk_weight) ?? 1;
    if (!Number.isInteger(riskWeight) || riskWeight < 1 || riskWeight > 4) {
      throw new Error(`Risk weight for checklist item ${index + 1} must be an integer from 1 to 4`);
    }
    return {
      position: optionalNumber(item.position) ?? index + 1,
      itemText: requireText(item.itemText ?? item.item_text, `Checklist item ${index + 1} text`),
      sansClause: optionalText(item.sansClause ?? item.sans_clause),
      responseType,
      required: item.required === undefined ? true : Boolean(item.required),
      photoRequired: Boolean(item.photoRequired ?? item.photo_required),
      riskWeight,
    };
  });
}

async function checklistTemplatePayload(client: pg.Pool | pg.PoolClient, templateId: string) {
  const template = await client.query(
    `SELECT id, template_family_id, name, version, status, category, applicable_asset_type,
      sans_standard, effective_from, effective_to, created_by, created_at
     FROM checklist_templates
     WHERE id = $1`,
    [templateId],
  );
  if (!template.rows[0]) return null;
  const items = await client.query(
    `SELECT id, position, item_text, sans_clause, response_type, required, photo_required, risk_weight
     FROM checklist_template_items
     WHERE template_id = $1
     ORDER BY position`,
    [templateId],
  );
  return { ...template.rows[0], items: items.rows };
}

async function checklistTemplates(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  if (request.method === "POST") {
    const body = asRecord(await readJson(request));
    const items = checklistItemsInput(body.items);
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO checklist_templates (
          name, version, status, category, applicable_asset_type, sans_standard,
          effective_from, effective_to, created_by
        )
        VALUES ($1, 1, COALESCE($2, 'draft'), $3, $4, COALESCE($5, 'SANS 10139'), $6, $7, $8)
        RETURNING id, template_family_id, version`,
        [
          requireText(body.name, "Template name"),
          optionalText(body.status),
          requireText(body.category, "Template category"),
          optionalText(body.applicableAssetType ?? body.applicable_asset_type),
          optionalText(body.sansStandard ?? body.sans_standard),
          optionalText(body.effectiveFrom ?? body.effective_from),
          optionalText(body.effectiveTo ?? body.effective_to),
          auth.user.id,
        ],
      );
      for (const item of items) {
        await client.query(
          `INSERT INTO checklist_template_items (
            template_id, position, item_text, sans_clause, response_type, required, photo_required, risk_weight
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            result.rows[0].id,
            item.position,
            item.itemText,
            item.sansClause,
            item.responseType,
            item.required,
            item.photoRequired,
            item.riskWeight,
          ],
        );
      }
      await client.query("COMMIT");
      return json(
        { ok: true, template: await checklistTemplatePayload(getPool(), result.rows[0].id) },
        { status: 201 },
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  const url = new URL(request.url);
  const status = optionalText(url.searchParams.get("status"));
  const assetType = optionalText(url.searchParams.get("asset_type"));
  const conditions = ["1 = 1"];
  const values: string[] = [];
  if (status) {
    values.push(status);
    conditions.push(`ct.status = $${values.length}`);
  }
  if (assetType) {
    values.push(assetType);
    conditions.push(
      `(ct.applicable_asset_type IS NULL OR ct.applicable_asset_type = $${values.length})`,
    );
  }
  const result = await getPool().query(
    `SELECT ct.id, ct.template_family_id, ct.name, ct.version, ct.status, ct.category,
      ct.applicable_asset_type, ct.sans_standard, ct.effective_from, ct.effective_to,
      ct.created_by, ct.created_at, count(cti.id)::int AS item_count
     FROM checklist_templates ct
     LEFT JOIN checklist_template_items cti ON cti.template_id = ct.id
     WHERE ${conditions.join(" AND ")}
     GROUP BY ct.id
     ORDER BY ct.category, ct.name, ct.version DESC`,
    values,
  );
  return json({ templates: result.rows });
}

async function checklistTemplateDetail(request: Request, templateId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const template = await checklistTemplatePayload(getPool(), templateId);
  return template
    ? json({ template })
    : json({ error: "Checklist template not found" }, { status: 404 });
}

async function checklistTemplateVersion(request: Request, templateId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = asRecord(await readJson(request));
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const source = await client.query(
      "SELECT * FROM checklist_templates WHERE id = $1 FOR UPDATE",
      [templateId],
    );
    const sourceRow = source.rows[0];
    if (!sourceRow) {
      await client.query("ROLLBACK");
      return json({ error: "Checklist template not found" }, { status: 404 });
    }
    const items =
      body.items === undefined
        ? (
            await client.query(
              "SELECT * FROM checklist_template_items WHERE template_id = $1 ORDER BY position",
              [templateId],
            )
          ).rows
        : body.items;
    const normalizedItems = checklistItemsInput(items);
    const nextVersion = Number(
      (
        await client.query(
          "SELECT COALESCE(MAX(version), 0) + 1 AS version FROM checklist_templates WHERE template_family_id = $1",
          [sourceRow.template_family_id],
        )
      ).rows[0].version,
    );
    const status = optionalText(body.status) ?? "draft";
    if (status === "active") {
      await client.query(
        "UPDATE checklist_templates SET status = 'retired', effective_to = COALESCE(effective_to, current_date) WHERE template_family_id = $1 AND status = 'active'",
        [sourceRow.template_family_id],
      );
    }
    const inserted = await client.query(
      `INSERT INTO checklist_templates (
        template_family_id, name, version, status, category, applicable_asset_type, sans_standard,
        effective_from, effective_to, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        sourceRow.template_family_id,
        optionalText(body.name) ?? sourceRow.name,
        nextVersion,
        status,
        optionalText(body.category) ?? sourceRow.category,
        optionalText(body.applicableAssetType ?? body.applicable_asset_type) ??
          sourceRow.applicable_asset_type,
        optionalText(body.sansStandard ?? body.sans_standard) ?? sourceRow.sans_standard,
        optionalText(body.effectiveFrom ?? body.effective_from) ??
          (status === "active" ? new Date().toISOString().slice(0, 10) : sourceRow.effective_from),
        optionalText(body.effectiveTo ?? body.effective_to) ?? null,
        auth.user.id,
      ],
    );
    for (const item of normalizedItems) {
      await client.query(
        `INSERT INTO checklist_template_items (
          template_id, position, item_text, sans_clause, response_type, required, photo_required, risk_weight
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          inserted.rows[0].id,
          item.position,
          item.itemText,
          item.sansClause,
          item.responseType,
          item.required,
          item.photoRequired,
          item.riskWeight,
        ],
      );
    }
    await client.query("COMMIT");
    return json(
      { ok: true, template: await checklistTemplatePayload(getPool(), inserted.rows[0].id) },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function inspectionContext(client: pg.Pool | pg.PoolClient, inspectionId: string) {
  const result = await client.query(
    `SELECT i.*, ct.name AS template_name, ct.category AS template_category
     FROM inspections i
     JOIN checklist_templates ct ON ct.id = i.checklist_template_id
     WHERE i.id = $1`,
    [inspectionId],
  );
  return result.rows[0] ?? null;
}

async function recalculateInspection(client: pg.Pool | pg.PoolClient, inspectionId: string) {
  const result = await client.query(
    `SELECT iir.outcome, cti.required, cti.risk_weight
     FROM inspection_item_responses iir
     JOIN checklist_template_items cti ON cti.id = iir.checklist_template_item_id
     WHERE iir.inspection_id = $1`,
    [inspectionId],
  );
  const defective = result.rows.filter((row) => row.outcome === "defective");
  const requiredDefective = defective.some((row) => row.required);
  const maxWeight = defective.reduce((max, row) => Math.max(max, Number(row.risk_weight) || 1), 1);
  const computedRiskLevel = defective.length ? checklistRiskLevel(maxWeight) : "low";
  const inspection = await client.query(
    "SELECT risk_level_override FROM inspections WHERE id = $1",
    [inspectionId],
  );
  const override = inspection.rows[0]?.risk_level_override as
    | InspectionRiskLevel
    | null
    | undefined;
  const outcome = requiredDefective ? "fail" : "pass";
  await client.query(
    `UPDATE inspections
     SET computed_risk_level = $2, risk_level = COALESCE($3, $2), outcome = $4, updated_at = now()
     WHERE id = $1`,
    [inspectionId, computedRiskLevel, override, outcome],
  );
  return { computedRiskLevel, riskLevel: override ?? computedRiskLevel, outcome };
}

async function createInspection(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = asRecord(await readJson(request));
  const assetId = requireText(body.assetId ?? body.asset_id, "Asset id");
  const templateId = requireText(
    body.checklistTemplateId ?? body.checklist_template_id,
    "Checklist template id",
  );
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const template = await client.query(
      "SELECT id, version, status FROM checklist_templates WHERE id = $1",
      [templateId],
    );
    if (!template.rows[0] || template.rows[0].status === "retired") {
      await client.query("ROLLBACK");
      return json({ error: "Checklist template version is not available" }, { status: 409 });
    }
    const asset = await client.query(
      `SELECT id, organization_id, site_id, building_id, floor_id, area_id
       FROM assets WHERE id = $1`,
      [assetId],
    );
    if (!asset.rows[0]) {
      await client.query("ROLLBACK");
      return json({ error: "Asset not found" }, { status: 404 });
    }
    const areaId = optionalText(body.areaId ?? body.area_id);
    if (areaId) {
      const area = await client.query("SELECT id FROM areas WHERE id = $1 AND site_id = $2", [
        areaId,
        asset.rows[0].site_id,
      ]);
      if (!area.rows[0]) {
        await client.query("ROLLBACK");
        return json({ error: "Area does not belong to the asset site" }, { status: 400 });
      }
    }
    const inserted = await client.query(
      `INSERT INTO inspections (
        checklist_template_id, checklist_template_version, organization_id, site_id, asset_id, area_id,
        work_item_id, service_report_id, technician_user_id, started_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, now())) RETURNING id`,
      [
        templateId,
        template.rows[0].version,
        asset.rows[0].organization_id,
        asset.rows[0].site_id,
        assetId,
        areaId,
        optionalText(body.workItemId ?? body.work_item_id),
        optionalText(body.serviceReportId ?? body.service_report_id),
        auth.user.id,
        optionalText(body.startedAt ?? body.started_at),
      ],
    );
    await client.query("COMMIT");
    return json(
      {
        ok: true,
        inspectionId: inserted.rows[0].id,
        checklistTemplateVersion: template.rows[0].version,
      },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function inspectionCaptureContext(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const organizationId = optionalText(url.searchParams.get("organization_id"));
  const siteId = optionalText(url.searchParams.get("site_id"));
  const [organizations, sites, buildings, floors, areas, assets] = await Promise.all([
    getPool().query("SELECT id, name FROM organizations ORDER BY name LIMIT 500"),
    getPool().query(
      `SELECT id, organization_id, name, address FROM sites
       WHERE ($1::uuid IS NULL OR organization_id = $1) ORDER BY name LIMIT 500`,
      [organizationId],
    ),
    getPool().query(
      `SELECT id, site_id, name FROM buildings
       WHERE ($1::uuid IS NULL OR site_id = $1) ORDER BY name LIMIT 500`,
      [siteId],
    ),
    getPool().query(
      `SELECT f.id, f.building_id, b.site_id, f.name, f.level_number
       FROM floors f JOIN buildings b ON b.id = f.building_id
       WHERE ($1::uuid IS NULL OR b.site_id = $1) ORDER BY b.name, f.level_number NULLS LAST, f.name LIMIT 1000`,
      [siteId],
    ),
    getPool().query(
      `SELECT id, site_id, building_id, floor_id, name, area_type
       FROM areas WHERE ($1::uuid IS NULL OR site_id = $1) ORDER BY name LIMIT 1000`,
      [siteId],
    ),
    getPool().query(
      `SELECT id, organization_id, site_id, building_id, floor_id, area_id, asset_tag, name,
        asset_type, manufacturer, model, serial_number, system_family, status, installed_on, notes
       FROM assets
       WHERE ($1::uuid IS NULL OR site_id = $1)
       ORDER BY name LIMIT 2000`,
      [siteId],
    ),
  ]);
  return json({
    organizations: organizations.rows,
    sites: sites.rows,
    buildings: buildings.rows,
    floors: floors.rows,
    areas: areas.rows,
    assets: assets.rows,
  });
}

async function inspectionsList(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const assetId = optionalText(url.searchParams.get("asset_id"));
  const siteId = optionalText(url.searchParams.get("site_id"));
  const status = optionalText(url.searchParams.get("status"));
  const result = await getPool().query(
    `SELECT i.id, i.checklist_template_id, i.checklist_template_version, i.asset_id, i.area_id,
      i.technician_user_id, i.started_at, i.completed_at, i.risk_level, i.computed_risk_level,
      i.outcome, i.status, i.updated_at, ct.name AS template_name, ct.category AS template_category,
      a.name AS asset_name, a.asset_type, s.name AS site_name, o.name AS organization_name
     FROM inspections i
     JOIN checklist_templates ct ON ct.id = i.checklist_template_id
     LEFT JOIN assets a ON a.id = i.asset_id
     LEFT JOIN sites s ON s.id = i.site_id
     LEFT JOIN organizations o ON o.id = i.organization_id
     WHERE ($1::uuid IS NULL OR i.asset_id = $1)
       AND ($2::uuid IS NULL OR i.site_id = $2)
       AND ($3::text IS NULL OR i.status = $3)
     ORDER BY i.updated_at DESC LIMIT 500`,
    [assetId, siteId, status],
  );
  return json({ inspections: result.rows });
}

async function inspectionDetail(request: Request, inspectionId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const inspection = await inspectionContext(getPool(), inspectionId);
  if (!inspection) return json({ error: "Inspection not found" }, { status: 404 });
  const [items, evidence, signature] = await Promise.all([
    getPool().query(
      `SELECT cti.id, cti.position, cti.item_text, cti.sans_clause, cti.response_type,
        cti.required, cti.photo_required, cti.risk_weight,
        iir.id AS response_id, iir.outcome, iir.comment, iir.na_reason, iir.numeric_value,
        iir.responded_by_user_id, iir.responded_at, iir.ai_compliance_result,
        iir.ai_compliance_rationale, iir.ai_compliance_checked_at
       FROM checklist_template_items cti
       LEFT JOIN inspection_item_responses iir
         ON iir.checklist_template_item_id = cti.id AND iir.inspection_id = $1
       WHERE cti.template_id = $2 ORDER BY cti.position`,
      [inspectionId, inspection.checklist_template_id],
    ),
    getPool().query(
      `SELECT id, file_name, mime_type, inspection_item_response_id, capture_timestamp,
        gps_lat, gps_lng, location_text, created_at
       FROM evidence_files WHERE inspection_id = $1 ORDER BY created_at`,
      [inspectionId],
    ),
    getPool().query(
      `SELECT id, signer_user_id, signer_name, signature_data, signed_at
       FROM inspection_signatures WHERE inspection_id = $1`,
      [inspectionId],
    ),
  ]);
  return json({
    inspection,
    items: items.rows,
    evidence: evidence.rows,
    signature: signature.rows[0] ?? null,
  });
}

async function saveInspectionSignature(request: Request, inspectionId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = asRecord(await readJson(request));
  const inspection = await inspectionContext(getPool(), inspectionId);
  if (!inspection) return json({ error: "Inspection not found" }, { status: 404 });
  if (inspection.status !== "completed")
    return json({ error: "Inspection must be completed before signing" }, { status: 409 });
  const signerName = requireText(body.signerName, "Signer name");
  const signatureData = asRecord(body.signatureData);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO inspection_signatures (inspection_id, signer_user_id, signer_name, signature_data)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (inspection_id) DO UPDATE SET
         signer_user_id = EXCLUDED.signer_user_id, signer_name = EXCLUDED.signer_name,
         signature_data = EXCLUDED.signature_data, signed_at = now()
       RETURNING id, signer_name, signed_at`,
      [inspectionId, auth.user.id, signerName, JSON.stringify(signatureData)],
    );
    await client.query(
      "UPDATE inspections SET signature_id = $2, updated_at = now() WHERE id = $1",
      [inspectionId, result.rows[0].id],
    );
    await client.query("COMMIT");
    return json({ ok: true, signature: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function inspectionResponses(request: Request, inspectionId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = asRecord(await readJson(request));
  const inputs = Array.isArray(body.responses) ? body.responses : [body];
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const inspection = await inspectionContext(client, inspectionId);
    if (!inspection) {
      await client.query("ROLLBACK");
      return json({ error: "Inspection not found" }, { status: 404 });
    }
    if (inspection.status !== "in_progress") {
      await client.query("ROLLBACK");
      return json({ error: "Only in-progress inspections can be edited" }, { status: 409 });
    }
    for (const rawResponse of inputs) {
      const response = asRecord(rawResponse);
      const itemId = requireText(
        response.checklistTemplateItemId ?? response.checklist_template_item_id ?? response.itemId,
        "Checklist item id",
      );
      const item = await client.query(
        `SELECT id, response_type FROM checklist_template_items WHERE id = $1 AND template_id = $2`,
        [itemId, inspection.checklist_template_id],
      );
      if (!item.rows[0])
        throw Object.assign(new Error("Checklist item is not part of this inspection template"), {
          status: 400,
        });
      const outcome = optionalText(response.outcome);
      if (outcome && !["ok", "defective", "na"].includes(outcome)) {
        throw Object.assign(new Error("Outcome must be ok, defective, or na"), { status: 400 });
      }
      const naReason = optionalText(response.naReason ?? response.na_reason);
      const comment = optionalText(response.comment);
      if (outcome === "na" && !naReason && !comment) {
        throw Object.assign(new Error("A reason is required when an item is marked N/A"), {
          status: 400,
        });
      }
      if (
        item.rows[0].response_type === "numeric" &&
        optionalNumber(response.numericValue ?? response.numeric_value) === null
      ) {
        throw Object.assign(new Error("A numeric value is required for this item"), {
          status: 400,
        });
      }
      await client.query(
        `INSERT INTO inspection_item_responses (
          inspection_id, checklist_template_item_id, outcome, comment, na_reason, numeric_value,
          responded_by_user_id, responded_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
        ON CONFLICT (inspection_id, checklist_template_item_id) DO UPDATE SET
          outcome = EXCLUDED.outcome, comment = EXCLUDED.comment, na_reason = EXCLUDED.na_reason,
          numeric_value = EXCLUDED.numeric_value, responded_by_user_id = EXCLUDED.responded_by_user_id,
          responded_at = now(), ai_processed = false`,
        [
          inspectionId,
          itemId,
          outcome,
          comment,
          naReason,
          optionalNumber(response.numericValue ?? response.numeric_value),
          auth.user.id,
        ],
      );
    }
    const rollup = await recalculateInspection(client, inspectionId);
    await client.query("COMMIT");
    return json({ ok: true, ...rollup });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function inspectionEvidence(request: Request, inspectionId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const inspection = await inspectionContext(getPool(), inspectionId);
  if (!inspection) return json({ error: "Inspection not found" }, { status: 404 });
  if (inspection.status !== "in_progress")
    return json({ error: "Only in-progress inspections accept evidence" }, { status: 409 });

  const form = await request.formData();
  const files = [...form.getAll("files"), form.get("file")].filter(
    (item): item is File => item instanceof File,
  );
  if (!files.length) return json({ error: "Attach at least one file" }, { status: 400 });
  if (files.length > 10)
    return json({ error: "Upload up to 10 evidence files at a time" }, { status: 400 });
  const responseId = optionalText(
    form.get("inspectionItemResponseId") ?? form.get("inspection_item_response_id"),
  );
  if (responseId) {
    const response = await getPool().query(
      "SELECT id FROM inspection_item_responses WHERE id = $1 AND inspection_id = $2",
      [responseId, inspectionId],
    );
    if (!response.rows[0])
      return json({ error: "Inspection item response not found" }, { status: 400 });
  }
  const complianceContext = responseId
    ? (
        await getPool().query(
          `SELECT cti.item_text, ct.category
       FROM inspection_item_responses iir
       JOIN checklist_template_items cti ON cti.id = iir.checklist_template_item_id
       JOIN checklist_templates ct ON ct.id = cti.template_id
       WHERE iir.id = $1 AND iir.inspection_id = $2`,
          [responseId, inspectionId],
        )
      ).rows[0]
    : null;
  const captureTimestamp = optionalText(
    form.get("captureTimestamp") ?? form.get("capture_timestamp"),
  );
  const latitude = optionalNumber(form.get("gpsLat") ?? form.get("gps_lat"));
  const longitude = optionalNumber(form.get("gpsLng") ?? form.get("gps_lng"));
  const capturePhase = optionalText(form.get("capturePhase") ?? form.get("capture_phase"));
  if (capturePhase && !["before", "during", "after"].includes(capturePhase))
    return json({ error: "Invalid capture phase" }, { status: 400 });
  if (latitude !== null && (latitude < -90 || latitude > 90))
    return json({ error: "Invalid GPS latitude" }, { status: 400 });
  if (longitude !== null && (longitude < -180 || longitude > 180))
    return json({ error: "Invalid GPS longitude" }, { status: 400 });
  const uploadDir =
    process.env.INSPECTION_UPLOAD_DIR || path.resolve(process.cwd(), "uploads/inspections");
  await mkdir(uploadDir, { recursive: true });
  const saved = [];
  for (const file of files) {
    if (file.size > 20 * 1024 * 1024)
      return json({ error: `${file.name} exceeds the 20MB limit` }, { status: 400 });
    const id = crypto.randomUUID();
    const extension = path
      .extname(file.name)
      .replace(/[^a-zA-Z0-9.]/g, "")
      .slice(0, 12);
    const storedPath = path.join(uploadDir, `${id}${extension}`);
    await writeFile(storedPath, Buffer.from(await file.arrayBuffer()));
    const result = await getPool().query(
      `INSERT INTO evidence_files (
        id, organization_id, site_id, asset_id, work_item_id, uploaded_by, evidence_type,
        file_name, file_path, mime_type, inspection_id, inspection_item_response_id,
        capture_timestamp, gps_lat, gps_lng, location_text, capture_phase, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, 'photo', $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
      RETURNING id, file_name, mime_type, created_at`,
      [
        id,
        inspection.organization_id,
        inspection.site_id,
        inspection.asset_id,
        inspection.work_item_id,
        auth.user.id,
        file.name,
        storedPath,
        file.type || "application/octet-stream",
        inspectionId,
        responseId,
        captureTimestamp,
        latitude,
        longitude,
        optionalText(form.get("locationText") ?? form.get("location_text")),
        capturePhase,
        JSON.stringify({ storage: "local_volume", originalSizeBytes: file.size }),
      ],
    );
    saved.push(result.rows[0]);
  }
  if (responseId && complianceContext && isDocumentationCategory(complianceContext.category)) {
    const compliance = await checkDocumentationPhotoCompliance(files, complianceContext.item_text);
    await getPool().query(
      `UPDATE inspection_item_responses
       SET ai_compliance_result = $2, ai_compliance_rationale = $3,
           ai_compliance_checked_at = now(), ai_compliance_error = $4
       WHERE id = $1`,
      [responseId, compliance.result, compliance.rationale, compliance.error],
    );
  }
  return json({ ok: true, evidence: saved }, { status: 201 });
}

async function assetEvidence(request: Request, assetId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const asset = await getPool().query(
    "SELECT id, organization_id, site_id FROM assets WHERE id = $1",
    [assetId],
  );
  if (!asset.rows[0]) return json({ error: "Asset not found" }, { status: 404 });
  const form = await request.formData();
  const files = [...form.getAll("files"), ...form.getAll("file")].filter(
    (item): item is File => item instanceof File,
  );
  if (!files.length) return json({ error: "Attach at least one asset photo" }, { status: 400 });
  if (files.length > 10)
    return json({ error: "Upload up to 10 asset photos at a time" }, { status: 400 });
  const latitude = optionalNumber(form.get("gpsLat") ?? form.get("gps_lat"));
  const longitude = optionalNumber(form.get("gpsLng") ?? form.get("gps_lng"));
  const capturePhase = optionalText(form.get("capturePhase") ?? form.get("capture_phase"));
  if (capturePhase && !["before", "during", "after"].includes(capturePhase))
    return json({ error: "Invalid capture phase" }, { status: 400 });
  if (latitude !== null && (latitude < -90 || latitude > 90))
    return json({ error: "Invalid GPS latitude" }, { status: 400 });
  if (longitude !== null && (longitude < -180 || longitude > 180))
    return json({ error: "Invalid GPS longitude" }, { status: 400 });
  const uploadDir =
    process.env.INSPECTION_UPLOAD_DIR || path.resolve(process.cwd(), "uploads/inspections");
  await mkdir(uploadDir, { recursive: true });
  const saved = [];
  for (const file of files) {
    if (file.size > 20 * 1024 * 1024)
      return json({ error: `${file.name} exceeds the 20MB limit` }, { status: 400 });
    const id = crypto.randomUUID();
    const extension = path
      .extname(file.name)
      .replace(/[^a-zA-Z0-9.]/g, "")
      .slice(0, 12);
    const storedPath = path.join(uploadDir, `${id}${extension}`);
    await writeFile(storedPath, Buffer.from(await file.arrayBuffer()));
    const result = await getPool().query(
      `INSERT INTO evidence_files (
        id, organization_id, site_id, asset_id, uploaded_by, evidence_type,
        file_name, file_path, mime_type, capture_timestamp, gps_lat, gps_lng, location_text, capture_phase, metadata
      ) VALUES ($1, $2, $3, $4, $5, 'photo', $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
      RETURNING id, file_name, mime_type, created_at`,
      [
        id,
        asset.rows[0].organization_id,
        asset.rows[0].site_id,
        assetId,
        auth.user.id,
        file.name,
        storedPath,
        file.type || "application/octet-stream",
        optionalText(form.get("captureTimestamp") ?? form.get("capture_timestamp")),
        latitude,
        longitude,
        optionalText(form.get("locationText") ?? form.get("location_text")),
        capturePhase,
        JSON.stringify({
          storage: "local_volume",
          source: "asset_creation",
          originalSizeBytes: file.size,
        }),
      ],
    );
    saved.push(result.rows[0]);
  }
  return json({ ok: true, evidence: saved }, { status: 201 });
}

async function completeInspection(request: Request, inspectionId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = asRecord(await readJson(request));
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const inspection = await inspectionContext(client, inspectionId);
    if (!inspection) {
      await client.query("ROLLBACK");
      return json({ error: "Inspection not found" }, { status: 404 });
    }
    if (inspection.status !== "in_progress") {
      await client.query("ROLLBACK");
      return json({ error: "Inspection is not in progress" }, { status: 409 });
    }
    const override = optionalText(body.riskLevelOverride ?? body.risk_level_override);
    const overrideReason = optionalText(
      body.riskLevelOverrideReason ?? body.risk_level_override_reason,
    );
    if (override && !inspectionRiskLevels.includes(override as InspectionRiskLevel)) {
      throw Object.assign(new Error("Invalid risk level override"), { status: 400 });
    }
    if (override && !overrideReason) {
      throw Object.assign(new Error("A reason is required for a risk level override"), {
        status: 400,
      });
    }
    if (override) {
      await client.query(
        "UPDATE inspections SET risk_level_override = $2, risk_level_override_reason = $3, updated_at = now() WHERE id = $1",
        [inspectionId, override, overrideReason],
      );
    }
    const missing = await client.query(
      `SELECT cti.id, cti.position, cti.item_text, cti.required, cti.photo_required,
        iir.id AS response_id, iir.outcome, iir.comment, iir.na_reason,
        COALESCE(ef.evidence_count, 0)::int AS evidence_count
       FROM checklist_template_items cti
       LEFT JOIN inspection_item_responses iir
         ON iir.checklist_template_item_id = cti.id AND iir.inspection_id = $1
       LEFT JOIN LATERAL (
         SELECT count(*) AS evidence_count
         FROM evidence_files ef
         WHERE ef.inspection_id = $1 AND ef.inspection_item_response_id = iir.id
       ) ef ON true
       WHERE cti.template_id = $2
         AND (
           (cti.required AND iir.id IS NULL)
           OR (cti.required AND iir.outcome IS NULL AND cti.response_type IN ('pass_fail_na', 'pass_fail_defective'))
           OR (iir.outcome = 'na' AND COALESCE(NULLIF(iir.na_reason, ''), NULLIF(iir.comment, '')) IS NULL)
           OR (cti.photo_required AND COALESCE(ef.evidence_count, 0) = 0 AND COALESCE(iir.outcome, '') <> 'na')
         )
       ORDER BY cti.position`,
      [inspectionId, inspection.checklist_template_id],
    );
    if (missing.rows.length) {
      await client.query("ROLLBACK");
      return json(
        { error: "Inspection cannot be completed", missingItems: missing.rows },
        { status: 409 },
      );
    }
    const rollup = await recalculateInspection(client, inspectionId);
    const completed = await client.query(
      `UPDATE inspections
       SET status = 'completed', completed_at = now(), updated_at = now()
       WHERE id = $1
       RETURNING id, status, outcome, risk_level, computed_risk_level, risk_level_override, risk_level_override_reason, completed_at`,
      [inspectionId],
    );
    const signerName = optionalText(body.signerName);
    const signatureData = body.signatureData === undefined ? null : asRecord(body.signatureData);
    if (signatureData && !signerName) {
      throw Object.assign(new Error("Signer name is required with a signature"), { status: 400 });
    }
    let signature = null;
    if (signatureData && signerName) {
      const signed = await client.query(
        `INSERT INTO inspection_signatures (inspection_id, signer_user_id, signer_name, signature_data)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (inspection_id) DO UPDATE SET
           signer_user_id = EXCLUDED.signer_user_id, signer_name = EXCLUDED.signer_name,
           signature_data = EXCLUDED.signature_data, signed_at = now()
         RETURNING id, signer_name, signed_at`,
        [inspectionId, auth.user.id, signerName, JSON.stringify(signatureData)],
      );
      signature = signed.rows[0];
      await client.query(
        "UPDATE inspections SET signature_id = $2, updated_at = now() WHERE id = $1",
        [inspectionId, signature.id],
      );
    }
    await audit(client, "complete_inspection", "inspection", inspectionId, rollup, auth.user);
    await client.query("COMMIT");
    return json({ ok: true, inspection: completed.rows[0], signature });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function staffChatLinkOneDriveFile(request: Request, sessionId: string) {
  const auth = await requireSteveAdminAccess(request);
  if (auth.response) return auth.response;
  const session = await getPool().query(
    "SELECT id FROM staff_chat_sessions WHERE id = $1 AND user_id = $2 AND status <> 'deleted'",
    [sessionId, auth.user.id],
  );
  if (!session.rows[0]) return json({ error: "Chat session not found" }, { status: 404 });

  const body = asRecord(await readJson(request));
  const driveItem = asRecord(body.driveItem);
  const id = requireText(driveItem.id, "Drive item id");
  const name = requireText(driveItem.name, "Drive item name");
  const webUrl = optionalText(driveItem.webUrl);
  const size = optionalNumber(driveItem.size) ?? 0;
  const mimeType =
    optionalText(asRecord(driveItem.file).mimeType) ??
    optionalText(driveItem.mimeType) ??
    "application/vnd.microsoft.onedrive.item";
  const result = await getPool().query(
    `INSERT INTO staff_chat_attachments (
      session_id, uploader_id, original_name, stored_path, mime_type, size_bytes, extracted_text, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING id, message_id, original_name, mime_type, size_bytes, status, created_at`,
    [
      sessionId,
      auth.user.id,
      name,
      `microsoft-graph:${id}`,
      mimeType,
      size,
      webUrl
        ? `OneDrive link: ${webUrl}`
        : "OneDrive linked file. Open in Microsoft 365 for content.",
      JSON.stringify({ source: "microsoft_onedrive", driveItem }),
    ],
  );
  await audit(
    getPool(),
    "link_onedrive_file_to_steve_chat",
    "staff_chat_session",
    sessionId,
    { driveItemId: id, name, webUrl },
    auth.user,
  );
  return json({ attachment: result.rows[0] }, { status: 201 });
}

function verifyInternalAgentRequest(request: Request) {
  const expected = getStaffAgentConfig().token;
  const actual = request.headers.get("x-sti-agent-token") ?? "";
  return Boolean(expected && actual && constantTimeEqual(actual, expected));
}

function vectorLiteral(values: unknown) {
  if (!Array.isArray(values)) return null;
  const numbers = values.map((value) => Number(value));
  if (numbers.length !== 768 || numbers.some((value) => !Number.isFinite(value))) return null;
  return `[${numbers.join(",")}]`;
}

async function internalRagSearch(request: Request) {
  if (!verifyInternalAgentRequest(request)) return forbidden();

  const body = await readJson(request);
  const query = requireText(body.query, "Query");
  const limit = Math.min(Math.max(Number(body.limit ?? 8), 1), 12);
  const vector = vectorLiteral(body.embedding);

  const vectorMatches = vector
    ? await getPool().query(
        `SELECT entity_type, entity_id, content, metadata,
          1 - (embedding <=> $1::vector) AS score
         FROM embedding_documents
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
        [vector, limit],
      )
    : { rows: [] };

  const textMatches = await getPool().query(
    `SELECT entity_type, entity_id, content, metadata,
      ts_rank(search_vector, plainto_tsquery('english', $1)) AS score
     FROM embedding_documents
     WHERE search_vector @@ plainto_tsquery('english', $1)
     ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC
     LIMIT $2`,
    [query, limit],
  );

  const seen = new Set<string>();
  const results = [...vectorMatches.rows, ...textMatches.rows]
    .filter((row) => {
      const key = `${row.entity_type}:${row.entity_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((row) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      content: typeof row.content === "string" ? row.content.slice(0, 5000) : "",
      metadata: row.metadata ?? {},
      score: Number(row.score ?? 0),
    }));

  return json({ ok: true, results });
}

async function internalRagPending(request: Request) {
  if (!verifyInternalAgentRequest(request)) return forbidden();

  const body = request.method === "POST" ? await readJson(request) : {};
  const limit = Math.min(Math.max(Number(body.limit ?? 25), 1), 50);
  const rows = await getPool().query(
    `SELECT id, entity_type, entity_id, content, metadata, updated_at
     FROM embedding_documents
     WHERE content IS NOT NULL
       AND (
         embedding IS NULL
         OR embedding_model IS DISTINCT FROM 'gemini-embedding-2:768'
         OR embedded_at IS NULL
         OR updated_at > embedded_at
       )
     ORDER BY updated_at NULLS FIRST, created_at
     LIMIT $1`,
    [limit],
  );
  return json({ ok: true, documents: rows.rows });
}

async function internalRagEmbedding(request: Request) {
  if (!verifyInternalAgentRequest(request)) return forbidden();

  const body = await readJson(request);
  const id = requireText(body.id, "Document id");
  const vector = vectorLiteral(body.embedding);
  const error = optionalText(body.error);

  if (!vector && !error)
    return json({ error: "A 768-value embedding or error is required" }, { status: 400 });

  const result = vector
    ? await getPool().query(
        `UPDATE embedding_documents
         SET embedding = $2::vector,
           embedding_model = 'gemini-embedding-2:768',
           embedded_at = now(),
           embedding_error = NULL,
           updated_at = now()
         WHERE id = $1
         RETURNING id`,
        [id, vector],
      )
    : await getPool().query(
        `UPDATE embedding_documents
         SET embedding_error = $2,
           updated_at = now()
         WHERE id = $1
         RETURNING id`,
        [id, error],
      );

  if (!result.rows[0]) return json({ error: "Document not found" }, { status: 404 });
  return json({ ok: true, id: result.rows[0].id });
}

async function whatsAppApprovedUserFromBody(
  body: Record<string, unknown>,
): Promise<WhatsAppApprovedUser | null> {
  const approvalId = optionalText(body.approvalId);
  if (approvalId) {
    const result = await getPool().query(
      `
      SELECT
        wau.id,
        wau.phone_e164,
        wau.status,
        wau.permission_tier,
        wau.allowed_actions,
        u.id AS user_id,
        u.email,
        u.name,
        u.role
      FROM whatsapp_approved_users wau
      JOIN app_users u ON u.id = wau.user_id
      WHERE wau.id = $1
      LIMIT 1
    `,
      [approvalId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const tier = requireOneOf(row.permission_tier, "Permission tier", [
      "agent",
      "staff",
      "admin",
    ] as const);
    return {
      approvalId: row.id as string,
      phoneE164: row.phone_e164 as string,
      status: row.status as "active" | "revoked",
      permissionTier: tier,
      allowedActions: normalizeAllowedActions(row.allowed_actions, tier),
      user: {
        id: row.user_id as string,
        email: row.email as string,
        name: row.name as string,
        role: row.role as User["role"],
      },
    };
  }
  const digits = whatsAppPhoneFromPayload(body);
  return resolveApprovedWhatsAppUser(getPool(), digits, whatsAppJidsFromPayload(body));
}

async function internalWhatsAppResolveUser(request: Request) {
  if (!verifyInternalAgentRequest(request)) return forbidden();
  const body = asRecord(await readJson(request));
  const digits = whatsAppPhoneFromPayload(body);
  const jids = whatsAppJidsFromPayload(body);
  const approved = await resolveApprovedWhatsAppUser(getPool(), digits, jids);
  const phoneE164 = phoneE164FromDigits(digits);

  if (!approved) {
    await audit(getPool(), "whatsapp_agent_user_denied", "app_user", null, {
      phoneE164,
      jids,
      reason: "not_approved",
      chatId: optionalText(body.chatId),
    });
    return json({ ok: true, approved: false, reason: "not_approved", phoneE164 });
  }

  if (approved.status !== "active") {
    await audit(getPool(), "whatsapp_agent_user_denied", "app_user", approved.user.id, {
      phoneE164: approved.phoneE164,
      reason: "revoked",
    });
    return json({
      ok: true,
      approved: false,
      reason: "revoked",
      phoneE164: approved.phoneE164,
      user: approved.user,
    });
  }

  return json({
    ok: true,
    approved: true,
    approvalId: approved.approvalId,
    phoneE164: approved.phoneE164,
    permissionTier: approved.permissionTier,
    allowedActions: approved.allowedActions,
    user: approved.user,
  });
}

async function internalWhatsAppAgentContext(request: Request) {
  if (!verifyInternalAgentRequest(request)) return forbidden();
  const body = asRecord(await readJson(request));
  const approved = await whatsAppApprovedUserFromBody(body);
  if (!approved || approved.status !== "active") return forbidden();

  const message = optionalText(body.message) ?? "";
  const conversationId = optionalText(body.conversationId);
  const [context, rag, history, tasks, recommendations] = await Promise.all([
    chatContextSummary(approved.user),
    message ? whatsappContext(message) : Promise.resolve([]),
    conversationId
      ? getPool().query(
          `
          SELECT direction, channel, subject, body, summary, created_at
          FROM communications
          WHERE channel = 'whatsapp'
            AND (
              contact_id = (SELECT contact_id FROM whatsapp_conversations WHERE id = $1)
              OR organization_id = (SELECT organization_id FROM whatsapp_conversations WHERE id = $1)
              OR deal_id = (SELECT deal_id FROM whatsapp_conversations WHERE id = $1)
            )
          ORDER BY created_at DESC
          LIMIT 12
        `,
          [conversationId],
        )
      : Promise.resolve({ rows: [] }),
    getPool().query(
      `
      SELECT id, title, description, priority, status, due_at
      FROM tasks
      WHERE owner_id = $1 AND status IN ('open', 'blocked')
      ORDER BY due_at ASC NULLS LAST, updated_at DESC
      LIMIT 8
    `,
      [approved.user.id],
    ),
    getPool().query(
      `
      SELECT id, recommendation_type, title, body, requires_approval, created_at
      FROM ai_recommendations
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT 8
    `,
    ),
  ]);

  await audit(getPool(), "whatsapp_agent_context_loaded", "app_user", approved.user.id, {
    approvalId: approved.approvalId,
    conversationId,
    ragMatches: rag.length,
  });

  return json({
    ok: true,
    user: approved.user,
    permissionTier: approved.permissionTier,
    allowedActions: approved.allowedActions,
    context,
    ragResults: rag.map((row) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      content: typeof row.content === "string" ? row.content.slice(0, 5000) : "",
      metadata: row.metadata ?? {},
    })),
    history: history.rows.reverse(),
    openTasks: tasks.rows,
    pendingRecommendations: recommendations.rows,
  });
}

async function internalWhatsAppRespond(request: Request) {
  if (!verifyInternalAgentRequest(request)) return forbidden();
  const body = asRecord(await readJson(request));
  const inboundEventId = optionalText(body.inboundEventId);
  const messageBody = requireText(body.message, "Message").slice(0, 4000);
  const mode = optionalText(body.mode) ?? "queue";
  const metadata = asRecord(body.metadata);

  const inbound = inboundEventId
    ? await getPool().query(
        `
        SELECT ie.id, ie.contact_id, ie.organization_id, ie.deal_id, ie.payload,
          wc.id AS conversation_id, wc.chat_id
        FROM inbound_events ie
        LEFT JOIN whatsapp_conversations wc
          ON wc.chat_id = ie.payload->>'chatId'
         AND wc.instance_id = COALESCE(ie.payload->>'instanceId', split_part(ie.source, ':', 2))
        WHERE ie.id = $1
        LIMIT 1
      `,
        [inboundEventId],
      )
    : { rows: [] };
  const row = inbound.rows[0];
  const chatId = optionalText(body.chatId) ?? optionalText(row?.chat_id);
  if (!chatId) return json({ error: "chatId is required" }, { status: 400 });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const toolCall = await client.query(
      `INSERT INTO tool_calls (source, tool_name, request, response, status)
       VALUES ('whatsapp_n8n', 'respond', $1::jsonb, $2::jsonb, 'completed')
       RETURNING id`,
      [
        JSON.stringify({ inboundEventId, mode, chatId, metadata }),
        JSON.stringify({ message: messageBody }),
      ],
    );

    if (mode === "recommendation") {
      const recommendation = await client.query(
        `INSERT INTO ai_recommendations (
          deal_id, contact_id, organization_id, recommendation_type, title, body, requires_approval, payload
         )
         VALUES ($1, $2, $3, 'whatsapp_reply_review', $4, $5, true, $6::jsonb)
         RETURNING id`,
        [
          row?.deal_id ?? null,
          row?.contact_id ?? null,
          row?.organization_id ?? null,
          optionalText(body.title) ?? "WhatsApp reply requires review",
          messageBody,
          JSON.stringify({ inboundEventId, toolCallId: toolCall.rows[0].id, metadata }),
        ],
      );
      await audit(
        client,
        "whatsapp_agent_response_recommended",
        "ai_recommendation",
        recommendation.rows[0].id,
        { inboundEventId },
      );
      await client.query("COMMIT");
      return json({ ok: true, recommendationId: recommendation.rows[0].id }, { status: 201 });
    }

    const communication = await client.query(
      `INSERT INTO communications (
        deal_id, contact_id, organization_id, direction, channel, subject, body, summary
       )
       VALUES ($1, $2, $3, 'outbound', 'whatsapp', $4, $5, $6)
       RETURNING id`,
      [
        row?.deal_id ?? null,
        row?.contact_id ?? null,
        row?.organization_id ?? null,
        optionalText(body.subject) ?? "WhatsApp agent reply",
        messageBody,
        messageBody.slice(0, 240),
      ],
    );
    const outbox = await client.query(
      `INSERT INTO whatsapp_outbox (
        conversation_id, source_inbound_event_id, communication_id, recipient, message_body, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id`,
      [
        row?.conversation_id ?? null,
        inboundEventId ?? null,
        communication.rows[0].id,
        chatId,
        messageBody,
        JSON.stringify({ toolCallId: toolCall.rows[0].id, ...metadata }),
      ],
    );
    await audit(client, "whatsapp_agent_response_queued", "whatsapp_outbox", outbox.rows[0].id, {
      inboundEventId,
      communicationId: communication.rows[0].id,
    });
    await client.query("COMMIT");
    return json({ ok: true, outboxId: outbox.rows[0].id }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function internalWhatsAppActions(request: Request) {
  if (!verifyInternalAgentRequest(request)) return forbidden();
  const body = asRecord(await readJson(request));
  const action = requireOneOf(body.action, "Action", [
    "create_recommendation",
    "create_task",
    "add_task_comment",
    "log_communication",
  ] as const);
  const approved = await whatsAppApprovedUserFromBody(body);
  if (!approved || !canWhatsAppUser(approved, action)) return forbidden();
  const payload = asRecord(body.payload);
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const toolCall = await client.query(
      `INSERT INTO tool_calls (source, tool_name, request, status)
       VALUES ('whatsapp_n8n', $1, $2::jsonb, 'received')
       RETURNING id`,
      [
        action,
        JSON.stringify({
          approvalId: approved.approvalId,
          userId: approved.user.id,
          permissionTier: approved.permissionTier,
          payload,
        }),
      ],
    );

    let response: Record<string, unknown>;
    if (action === "create_recommendation") {
      const result = await client.query(
        `INSERT INTO ai_recommendations (
          deal_id, contact_id, organization_id, project_id, task_id,
          recommendation_type, title, body, requires_approval, payload
         )
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'whatsapp_agent_suggestion'), $7, $8, true, $9::jsonb)
         RETURNING id`,
        [
          payload.dealId ?? null,
          payload.contactId ?? null,
          payload.organizationId ?? null,
          payload.projectId ?? null,
          payload.taskId ?? null,
          optionalText(payload.recommendationType),
          requireText(payload.title, "Title"),
          requireText(payload.body, "Body"),
          JSON.stringify({ ...asRecord(payload.metadata), toolCallId: toolCall.rows[0].id }),
        ],
      );
      response = { recommendationId: result.rows[0].id };
      await audit(
        client,
        "whatsapp_agent_create_recommendation",
        "ai_recommendation",
        result.rows[0].id,
        {
          approvalId: approved.approvalId,
        },
        approved.user,
      );
    } else if (action === "create_task") {
      const board = await ensureTaskBoard(client);
      const fallbackStage =
        board.stages.find((stage) => stage.name === "Backlog") ?? board.stages[0];
      const result = await client.query(
        `INSERT INTO tasks (
          board_id, stage_id, project_id, deal_id, organization_id, owner_id,
          title, description, priority, due_at, source
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'medium'), $10, 'whatsapp_agent')
         RETURNING id`,
        [
          board.boardId,
          fallbackStage.id,
          payload.projectId ?? null,
          payload.dealId ?? null,
          payload.organizationId ?? null,
          optionalText(payload.ownerId) ?? approved.user.id,
          requireText(payload.title, "Task title"),
          optionalText(payload.description),
          optionalText(payload.priority),
          optionalText(payload.dueAt),
        ],
      );
      response = { taskId: result.rows[0].id };
      await audit(
        client,
        "whatsapp_agent_create_task",
        "task",
        result.rows[0].id,
        {
          approvalId: approved.approvalId,
        },
        approved.user,
      );
    } else if (action === "add_task_comment") {
      const taskId = requireText(payload.taskId, "Task id");
      const result = await client.query(
        "INSERT INTO task_comments (task_id, author_id, body) VALUES ($1, $2, $3) RETURNING id",
        [taskId, approved.user.id, requireText(payload.body, "Comment")],
      );
      await client.query("UPDATE tasks SET updated_at = now() WHERE id = $1", [taskId]);
      response = { commentId: result.rows[0].id };
      await audit(
        client,
        "whatsapp_agent_add_task_comment",
        "task",
        taskId,
        {
          approvalId: approved.approvalId,
          commentId: result.rows[0].id,
        },
        approved.user,
      );
    } else {
      const result = await client.query(
        `INSERT INTO communications (
          deal_id, contact_id, organization_id, project_id, task_id,
          direction, channel, subject, body, summary
         )
         VALUES ($1, $2, $3, $4, $5, 'internal', 'whatsapp', $6, $7, $8)
         RETURNING id`,
        [
          payload.dealId ?? null,
          payload.contactId ?? null,
          payload.organizationId ?? null,
          payload.projectId ?? null,
          payload.taskId ?? null,
          optionalText(payload.subject) ?? "WhatsApp agent note",
          requireText(payload.body, "Body"),
          optionalText(payload.summary) ?? requireText(payload.body, "Body").slice(0, 240),
        ],
      );
      response = { communicationId: result.rows[0].id };
      await audit(
        client,
        "whatsapp_agent_log_communication",
        "communication",
        result.rows[0].id,
        {
          approvalId: approved.approvalId,
        },
        approved.user,
      );
    }

    await client.query(
      "UPDATE tool_calls SET response = $1::jsonb, status = 'completed' WHERE id = $2",
      [JSON.stringify(response), toolCall.rows[0].id],
    );
    await client.query("COMMIT");
    return json({ ok: true, ...response }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

type LemlistConfig =
  | { configured: true; authorization: string; baseUrl: string }
  | { configured: false; baseUrl: string };

type GrowthContactRow = {
  id: string;
  organization_id: string | null;
  deal_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  role_title: string | null;
  linkedin_url: string | null;
  consent_status: string | null;
  consent_basis: string | null;
  do_not_contact: boolean;
  bounce_status: string | null;
  lemlist_lead_id: string | null;
  organization_name: string | null;
  owner_name: string | null;
};

function lemlistCampaignList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((item) => item && typeof item === "object");
  const record = asRecord(data);
  if (Array.isArray(record.campaigns)) {
    return record.campaigns.filter((item) => item && typeof item === "object") as Record<
      string,
      unknown
    >[];
  }
  if (Array.isArray(record.data)) {
    return record.data.filter((item) => item && typeof item === "object") as Record<
      string,
      unknown
    >[];
  }
  return [];
}

function getLemlistConfig(): LemlistConfig {
  const baseUrl = process.env.LEMLIST_API_BASE_URL || "https://api.lemlist.com/api";
  const configured = Boolean(
    process.env.LEMLIST_BASIC_AUTH ||
    (process.env.LEMLIST_API_USERNAME && process.env.LEMLIST_API_PASSWORD),
  );
  if (!configured) return { configured: false, baseUrl };
  const authorization = process.env.LEMLIST_BASIC_AUTH?.startsWith("Basic ")
    ? process.env.LEMLIST_BASIC_AUTH
    : process.env.LEMLIST_BASIC_AUTH
      ? `Basic ${process.env.LEMLIST_BASIC_AUTH}`
      : `Basic ${Buffer.from(
          `${process.env.LEMLIST_API_USERNAME}:${process.env.LEMLIST_API_PASSWORD}`,
        ).toString("base64")}`;
  return { configured: true, authorization, baseUrl };
}

async function lemlistRequest<T>(
  endpoint: string,
  init: RequestInit = {},
): Promise<{ data: T; status: number }> {
  const config = getLemlistConfig();
  if (!config.configured) throw new Error("lemlist API credentials are not configured");
  const response = await fetch(`${config.baseUrl}${endpoint}`, {
    ...init,
    headers: {
      authorization: config.authorization,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as T) : ({} as T);
  if (!response.ok) {
    throw new Error(`lemlist API ${response.status}: ${text || response.statusText}`);
  }
  return { data, status: response.status };
}

function isValidEmail(value: string | null | undefined) {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

function emailDomain(value: string) {
  return value.split("@")[1]?.toLowerCase() ?? "";
}

function normalizeEventType(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "unknown";
}

function lemlistEventTimestamp(payload: Record<string, unknown>) {
  const value = optionalString(payload.createdAt) ?? optionalString(payload.timestamp);
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function isReplyEvent(type: string) {
  return /replied|warmed|smsReplied|whatsappReplied/i.test(type);
}

function isInterestedEvent(type: string) {
  return /interested/i.test(type) && !/notInterested/i.test(type);
}

function isMeetingEvent(type: string, payload: Record<string, unknown>) {
  return /meeting/i.test(type) || JSON.stringify(payload).toLowerCase().includes("meeting");
}

function isBounceEvent(type: string) {
  return /bounced|hard.?bounce/i.test(type);
}

function isUnsubscribeEvent(type: string) {
  return /unsubscribed|unsubscribe/i.test(type);
}

function isComplaintEvent(type: string, payload: Record<string, unknown>) {
  return (
    /complaint|spam/i.test(type) || JSON.stringify(payload).toLowerCase().includes("complaint")
  );
}

function lemlistEventId(payload: Record<string, unknown>) {
  return (
    optionalString(payload._id) ??
    optionalString(payload.id) ??
    optionalString(payload.eventId) ??
    optionalString(payload.activityId)
  );
}

function lemlistLeadEmail(payload: Record<string, unknown>) {
  return (
    optionalString(payload.leadEmail) ??
    optionalString(payload.email) ??
    optionalString(payload.recipientEmail) ??
    optionalString(asRecord(payload.lead).email)
  );
}

function lemlistLeadId(payload: Record<string, unknown>) {
  return (
    optionalString(payload.leadId) ??
    optionalString(payload.lemlistLeadId) ??
    optionalString(asRecord(payload.lead)._id) ??
    optionalString(asRecord(payload.lead).id)
  );
}

function lemlistCampaignId(payload: Record<string, unknown>) {
  return (
    optionalString(payload.campaignId) ??
    optionalString(payload.lemlistCampaignId) ??
    optionalString(asRecord(payload.campaign)._id) ??
    optionalString(asRecord(payload.campaign).id)
  );
}

function lemlistIdempotencyKey(payload: Record<string, unknown>) {
  const eventId = lemlistEventId(payload);
  if (eventId) return `lemlist:${eventId}`;
  const material = JSON.stringify({
    type: normalizeEventType(payload.type),
    campaignId: lemlistCampaignId(payload),
    leadId: lemlistLeadId(payload),
    email: lemlistLeadEmail(payload),
    createdAt: optionalString(payload.createdAt) ?? optionalString(payload.timestamp),
    payload,
  });
  return `lemlist:${crypto.createHash("sha256").update(material).digest("hex")}`;
}

async function lemlistHealth(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  const config = getLemlistConfig();
  const webhookSecretConfigured = Boolean(process.env.LEMLIST_WEBHOOK_SECRET);
  if (!config.configured) {
    return json({
      configured: false,
      apiReachable: false,
      webhookSecretConfigured,
      baseUrl: config.baseUrl,
      message: "lemlist credentials are not configured",
    });
  }

  try {
    const response = await lemlistRequest<unknown>("/campaigns?version=v2&limit=1");
    return json({
      configured: true,
      apiReachable: true,
      webhookSecretConfigured,
      baseUrl: config.baseUrl,
    });
  } catch (error) {
    return json({
      configured: true,
      apiReachable: false,
      webhookSecretConfigured,
      baseUrl: config.baseUrl,
      error: error instanceof Error ? error.message : "lemlist health check failed",
    });
  }
}

async function lemlistCampaigns(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const rows = await getPool().query(`
    SELECT lc.*,
      COALESCE((lc.raw->>'archived')::boolean, false) AS archived,
      u.name AS owner_name,
      task_owner.name AS default_task_owner_name,
      count(ll.id)::int AS enrolled_contacts,
      count(ll.id) FILTER (WHERE ll.status IN ('active', 'enrolled', 'pending'))::int AS active_contacts,
      count(ll.id) FILTER (WHERE ll.replied_at IS NOT NULL)::int AS replies,
      count(ll.id) FILTER (WHERE ll.interested_at IS NOT NULL)::int AS interested
    FROM lemlist_campaigns lc
    LEFT JOIN app_users u ON u.id = lc.owner_id
    LEFT JOIN app_users task_owner ON task_owner.id = lc.default_task_owner_id
    LEFT JOIN lemlist_lead_links ll ON ll.campaign_id = lc.id
    WHERE COALESCE((lc.raw->>'archived')::boolean, false) = false
    GROUP BY lc.id, u.name, task_owner.name
    ORDER BY
      CASE lc.status WHEN 'running' THEN 0 WHEN 'active' THEN 1 WHEN 'draft' THEN 2 WHEN 'ended' THEN 3 ELSE 4 END,
      lc.raw->>'createdAt' DESC NULLS LAST,
      lc.updated_at DESC
  `);
  return json({ campaigns: rows.rows });
}

async function lemlistCampaignDetail(request: Request, campaignId: string) {
  const auth = await requireUser(request, ["admin", "staff", "viewer"]);
  if (auth.response) return auth.response;

  const campaign = await getPool().query(
    `
    SELECT lc.*,
      count(ll.id)::int AS enrolled_contacts,
      count(ll.id) FILTER (WHERE ll.replied_at IS NOT NULL)::int AS replies,
      count(ll.id) FILTER (WHERE ll.interested_at IS NOT NULL)::int AS interested,
      count(ll.id) FILTER (WHERE ll.meeting_booked_at IS NOT NULL)::int AS meetings,
      count(ll.id) FILTER (WHERE ll.bounced_at IS NOT NULL)::int AS bounces,
      count(ll.id) FILTER (WHERE ll.unsubscribed_at IS NOT NULL)::int AS unsubscribes
    FROM lemlist_campaigns lc
    LEFT JOIN lemlist_lead_links ll ON ll.campaign_id = lc.id
    WHERE lc.id::text = $1 OR lc.lemlist_campaign_id = $1
    GROUP BY lc.id
  `,
    [campaignId],
  );
  if (!campaign.rows[0]) return json({ error: "Campaign not found" }, { status: 404 });

  const contacts = await getPool().query(
    `
    SELECT ll.*, c.first_name, c.last_name, c.email AS contact_email, c.consent_status,
      c.do_not_contact, c.bounce_status, o.name AS organization_name, d.title AS deal_title
    FROM lemlist_lead_links ll
    LEFT JOIN contacts c ON c.id = ll.contact_id
    LEFT JOIN organizations o ON o.id = ll.organization_id
    LEFT JOIN deals d ON d.id = ll.deal_id
    WHERE ll.campaign_id = $1
    ORDER BY ll.updated_at DESC
    LIMIT 500
  `,
    [campaign.rows[0].id],
  );

  const events = await getPool().query(
    `
    SELECT e.*, c.first_name, c.last_name, d.title AS deal_title
    FROM lemlist_events e
    LEFT JOIN contacts c ON c.id = e.contact_id
    LEFT JOIN deals d ON d.id = e.deal_id
    WHERE e.lemlist_campaign_id = $1
    ORDER BY e.created_at DESC
    LIMIT 100
  `,
    [campaign.rows[0].lemlist_campaign_id],
  );

  const recommendations = await getPool().query(
    `
    SELECT id, recommendation_type, title, body, confidence, status, created_at
    FROM ai_recommendations
    WHERE lemlist_campaign_id = $1 AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 20
  `,
    [campaign.rows[0].lemlist_campaign_id],
  );

  return json({
    campaign: campaign.rows[0],
    contacts: contacts.rows,
    events: events.rows,
    recommendations: recommendations.rows,
  });
}

async function syncLemlistCampaigns(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;

  const client = await getPool().connect();
  try {
    const result = await lemlistRequest<unknown>(
      "/campaigns?version=v2&limit=100&sortBy=createdAt&sortOrder=desc",
    );
    const campaigns = lemlistCampaignList(result.data);
    await client.query("BEGIN");
    const log = await client.query(
      `INSERT INTO integration_sync_log (integration, operation, direction, status, request)
       VALUES ('lemlist', 'campaign_sync', 'inbound', 'running', $1::jsonb)
       RETURNING id`,
      [JSON.stringify({ endpoint: "/campaigns?version=v2" })],
    );
    let count = 0;
    for (const campaign of campaigns) {
      const campaignId = requireText(campaign._id, "Campaign id");
      await client.query(
        `INSERT INTO lemlist_campaigns (lemlist_campaign_id, name, status, raw, last_synced_at)
         VALUES ($1, $2, $3, $4::jsonb, now())
         ON CONFLICT (lemlist_campaign_id) DO UPDATE SET
           name = EXCLUDED.name,
           status = EXCLUDED.status,
           raw = EXCLUDED.raw,
           last_synced_at = now(),
           updated_at = now()`,
        [
          campaignId,
          optionalString(campaign.name) ?? campaignId,
          optionalString(campaign.status) ?? "unknown",
          JSON.stringify(campaign),
        ],
      );
      count += 1;
    }
    await client.query(
      `UPDATE integration_sync_log
       SET status = 'completed', response = $1::jsonb, completed_at = now()
       WHERE id = $2`,
      [JSON.stringify({ count, status: result.status }), log.rows[0].id],
    );
    await audit(client, "lemlist_campaign_sync", "integration", null, { count }, auth.user);
    await client.query("COMMIT");
    return json({ ok: true, count });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    await getPool().query(
      `INSERT INTO integration_sync_log (integration, operation, direction, status, error, completed_at)
       VALUES ('lemlist', 'campaign_sync', 'inbound', 'failed', $1, now())`,
      [error instanceof Error ? error.message : "Campaign sync failed"],
    );
    throw error;
  } finally {
    client.release();
  }
}

async function validateCampaignEnrollment(
  client: pg.Pool | pg.PoolClient,
  contactId: string,
  campaignId: string,
) {
  const contactResult = await client.query(
    `
    SELECT c.*, o.name AS organization_name, u.name AS owner_name,
      (
        SELECT d.id
        FROM deals d
        WHERE d.primary_contact_id = c.id
        ORDER BY d.updated_at DESC
        LIMIT 1
      ) AS deal_id
    FROM contacts c
    LEFT JOIN organizations o ON o.id = c.organization_id
    LEFT JOIN app_users u ON u.id = c.owner_id
    WHERE c.id = $1
  `,
    [contactId],
  );
  const contact = contactResult.rows[0] as GrowthContactRow | undefined;
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!contact) return { ok: false, errors: ["Contact not found"], warnings, contact: null };
  if (!isValidEmail(contact.email)) errors.push("Missing or invalid email");
  if (contact.do_not_contact) errors.push("Contact is marked do-not-contact");
  if (!contact.consent_status || !contact.consent_basis) {
    errors.push("Consent or outreach basis requires review before enrollment");
  }
  if (contact.bounce_status && /hard|bounced/i.test(contact.bounce_status)) {
    errors.push("Contact has a hard bounce status");
  }

  if (contact.email) {
    const suppressions = await client.query(
      `SELECT suppression_type, reason, value
       FROM crm_suppressions
       WHERE active = true
         AND (
           value = $1::citext
           OR value = $2::citext
           OR (suppression_type = 'contact' AND contact_id = $3)
         )`,
      [contact.email, emailDomain(contact.email), contact.id],
    );
    for (const suppression of suppressions.rows) {
      errors.push(`Suppressed by ${suppression.reason}`);
    }
  }

  const duplicate = await client.query(
    `SELECT 1
     FROM lemlist_lead_links
     WHERE campaign_id = $1
       AND (contact_id = $2 OR email = $3::citext)
       AND status NOT IN ('failed', 'removed', 'unsubscribed', 'bounced')
     LIMIT 1`,
    [campaignId, contact.id, contact.email],
  );
  if (duplicate.rows[0]) errors.push("Contact is already active in this campaign");

  return { ok: errors.length === 0, errors, warnings, contact };
}

async function enrollOneLead(
  client: pg.PoolClient,
  contactId: string,
  campaignUuid: string,
  actor: User,
  source = "staff",
) {
  const campaign = await client.query(
    "SELECT * FROM lemlist_campaigns WHERE id::text = $1 OR lemlist_campaign_id = $1 LIMIT 1",
    [campaignUuid],
  );
  if (!campaign.rows[0]) {
    return { contactId, ok: false, errors: ["Campaign not found"], warnings: [] };
  }
  const validation = await validateCampaignEnrollment(client, contactId, campaign.rows[0].id);
  const validationResult = {
    ok: validation.ok,
    errors: validation.errors,
    warnings: validation.warnings,
  };
  await audit(
    client,
    validation.ok ? "lemlist_enrollment_approved" : "lemlist_enrollment_blocked",
    "contact",
    contactId,
    {
      campaignId: campaign.rows[0].id,
      lemlistCampaignId: campaign.rows[0].lemlist_campaign_id,
      validation: validationResult,
    },
    actor,
  );
  if (!validation.ok || !validation.contact?.email) {
    return { contactId, ok: false, ...validationResult };
  }

  const leadPayload = {
    email: validation.contact.email,
    firstName: validation.contact.first_name,
    lastName: validation.contact.last_name,
    companyName: validation.contact.organization_name,
    jobTitle: validation.contact.role_title,
    linkedinUrl: validation.contact.linkedin_url,
    phone: validation.contact.phone,
    stiRiskContactId: validation.contact.id,
    stiRiskOrganizationId: validation.contact.organization_id,
    stiRiskDealId: validation.contact.deal_id,
  };

  const log = await client.query(
    `INSERT INTO integration_sync_log (
      integration, operation, direction, status, entity_type, entity_id, request
     )
     VALUES ('lemlist', 'lead_enroll', 'outbound', 'running', 'contact', $1, $2::jsonb)
     RETURNING id`,
    [
      contactId,
      JSON.stringify({ campaignId: campaign.rows[0].lemlist_campaign_id, lead: leadPayload }),
    ],
  );

  try {
    const result = await lemlistRequest<Record<string, unknown>>(
      `/campaigns/${encodeURIComponent(campaign.rows[0].lemlist_campaign_id)}/leads/`,
      { method: "POST", body: JSON.stringify(leadPayload) },
    );
    const lemlistLead = optionalString(result.data._id) ?? optionalString(result.data.id);
    const link = await client.query(
      `INSERT INTO lemlist_lead_links (
        campaign_id, contact_id, organization_id, deal_id, lemlist_lead_id, email, status,
        enrollment_source, approved_by, approved_at, validation_result
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'enrolled', $7, $8, now(), $9::jsonb)
       ON CONFLICT (campaign_id, email) DO UPDATE SET
         contact_id = EXCLUDED.contact_id,
         organization_id = EXCLUDED.organization_id,
         deal_id = EXCLUDED.deal_id,
         lemlist_lead_id = COALESCE(EXCLUDED.lemlist_lead_id, lemlist_lead_links.lemlist_lead_id),
         status = 'enrolled',
         approved_by = EXCLUDED.approved_by,
         approved_at = now(),
         validation_result = EXCLUDED.validation_result,
         updated_at = now()
       RETURNING id`,
      [
        campaign.rows[0].id,
        validation.contact.id,
        validation.contact.organization_id,
        validation.contact.deal_id,
        lemlistLead,
        validation.contact.email,
        source,
        actor.id,
        JSON.stringify(validationResult),
      ],
    );
    await client.query(
      "UPDATE contacts SET lemlist_lead_id = COALESCE($1, lemlist_lead_id), last_contacted_at = now(), updated_at = now() WHERE id = $2",
      [lemlistLead, validation.contact.id],
    );
    await client.query(
      `UPDATE integration_sync_log
       SET status = 'completed', response = $1::jsonb, completed_at = now()
       WHERE id = $2`,
      [JSON.stringify(result.data), log.rows[0].id],
    );
    return {
      contactId,
      ok: true,
      linkId: link.rows[0].id,
      lemlistLeadId: lemlistLead,
      warnings: validation.warnings,
    };
  } catch (error) {
    await client.query(
      `UPDATE integration_sync_log
       SET status = 'failed', error = $1, completed_at = now()
       WHERE id = $2`,
      [error instanceof Error ? error.message : "Lead enrollment failed", log.rows[0].id],
    );
    return {
      contactId,
      ok: false,
      errors: [error instanceof Error ? error.message : "Lead enrollment failed"],
      warnings: validation.warnings,
    };
  }
}

async function lemlistEnrollLead(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = await readJson(request);
  const contactId = requireText(body.contactId, "Contact id");
  const campaignId = requireText(body.campaignId, "Campaign id");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await enrollOneLead(client, contactId, campaignId, auth.user);
    await client.query("COMMIT");
    return json(result, { status: result.ok ? 201 : 422 });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function lemlistBulkEnrollLeads(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = await readJson(request);
  const campaignId = requireText(body.campaignId, "Campaign id");
  const contactIds = Array.isArray(body.contactIds)
    ? body.contactIds.filter((id: unknown): id is string => typeof id === "string" && Boolean(id))
    : [];
  if (contactIds.length === 0) {
    return json({ error: "At least one contact is required" }, { status: 400 });
  }
  if (contactIds.length > 25) {
    return json({ error: "Bulk enrollment is limited to 25 contacts" }, { status: 400 });
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const results = [];
    for (const contactId of contactIds) {
      results.push(await enrollOneLead(client, contactId, campaignId, auth.user, "staff_bulk"));
    }
    await audit(
      client,
      "lemlist_bulk_enrollment",
      "campaign",
      null,
      { campaignId, count: contactIds.length, results },
      auth.user,
    );
    await client.query("COMMIT");
    return json(
      { ok: results.every((item) => item.ok), results },
      { status: results.every((item) => item.ok) ? 201 : 207 },
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createGrowthTask(
  client: pg.Pool | pg.PoolClient,
  title: string,
  description: string,
  organizationId: string | null,
  dealId: string | null,
  ownerId: string | null,
  campaignId: string | null,
  contactId: string | null = null,
  eventId: string | null = null,
) {
  if (eventId) {
    const existing = await client.query(
      "SELECT id FROM tasks WHERE lemlist_event_id = $1 LIMIT 1",
      [eventId],
    );
    if (existing.rows[0]) return;
  }
  const board = await ensureTaskBoard(client);
  const backlog = board.stages.find((stage) => stage.name === "Backlog") ?? board.stages[0];
  await client.query(
    `INSERT INTO tasks (
      board_id, stage_id, contact_id, deal_id, organization_id, owner_id, title, description,
      priority, due_at, source, lemlist_campaign_id, lemlist_event_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'high', now() + interval '1 day', 'lemlist', $9, $10)`,
    [
      board.boardId,
      backlog.id,
      contactId,
      dealId,
      organizationId,
      ownerId,
      title,
      description,
      campaignId,
      eventId,
    ],
  );
}

async function processLemlistEvent(
  client: pg.PoolClient,
  eventUuid: string,
  payload: Record<string, unknown>,
) {
  const eventType = normalizeEventType(payload.type);
  const campaignId = lemlistCampaignId(payload);
  const leadId = lemlistLeadId(payload);
  const leadEmail = lemlistLeadEmail(payload);
  const eventAt = lemlistEventTimestamp(payload);

  const match = await client.query(
    `
    WITH custom_match AS (
      SELECT c.id, c.organization_id,
        (SELECT d.id FROM deals d WHERE d.primary_contact_id = c.id ORDER BY d.updated_at DESC LIMIT 1) AS deal_id,
        c.owner_id
      FROM contacts c
      WHERE c.id::text = $1
      LIMIT 1
    ),
    lead_match AS (
      SELECT c.id, c.organization_id,
        (SELECT d.id FROM deals d WHERE d.primary_contact_id = c.id ORDER BY d.updated_at DESC LIMIT 1) AS deal_id,
        c.owner_id
      FROM contacts c
      WHERE c.lemlist_lead_id = $2
      LIMIT 1
    ),
    email_match AS (
      SELECT c.id, c.organization_id,
        (SELECT d.id FROM deals d WHERE d.primary_contact_id = c.id ORDER BY d.updated_at DESC LIMIT 1) AS deal_id,
        c.owner_id
      FROM contacts c
      WHERE c.email = $3::citext
      LIMIT 1
    )
    SELECT * FROM custom_match
    UNION ALL SELECT * FROM lead_match WHERE NOT EXISTS (SELECT 1 FROM custom_match)
    UNION ALL SELECT * FROM email_match WHERE NOT EXISTS (SELECT 1 FROM custom_match) AND NOT EXISTS (SELECT 1 FROM lead_match)
    LIMIT 1
  `,
    [
      optionalString(payload.stiRiskContactId) ??
        optionalString(asRecord(payload.customVars).stiRiskContactId),
      leadId,
      leadEmail,
    ],
  );
  const matched = match.rows[0] as
    | {
        id: string;
        organization_id: string | null;
        deal_id: string | null;
        owner_id: string | null;
      }
    | undefined;

  await client.query(
    `UPDATE lemlist_events
     SET contact_id = $1, organization_id = $2, deal_id = $3
     WHERE id = $4`,
    [matched?.id ?? null, matched?.organization_id ?? null, matched?.deal_id ?? null, eventUuid],
  );

  if (matched) {
    await client.query(
      `INSERT INTO communications (
        deal_id, contact_id, organization_id, direction, channel, subject, body, summary,
        lemlist_campaign_id, lemlist_lead_id, lemlist_event_id
       )
       VALUES ($1, $2, $3, $4, 'lemlist', $5, $6, $7, $8, $9, $10)`,
      [
        matched.deal_id,
        matched.id,
        matched.organization_id,
        isReplyEvent(eventType) ? "inbound" : "outbound",
        optionalString(payload.subject) ?? `lemlist ${eventType}`,
        optionalString(payload.text) ?? optionalString(payload.body) ?? JSON.stringify(payload),
        `lemlist event: ${eventType}`,
        campaignId,
        leadId,
        eventUuid,
      ],
    );
    await client.query(
      `INSERT INTO activities (
        deal_id, contact_id, organization_id, type, title, body,
        lemlist_campaign_id, lemlist_lead_id, lemlist_event_id
       )
       VALUES ($1, $2, $3, 'lemlist_event', $4, $5, $6, $7, $8)`,
      [
        matched.deal_id,
        matched.id,
        matched.organization_id,
        `lemlist ${eventType}`,
        optionalString(payload.subject) ?? JSON.stringify(payload).slice(0, 500),
        campaignId,
        leadId,
        eventUuid,
      ],
    );

    const repliedAt = isReplyEvent(eventType) ? eventAt : null;
    const interestedAt = isInterestedEvent(eventType) ? eventAt : null;
    const meetingAt = isMeetingEvent(eventType, payload) ? eventAt : null;
    const bouncedAt = isBounceEvent(eventType) ? eventAt : null;
    const unsubscribedAt = isUnsubscribeEvent(eventType) ? eventAt : null;
    await client.query(
      `UPDATE lemlist_lead_links ll
       SET status = CASE
           WHEN $10::timestamptz IS NOT NULL THEN 'unsubscribed'
           WHEN $9::timestamptz IS NOT NULL THEN 'bounced'
           WHEN $7::timestamptz IS NOT NULL THEN 'interested'
           WHEN $6::timestamptz IS NOT NULL THEN 'replied'
           ELSE COALESCE(NULLIF(ll.status, 'pending'), 'active')
         END,
         last_event_id = $1,
         last_event_type = $2,
         last_event_at = $3,
         replied_at = COALESCE(ll.replied_at, $6),
         interested_at = COALESCE(ll.interested_at, $7),
         meeting_booked_at = COALESCE(ll.meeting_booked_at, $8),
         bounced_at = COALESCE(ll.bounced_at, $9),
         unsubscribed_at = COALESCE(ll.unsubscribed_at, $10),
         updated_at = now()
       FROM lemlist_campaigns lc
       WHERE ll.campaign_id = lc.id
         AND lc.lemlist_campaign_id = $4
         AND (ll.contact_id = $5 OR ll.email = $11::citext)`,
      [
        eventUuid,
        eventType,
        eventAt,
        campaignId,
        matched.id,
        repliedAt,
        interestedAt,
        meetingAt,
        bouncedAt,
        unsubscribedAt,
        leadEmail,
      ],
    );
    await client.query(
      `UPDATE contacts
       SET last_meaningful_activity_at = CASE WHEN $2 THEN $3 ELSE last_meaningful_activity_at END,
           bounce_status = CASE WHEN $4 THEN 'hard_bounce' ELSE bounce_status END,
           do_not_contact = CASE WHEN $5 THEN true ELSE do_not_contact END,
           updated_at = now()
       WHERE id = $1`,
      [
        matched.id,
        isReplyEvent(eventType) || isInterestedEvent(eventType),
        eventAt,
        isBounceEvent(eventType),
        isUnsubscribeEvent(eventType) || isComplaintEvent(eventType, payload),
      ],
    );

    if (
      isReplyEvent(eventType) ||
      isInterestedEvent(eventType) ||
      isMeetingEvent(eventType, payload)
    ) {
      await createGrowthTask(
        client,
        isInterestedEvent(eventType)
          ? "Follow up interested lemlist reply"
          : "Follow up lemlist reply",
        `Review ${eventType} from ${leadEmail ?? "campaign lead"} and create the next CRM action.`,
        matched.organization_id,
        matched.deal_id,
        matched.owner_id,
        campaignId,
        matched.id,
        eventUuid,
      );
    }
    if (isBounceEvent(eventType) || isComplaintEvent(eventType, payload)) {
      await createGrowthTask(
        client,
        "Clean up campaign contact suppression",
        `Review ${eventType} and confirm CRM suppression status for ${leadEmail ?? "campaign lead"}.`,
        matched.organization_id,
        matched.deal_id,
        matched.owner_id,
        campaignId,
        matched.id,
        eventUuid,
      );
    }
  }

  if (
    leadEmail &&
    (isUnsubscribeEvent(eventType) ||
      isBounceEvent(eventType) ||
      isComplaintEvent(eventType, payload))
  ) {
    const reason = isComplaintEvent(eventType, payload)
      ? "complaint"
      : isBounceEvent(eventType)
        ? "hard_bounce"
        : "unsubscribe";
    await client.query(
      `INSERT INTO crm_suppressions (
        suppression_type, value, reason, contact_id, source, source_event_id, metadata
       )
       VALUES ('email', $1, $2, $3, 'lemlist', $4, $5::jsonb)
       ON CONFLICT (suppression_type, value, reason) DO UPDATE SET
         active = true,
         source_event_id = EXCLUDED.source_event_id,
         metadata = EXCLUDED.metadata,
         updated_at = now()`,
      [
        leadEmail,
        reason,
        matched?.id ?? null,
        eventUuid,
        JSON.stringify({ eventType, campaignId, leadId }),
      ],
    );
  }

  await client.query(
    "UPDATE lemlist_events SET status = 'processed', processed_at = now() WHERE id = $1",
    [eventUuid],
  );
}

async function lemlistWebhook(request: Request) {
  const url = new URL(request.url);
  const payload = asRecord(await readJson(request));
  const expectedSecret = process.env.LEMLIST_WEBHOOK_SECRET;
  if (expectedSecret) {
    const supplied =
      optionalString(payload.secret) ??
      request.headers.get("x-lemlist-secret") ??
      request.headers.get("x-webhook-secret") ??
      url.searchParams.get("secret") ??
      url.searchParams.get("token");
    if (!supplied || !constantTimeEqual(supplied, expectedSecret)) {
      return json({ error: "Invalid lemlist webhook secret" }, { status: 401 });
    }
  }

  const eventType = normalizeEventType(payload.type);
  const idempotencyKey = lemlistIdempotencyKey(payload);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO lemlist_events (
        lemlist_event_id, idempotency_key, event_type, lemlist_campaign_id,
        lemlist_lead_id, lead_email, payload, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'received')
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        lemlistEventId(payload),
        idempotencyKey,
        eventType,
        lemlistCampaignId(payload),
        lemlistLeadId(payload),
        lemlistLeadEmail(payload),
        JSON.stringify(payload),
      ],
    );
    if (!inserted.rows[0]) {
      await client.query("COMMIT");
      return json({ ok: true, duplicate: true });
    }
    try {
      await processLemlistEvent(client, inserted.rows[0].id, payload);
    } catch (error) {
      await client.query(
        "UPDATE lemlist_events SET status = 'failed', error = $1, processed_at = now() WHERE id = $2",
        [error instanceof Error ? error.message : "Webhook processing failed", inserted.rows[0].id],
      );
      throw error;
    }
    await client.query("COMMIT");
    return json({ ok: true, eventId: inserted.rows[0].id });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function lemlistEvents(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const rows = await getPool().query(`
    SELECT e.*, c.first_name, c.last_name, o.name AS organization_name, d.title AS deal_title
    FROM lemlist_events e
    LEFT JOIN contacts c ON c.id = e.contact_id
    LEFT JOIN organizations o ON o.id = e.organization_id
    LEFT JOIN deals d ON d.id = e.deal_id
    ORDER BY e.created_at DESC
    LIMIT 200
  `);
  return json({ events: rows.rows });
}

async function reprocessLemlistEvents(request: Request) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = await readJson(request);
  const eventIds = Array.isArray(body.eventIds)
    ? body.eventIds.filter((id: unknown): id is string => typeof id === "string")
    : [];
  const client = await getPool().connect();
  const processed: string[] = [];
  try {
    await client.query("BEGIN");
    const rows = await client.query(
      `SELECT id, payload FROM lemlist_events
       WHERE status = 'failed' OR id = ANY($1::uuid[])
       ORDER BY created_at
       LIMIT 25`,
      [eventIds],
    );
    for (const row of rows.rows) {
      await processLemlistEvent(client, row.id, asRecord(row.payload));
      processed.push(row.id);
    }
    await audit(client, "lemlist_events_reprocess", "integration", null, { processed }, auth.user);
    await client.query("COMMIT");
    return json({ ok: true, processed });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createDealFromCampaignReply(request: Request, linkId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const body = await readJson(request);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const link = await client.query(
      `SELECT ll.*, c.first_name, c.last_name, c.email, c.role_title, o.name AS organization_name,
        lc.name AS campaign_name, lc.lemlist_campaign_id AS campaign_lemlist_id
       FROM lemlist_lead_links ll
       LEFT JOIN contacts c ON c.id = ll.contact_id
       LEFT JOIN organizations o ON o.id = COALESCE(ll.organization_id, c.organization_id)
       JOIN lemlist_campaigns lc ON lc.id = ll.campaign_id
       WHERE ll.id = $1
       FOR UPDATE`,
      [linkId],
    );
    if (!link.rows[0]) {
      await client.query("ROLLBACK");
      return json({ error: "Campaign contact not found" }, { status: 404 });
    }
    if (link.rows[0].deal_id) {
      await client.query("COMMIT");
      return json({ ok: true, dealId: link.rows[0].deal_id, existing: true });
    }
    const stage = await client.query(
      "SELECT id FROM pipeline_stages WHERE is_terminal = false ORDER BY position LIMIT 1",
    );
    if (!stage.rows[0]) {
      await client.query("ROLLBACK");
      return json({ error: "No open pipeline stage is configured" }, { status: 400 });
    }
    const contactName =
      [link.rows[0].first_name, link.rows[0].last_name].filter(Boolean).join(" ") ||
      link.rows[0].email;
    const deal = await client.query(
      `INSERT INTO deals (
        organization_id, primary_contact_id, stage_id, title, source, service_interest,
        description, owner_id, campaign_source, probability, next_activity_at
       )
       VALUES ($1, $2, $3, $4, 'lemlist', 'Growth campaign reply', $5, $6, $7, 50, now() + interval '1 day')
       RETURNING id`,
      [
        link.rows[0].organization_id,
        link.rows[0].contact_id,
        stage.rows[0].id,
        `Campaign reply - ${contactName}`,
        `Created from interested/replied lemlist campaign contact in ${link.rows[0].campaign_name}.`,
        auth.user.id,
        link.rows[0].campaign_name,
      ],
    );
    await client.query(
      "UPDATE lemlist_lead_links SET deal_id = $1, updated_at = now() WHERE id = $2",
      [deal.rows[0].id, linkId],
    );
    await client.query(
      `INSERT INTO activities (deal_id, contact_id, organization_id, actor_id, type, title, body, lemlist_campaign_id)
       VALUES ($1, $2, $3, $4, 'campaign_reply_deal_created', 'Created deal from campaign reply', $5, $6)`,
      [
        deal.rows[0].id,
        link.rows[0].contact_id,
        link.rows[0].organization_id,
        auth.user.id,
        `Campaign contact status: ${link.rows[0].status}`,
        link.rows[0].campaign_lemlist_id,
      ],
    );
    await audit(
      client,
      "campaign_reply_deal_created",
      "deal",
      deal.rows[0].id,
      { linkId },
      auth.user,
    );
    await client.query("COMMIT");
    return json({ ok: true, dealId: deal.rows[0].id }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function growthSegments(request: Request) {
  const auth = await requireUser(request, ["admin", "staff", "viewer"]);
  if (auth.response) return auth.response;
  const views = await getPool().query("SELECT * FROM crm_saved_views ORDER BY name");
  return json({ segments: views.rows });
}

async function growthRecommendations(request: Request) {
  const auth = await requireUser(request, ["admin", "staff", "viewer"]);
  if (auth.response) return auth.response;
  const rows = await getPool().query(`
    SELECT r.id, r.recommendation_type, r.title, r.body, r.confidence, r.status,
      r.requires_approval, r.payload, r.created_at, r.lemlist_campaign_id,
      c.first_name, c.last_name, c.email, d.title AS deal_title, o.name AS organization_name
    FROM ai_recommendations r
    LEFT JOIN contacts c ON c.id = r.contact_id
    LEFT JOIN deals d ON d.id = r.deal_id
    LEFT JOIN organizations o ON o.id = r.organization_id
    WHERE r.status = 'pending'
      AND (
        r.lemlist_campaign_id IS NOT NULL
        OR r.recommendation_type IN (
          'campaign_enrollment', 'quote_follow_up', 'dormant_reactivation',
          'partner_outreach', 'reply_handling', 'pipeline_hygiene',
          'kpi_review', 'campaign_intelligence'
        )
      )
    ORDER BY r.created_at DESC
    LIMIT 100
  `);
  return json({ recommendations: rows.rows });
}

async function approveGrowthRecommendation(request: Request, recommendationId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT * FROM ai_recommendations WHERE id = $1 FOR UPDATE",
      [recommendationId],
    );
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return json({ error: "Recommendation not found" }, { status: 404 });
    }
    let execution: unknown = null;
    const payload = asRecord(current.rows[0].payload);
    const contactId = optionalString(payload.contactId) ?? optionalString(payload.contact_id);
    const campaignId = optionalString(payload.campaignId) ?? optionalString(payload.campaign_id);
    if (current.rows[0].recommendation_type === "campaign_enrollment" && contactId && campaignId) {
      execution = await enrollOneLead(
        client,
        contactId,
        campaignId,
        auth.user,
        "steve_recommendation",
      );
    }
    const row = await client.query(
      `UPDATE ai_recommendations
       SET status = $1,
           decided_by = $2,
           decided_at = now(),
           outcome = $3,
           outcome_at = now()
       WHERE id = $4
       RETURNING *`,
      [
        execution && !(execution as { ok?: boolean }).ok ? "approved" : "approved",
        auth.user.id,
        execution
          ? (execution as { ok?: boolean }).ok
            ? "executed_enrollment"
            : "enrollment_blocked"
          : "approved",
        recommendationId,
      ],
    );
    await audit(
      client,
      "growth_recommendation_approved",
      "ai_recommendation",
      recommendationId,
      { recommendationType: row.rows[0].recommendation_type, execution },
      auth.user,
    );
    await client.query("COMMIT");
    return json({ ok: true, recommendation: row.rows[0], execution });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function dismissGrowthRecommendation(request: Request, recommendationId: string) {
  const auth = await requireUser(request, ["admin", "staff"]);
  if (auth.response) return auth.response;
  const result = await getPool().query(
    "UPDATE ai_recommendations SET status = 'rejected', decided_by = $1, decided_at = now(), outcome = 'dismissed', outcome_at = now() WHERE id = $2 RETURNING *",
    [auth.user.id, recommendationId],
  );
  if (!result.rows[0]) return json({ error: "Recommendation not found" }, { status: 404 });
  await audit(
    getPool(),
    "growth_recommendation_dismissed",
    "ai_recommendation",
    recommendationId,
    {},
    auth.user,
  );
  return json({ ok: true, recommendation: result.rows[0] });
}

async function growthCampaignPerformance(request: Request) {
  const auth = await requireUser(request, ["admin", "staff", "viewer"]);
  if (auth.response) return auth.response;
  const rows = await getPool().query(`
    SELECT lc.id, lc.lemlist_campaign_id, lc.name, lc.status, lc.purpose, lc.segment, lc.metrics_snapshot,
      COALESCE((lc.raw->>'archived')::boolean, false) AS archived,
      count(ll.id)::int AS enrolled,
      count(ll.id) FILTER (WHERE ll.replied_at IS NOT NULL)::int AS replies,
      count(ll.id) FILTER (WHERE ll.interested_at IS NOT NULL)::int AS interested,
      count(ll.id) FILTER (WHERE ll.meeting_booked_at IS NOT NULL)::int AS meetings,
      count(ll.id) FILTER (WHERE ll.bounced_at IS NOT NULL)::int AS bounces,
      count(ll.id) FILTER (WHERE ll.unsubscribed_at IS NOT NULL)::int AS unsubscribes
    FROM lemlist_campaigns lc
    LEFT JOIN lemlist_lead_links ll ON ll.campaign_id = lc.id
    WHERE COALESCE((lc.raw->>'archived')::boolean, false) = false
    GROUP BY lc.id
    ORDER BY
      CASE lc.status WHEN 'running' THEN 0 WHEN 'active' THEN 1 WHEN 'draft' THEN 2 WHEN 'ended' THEN 3 ELSE 4 END,
      lc.raw->>'createdAt' DESC NULLS LAST,
      lc.updated_at DESC
  `);
  return json({ campaigns: rows.rows });
}

async function quoteFollowups(request: Request) {
  const auth = await requireUser(request, ["admin", "staff", "viewer"]);
  if (auth.response) return auth.response;
  const rows = await getPool().query(`
    SELECT d.id, d.title, d.value_cents, d.currency, d.updated_at, d.next_activity_at,
      o.name AS organization_name, c.id AS contact_id, c.first_name, c.last_name, c.email,
      u.name AS owner_name
    FROM deals d
    LEFT JOIN pipeline_stages s ON s.id = d.stage_id
    LEFT JOIN organizations o ON o.id = d.organization_id
    LEFT JOIN contacts c ON c.id = d.primary_contact_id
    LEFT JOIN app_users u ON u.id = d.owner_id
    WHERE d.status = 'open'
      AND (s.name ILIKE '%quote%' OR s.name ILIKE '%proposal%' OR d.service_interest ILIKE '%quote%')
    ORDER BY COALESCE(d.next_activity_at, d.updated_at) ASC
    LIMIT 200
  `);
  return json({ quoteFollowups: rows.rows });
}

async function dormantClients(request: Request) {
  const auth = await requireUser(request, ["admin", "staff", "viewer"]);
  if (auth.response) return auth.response;
  const rows = await getPool().query(`
    SELECT o.id, o.name, o.account_type, o.account_health, o.last_activity_at,
      (array_agg(c.id ORDER BY c.updated_at DESC) FILTER (WHERE c.id IS NOT NULL))[1] AS contact_id,
      (array_agg(c.email ORDER BY c.updated_at DESC) FILTER (WHERE c.email IS NOT NULL))[1] AS email,
      count(c.id)::int AS contacts,
      max(c.last_meaningful_activity_at) AS last_contact_activity,
      u.name AS owner_name
    FROM organizations o
    LEFT JOIN contacts c ON c.organization_id = o.id
    LEFT JOIN app_users u ON u.id = COALESCE(o.owner_id, c.owner_id)
    WHERE o.is_client = true
       OR EXISTS (SELECT 1 FROM deals d WHERE d.organization_id = o.id AND d.status IN ('won', 'open'))
    GROUP BY o.id, u.name
    HAVING COALESCE(o.last_activity_at, max(c.last_meaningful_activity_at), o.updated_at) < now() - interval '90 days'
    ORDER BY COALESCE(o.last_activity_at, max(c.last_meaningful_activity_at), o.updated_at) ASC
    LIMIT 200
  `);
  return json({ dormantClients: rows.rows });
}

async function partnerProspects(request: Request) {
  const auth = await requireUser(request, ["admin", "staff", "viewer"]);
  if (auth.response) return auth.response;
  const rows = await getPool().query(`
    SELECT o.id, o.name, o.account_type, o.region, o.account_status, o.last_activity_at,
      (array_agg(c.id ORDER BY c.updated_at DESC) FILTER (WHERE c.id IS NOT NULL))[1] AS contact_id,
      (array_agg(c.email ORDER BY c.updated_at DESC) FILTER (WHERE c.email IS NOT NULL))[1] AS email,
      count(c.id)::int AS contacts,
      u.name AS owner_name
    FROM organizations o
    LEFT JOIN contacts c ON c.organization_id = o.id
    LEFT JOIN app_users u ON u.id = COALESCE(o.owner_id, c.owner_id)
    WHERE o.is_partner = true
       OR o.account_type ILIKE '%partner%'
       OR o.name ILIKE '%partner%'
       OR o.industry ILIKE '%insurance%'
       OR o.industry ILIKE '%sprinkler%'
    GROUP BY o.id, u.name
    ORDER BY COALESCE(o.last_activity_at, o.updated_at) DESC
    LIMIT 200
  `);
  return json({ partnerProspects: rows.rows });
}

export async function handleApiRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    if (path === "/health") return json({ ok: true });
    if (path === "/ready") {
      await getPool().query("SELECT 1");
      return json({ ok: true, database: "ready" });
    }

    if (!path.startsWith("/api/")) return null;

    if (request.method === "POST" && path === "/api/internal/rag/search")
      return internalRagSearch(request);
    if (
      (request.method === "GET" || request.method === "POST") &&
      path === "/api/internal/rag/pending"
    )
      return internalRagPending(request);
    if (request.method === "POST" && path === "/api/internal/rag/embedding")
      return internalRagEmbedding(request);
    if (request.method === "POST" && path === "/api/internal/whatsapp/resolve-user")
      return internalWhatsAppResolveUser(request);
    if (request.method === "POST" && path === "/api/internal/whatsapp/agent-context")
      return internalWhatsAppAgentContext(request);
    if (request.method === "POST" && path === "/api/internal/whatsapp/actions")
      return internalWhatsAppActions(request);
    if (request.method === "POST" && path === "/api/internal/whatsapp/respond")
      return internalWhatsAppRespond(request);
    if (request.method === "POST" && path === "/api/internal/staff-agent/context")
      return internalStaffAgentContext(request);
    if (request.method === "POST" && path === "/api/internal/staff-agent/actions")
      return internalStaffAgentActions(request);

    if (request.method === "POST" && path === "/api/auth/login")
      return handlePasswordLogin(request);
    if (request.method === "GET" && path === "/api/auth/microsoft/status")
      return microsoftAuthStatus(request);
    if (request.method === "GET" && path === "/api/auth/microsoft/start")
      return startMicrosoftLogin(request);
    if (request.method === "GET" && path === "/api/auth/microsoft/callback")
      return handleMicrosoftCallback(request);
    if (request.method === "POST" && path === "/api/auth/logout") return handleLogout(request);
    if (request.method === "GET" && path === "/api/auth/me") {
      const user = await getSessionUser(request);
      return user ? json({ user }) : unauthorized();
    }

    if (request.method === "GET" && path === "/api/crm/dashboard") return dashboard(request);
    if (request.method === "GET" && path === "/api/crm/pipeline") return pipeline(request);
    if (request.method === "GET" && path === "/api/crm/contacts") return contacts(request);
    if (request.method === "POST" && path === "/api/crm/contacts")
      return createStaffContact(request);
    if (request.method === "POST" && path === "/api/crm/contacts/image-intake")
      return createStaffContactFromImage(request);
    const contactDetailMatch = path.match(/^\/api\/crm\/contacts\/([^/]+)$/);
    if (request.method === "GET" && contactDetailMatch?.[1])
      return contactDetail(request, contactDetailMatch[1]);
    const contactBasisMatch = path.match(/^\/api\/crm\/contacts\/([^/]+)\/outreach-basis$/);
    if (request.method === "PATCH" && contactBasisMatch?.[1])
      return updateContactOutreachBasis(request, contactBasisMatch[1]);
    const contactSuppressionMatch = path.match(/^\/api\/crm\/contacts\/([^/]+)\/suppressions$/);
    if (request.method === "POST" && contactSuppressionMatch?.[1])
      return createContactSuppression(request, contactSuppressionMatch[1]);
    const contactTaskMatch = path.match(/^\/api\/crm\/contacts\/([^/]+)\/tasks$/);
    if (request.method === "POST" && contactTaskMatch?.[1])
      return createContactTask(request, contactTaskMatch[1]);
    const suppressionMatch = path.match(/^\/api\/crm\/suppressions\/([^/]+)$/);
    if (request.method === "PATCH" && suppressionMatch?.[1])
      return updateSuppression(request, suppressionMatch[1]);
    if (request.method === "GET" && path === "/api/integrations/lemlist/health")
      return lemlistHealth(request);
    if (request.method === "GET" && path === "/api/integrations/microsoft/health")
      return microsoftHealth(request);
    if (request.method === "GET" && path === "/api/microsoft/status")
      return microsoftGraphStatus(request);
    if (request.method === "GET" && path === "/api/microsoft/emails")
      return microsoftEmails(request);
    const microsoftEmailDetailMatch = path.match(/^\/api\/microsoft\/emails\/(.+)$/);
    if (request.method === "GET" && microsoftEmailDetailMatch?.[1])
      return microsoftEmailDetail(request, decodeURIComponent(microsoftEmailDetailMatch[1]));
    if (request.method === "GET" && path === "/api/microsoft/docs") return microsoftDocs(request);
    if (request.method === "POST" && path === "/api/microsoft/email-drafts")
      return microsoftDraftEmail(request);
    if (
      (request.method === "GET" || request.method === "POST") &&
      path === "/api/microsoft/ai-email-drafts"
    )
      return microsoftAiEmailDrafts(request);
    const microsoftAiDraftApproveMatch = path.match(
      /^\/api\/microsoft\/ai-email-drafts\/([^/]+)\/approve$/,
    );
    if (request.method === "POST" && microsoftAiDraftApproveMatch?.[1])
      return microsoftAiEmailDraftApprove(request, microsoftAiDraftApproveMatch[1]);
    const microsoftAiDraftMatch = path.match(/^\/api\/microsoft\/ai-email-drafts\/([^/]+)$/);
    if ((request.method === "PATCH" || request.method === "DELETE") && microsoftAiDraftMatch?.[1])
      return microsoftAiEmailDraftDetail(request, microsoftAiDraftMatch[1]);
    if (request.method === "GET" && path === "/api/integrations/lemlist/campaigns")
      return lemlistCampaigns(request);
    const lemlistCampaignDetailMatch = path.match(
      /^\/api\/integrations\/lemlist\/campaigns\/([^/]+)$/,
    );
    if (request.method === "GET" && lemlistCampaignDetailMatch?.[1])
      return lemlistCampaignDetail(request, lemlistCampaignDetailMatch[1]);
    if (request.method === "POST" && path === "/api/integrations/lemlist/campaigns/sync")
      return syncLemlistCampaigns(request);
    if (request.method === "POST" && path === "/api/integrations/lemlist/leads/enroll")
      return lemlistEnrollLead(request);
    if (request.method === "POST" && path === "/api/integrations/lemlist/leads/bulk-enroll")
      return lemlistBulkEnrollLeads(request);
    if (request.method === "GET" && path === "/api/integrations/lemlist/events")
      return lemlistEvents(request);
    if (request.method === "POST" && path === "/api/integrations/lemlist/events/reprocess")
      return reprocessLemlistEvents(request);
    const replyDealMatch = path.match(/^\/api\/crm\/growth\/replies\/([^/]+)\/create-deal$/);
    if (request.method === "POST" && replyDealMatch?.[1])
      return createDealFromCampaignReply(request, replyDealMatch[1]);
    if (request.method === "GET" && path === "/api/crm/growth/segments")
      return growthSegments(request);
    if (request.method === "GET" && path === "/api/crm/growth/recommendations")
      return growthRecommendations(request);
    const growthApproveMatch = path.match(
      /^\/api\/crm\/growth\/recommendations\/([^/]+)\/approve$/,
    );
    if (request.method === "POST" && growthApproveMatch?.[1])
      return approveGrowthRecommendation(request, growthApproveMatch[1]);
    const growthDismissMatch = path.match(
      /^\/api\/crm\/growth\/recommendations\/([^/]+)\/dismiss$/,
    );
    if (request.method === "POST" && growthDismissMatch?.[1])
      return dismissGrowthRecommendation(request, growthDismissMatch[1]);
    if (request.method === "GET" && path === "/api/crm/growth/campaign-performance")
      return growthCampaignPerformance(request);
    if (request.method === "GET" && path === "/api/crm/growth/quote-followups")
      return quoteFollowups(request);
    if (request.method === "GET" && path === "/api/crm/growth/dormant-clients")
      return dormantClients(request);
    if (request.method === "GET" && path === "/api/crm/growth/partner-prospects")
      return partnerProspects(request);
    const dealDetailMatch = path.match(/^\/api\/crm\/deals\/([^/]+)$/);
    if (request.method === "GET" && dealDetailMatch?.[1])
      return dealDetail(request, dealDetailMatch[1]);
    if (request.method === "GET" && path === "/api/ops/overview") return opsOverview(request);
    if (request.method === "GET" && path === "/api/operating-os/overview")
      return operatingOverview(request);
    if (path === "/api/clients" && (request.method === "GET" || request.method === "POST"))
      return clientFolders(request);
    const clientFolderMatch = path.match(/^\/api\/clients\/([^/]+)$/);
    if (clientFolderMatch?.[1] && (request.method === "GET" || request.method === "PATCH"))
      return clientFolderDetail(request, clientFolderMatch[1]);
    if (path === "/api/pos" && (request.method === "GET" || request.method === "POST"))
      return poInbox(request);
    if (request.method === "POST" && path === "/api/orders/sales-drafts")
      return salesOrderDraft(request);
    if (path === "/api/field/jobs" && (request.method === "GET" || request.method === "POST"))
      return fieldWork(request);
    if (path === "/api/field/job-cards" && (request.method === "GET" || request.method === "POST"))
      return jobCards(request);
    if (request.method === "GET" && path === "/api/compliance-context")
      return complianceContext(request);
    if (path === "/api/site-visits" && (request.method === "GET" || request.method === "POST"))
      return siteVisits(request);
    if (
      path === "/api/compliance-records" &&
      (request.method === "GET" || request.method === "POST")
    )
      return complianceRecords(request);
    const complianceRecordLinkMatch = path.match(/^\/api\/compliance-records\/([^/]+)$/);
    if (request.method === "PATCH" && complianceRecordLinkMatch?.[1])
      return complianceRecordLinks(request, complianceRecordLinkMatch[1]);
    const projectQrMatch = path.match(/^\/api\/projects\/([^/]+)\/qr$/);
    if (projectQrMatch?.[1] && (request.method === "GET" || request.method === "POST"))
      return projectQrManagement(request, projectQrMatch[1]);
    const projectQrRevokeMatch = path.match(/^\/api\/project-qr-identities\/([^/]+)\/revoke$/);
    if (request.method === "POST" && projectQrRevokeMatch?.[1])
      return projectQrRevoke(request, projectQrRevokeMatch[1]);
    const projectGrantMatch = path.match(/^\/api\/projects\/([^/]+)\/access-grants$/);
    if (request.method === "POST" && projectGrantMatch?.[1])
      return projectAccessGrants(request, projectGrantMatch[1]);
    const projectGrantRevokeMatch = path.match(/^\/api\/project-access-grants\/([^/]+)\/revoke$/);
    if (request.method === "POST" && projectGrantRevokeMatch?.[1])
      return projectAccessGrantRevoke(request, projectGrantRevokeMatch[1]);
    const projectScanMatch = path.match(/^\/api\/project-scan\/([^/]+)$/);
    if (request.method === "GET" && projectScanMatch?.[1])
      return projectScan(request, projectScanMatch[1]);
    const projectStickerMatch = path.match(/^\/api\/projects\/([^/]+)\/sticker$/);
    if (request.method === "POST" && projectStickerMatch?.[1])
      return projectSticker(request, projectStickerMatch[1]);
    if (request.method === "POST" && path === "/api/field/job-links") return createJobLink(request);
    if (request.method === "POST" && path === "/api/field/subcontractor-pos")
      return issueSubcontractorPo(request);
    if (request.method === "POST" && path === "/api/field/submissions")
      return fieldSubmission(request);
    if (
      path === "/api/checklist-templates" &&
      (request.method === "GET" || request.method === "POST")
    )
      return checklistTemplates(request);
    const checklistTemplateDetailMatch = path.match(/^\/api\/checklist-templates\/([^/]+)$/);
    if (request.method === "GET" && checklistTemplateDetailMatch?.[1])
      return checklistTemplateDetail(request, checklistTemplateDetailMatch[1]);
    const checklistTemplateVersionMatch = path.match(
      /^\/api\/checklist-templates\/([^/]+)\/versions$/,
    );
    if (request.method === "POST" && checklistTemplateVersionMatch?.[1])
      return checklistTemplateVersion(request, checklistTemplateVersionMatch[1]);
    if (request.method === "POST" && path === "/api/inspections") return createInspection(request);
    if (request.method === "GET" && path === "/api/inspection-capture/context")
      return inspectionCaptureContext(request);
    if (request.method === "GET" && path === "/api/inspections") return inspectionsList(request);
    if (
      path === "/api/consulting-stages" &&
      (request.method === "GET" || request.method === "POST")
    )
      return consultingStages(request);
    const consultingStageReportMatch = path.match(/^\/api\/consulting-stages\/([^/]+)\/report$/);
    if (request.method === "POST" && consultingStageReportMatch?.[1])
      return consultingStageReport(request, consultingStageReportMatch[1]);
    const consultingStageMatch = path.match(/^\/api\/consulting-stages\/([^/]+)$/);
    if (consultingStageMatch?.[1] && (request.method === "GET" || request.method === "PATCH"))
      return consultingStageDetail(request, consultingStageMatch[1]);
    const consultingReportMatch = path.match(/^\/api\/consulting-reports\/([^/]+)$/);
    if (request.method === "GET" && consultingReportMatch?.[1])
      return consultingReportDetail(request, consultingReportMatch[1]);
    if (
      path === "/api/inspection-reports" &&
      (request.method === "GET" || request.method === "POST")
    )
      return inspectionReports(request);
    const inspectionReportDetailMatch = path.match(/^\/api\/inspection-reports\/([^/]+)$/);
    if (request.method === "GET" && inspectionReportDetailMatch?.[1])
      return inspectionReportDetail(request, inspectionReportDetailMatch[1]);
    const inspectionEvidenceFileMatch = path.match(/^\/api\/inspection-evidence\/([^/]+)$/);
    if (request.method === "GET" && inspectionEvidenceFileMatch?.[1])
      return inspectionEvidenceFile(request, inspectionEvidenceFileMatch[1]);
    const inspectionResponsesMatch = path.match(/^\/api\/inspections\/([^/]+)\/responses$/);
    if (request.method === "POST" && inspectionResponsesMatch?.[1])
      return inspectionResponses(request, inspectionResponsesMatch[1]);
    const inspectionEvidenceMatch = path.match(/^\/api\/inspections\/([^/]+)\/evidence$/);
    if (request.method === "POST" && inspectionEvidenceMatch?.[1])
      return inspectionEvidence(request, inspectionEvidenceMatch[1]);
    const inspectionCompleteMatch = path.match(/^\/api\/inspections\/([^/]+)\/complete$/);
    if (request.method === "POST" && inspectionCompleteMatch?.[1])
      return completeInspection(request, inspectionCompleteMatch[1]);
    const inspectionSignatureMatch = path.match(/^\/api\/inspections\/([^/]+)\/signature$/);
    if (request.method === "POST" && inspectionSignatureMatch?.[1])
      return saveInspectionSignature(request, inspectionSignatureMatch[1]);
    const inspectionDetailMatch = path.match(/^\/api\/inspections\/([^/]+)$/);
    if (request.method === "GET" && inspectionDetailMatch?.[1])
      return inspectionDetail(request, inspectionDetailMatch[1]);
    if (request.method === "POST" && path === "/api/client-signoff-links")
      return createClientSignoffLink(request);
    const clientSignoffEvidenceMatch = path.match(
      /^\/api\/client-signoff\/([^/]+)\/evidence\/([^/]+)$/,
    );
    if (request.method === "GET" && clientSignoffEvidenceMatch?.[1] && clientSignoffEvidenceMatch[2])
      return clientSignoffEvidence(
        request,
        clientSignoffEvidenceMatch[1],
        clientSignoffEvidenceMatch[2],
      );
    const clientSignoffMatch = path.match(/^\/api\/client-signoff\/([^/]+)$/);
    if (clientSignoffMatch?.[1] && request.method === "GET")
      return clientSignoffContext(request, clientSignoffMatch[1]);
    if (clientSignoffMatch?.[1] && request.method === "POST")
      return clientSignoffSubmit(request, clientSignoffMatch[1]);
    const subcontractorPoMatch = path.match(/^\/api\/subcontractor-pos\/([^/]+)$/);
    if (subcontractorPoMatch?.[1] && request.method === "PATCH")
      return subcontractorPos(request, subcontractorPoMatch[1]);
    if (request.method === "GET" && path === "/api/assets-risk") return assetsRisk(request);
    if (request.method === "POST" && path === "/api/assets-risk/sites")
      return createOperatingSite(request);
    if (request.method === "POST" && path === "/api/assets-risk/assets")
      return createOperatingAsset(request);
    const assetEvidenceMatch = path.match(/^\/api\/assets-risk\/assets\/([^/]+)\/evidence$/);
    if (request.method === "POST" && assetEvidenceMatch?.[1])
      return assetEvidence(request, assetEvidenceMatch[1]);
    if (request.method === "POST" && path === "/api/inspection-capture/buildings")
      return createInspectionHierarchy(request, "building");
    if (request.method === "POST" && path === "/api/inspection-capture/floors")
      return createInspectionHierarchy(request, "floor");
    if (request.method === "POST" && path === "/api/inspection-capture/areas")
      return createInspectionHierarchy(request, "area");
    if (request.method === "POST" && path === "/api/assets-risk/risks") return createRisk(request);
    if (path === "/api/subcontractors" && (request.method === "GET" || request.method === "POST"))
      return subcontractorDirectory(request);
    const subcontractorDetailMatch = path.match(/^\/api\/subcontractors\/([^/]+)$/);
    if (request.method === "PATCH" && subcontractorDetailMatch?.[1])
      return subcontractorDetail(request, subcontractorDetailMatch[1]);
    if (path === "/api/steve/approvals" && (request.method === "GET" || request.method === "POST"))
      return approvalRequests(request);
    const approvalDecisionMatch = path.match(/^\/api\/steve\/approvals\/([^/]+)$/);
    if (request.method === "PATCH" && approvalDecisionMatch?.[1])
      return approvalRequestDecision(request, approvalDecisionMatch[1]);
    if (request.method === "GET" && path === "/api/staff/kpi-dashboard")
      return staffKpiDashboard(request);
    if (path === "/api/capability-checklist" && (request.method === "GET" || request.method === "POST"))
      return capabilityChecklist(request);
    if (request.method === "GET" && path === "/api/staff/chat/status")
      return staffChatStatus(request);
    if (request.method === "GET" && path === "/api/staff/chat/entities")
      return staffChatEntities(request);
    if (
      path === "/api/staff/chat/sessions" &&
      (request.method === "GET" || request.method === "POST")
    )
      return staffChatSessions(request);
    if (request.method === "POST" && path === "/api/staff/chat/uploads")
      return staffChatUpload(request);
    if (path === "/api/tasks" && (request.method === "GET" || request.method === "POST"))
      return workBoard(request);
    if (request.method === "GET" && path === "/api/schedule") return schedule(request);
    if (request.method === "GET" && path === "/api/steve/overview") return steveOverview(request);
    if (request.method === "POST" && path === "/api/steve/ask") return steveAsk(request);
    if (request.method === "POST" && path === "/api/steve/actions") return steveAction(request);
    if (request.method === "GET" && path === "/api/reports/summary") return reportsSummary(request);
    if (request.method === "GET" && path === "/api/settings/summary")
      return settingsSummary(request);
    if (request.method === "GET" && path === "/api/settings/whatsapp-operations")
      return whatsappOperations(request);
    const whatsappRetryMatch = path.match(/^\/api\/settings\/whatsapp-outbox\/([^/]+)\/retry$/);
    if (request.method === "POST" && whatsappRetryMatch?.[1])
      return whatsappOutboxRetry(request, whatsappRetryMatch[1]);
    if (
      path === "/api/settings/whatsapp-approved-users" &&
      (request.method === "GET" || request.method === "POST")
    )
      return whatsappApprovedUsers(request);
    const whatsappApprovalMatch = path.match(/^\/api\/settings\/whatsapp-approved-users\/([^/]+)$/);
    if (request.method === "PATCH" && whatsappApprovalMatch?.[1])
      return whatsappApprovedUserDetail(request, whatsappApprovalMatch[1]);
    if (path === "/api/projects" && (request.method === "GET" || request.method === "POST"))
      return projects(request);
    if (path === "/api/billing/invoices" && (request.method === "GET" || request.method === "POST"))
      return invoices(request);
    if (request.method === "GET" && path === "/api/billing/payment-release")
      return paymentReleaseView(request);
    if (request.method === "GET" && path === "/api/quote-support") return quoteSupport(request);
    if (path === "/api/quote-templates" && (request.method === "GET" || request.method === "POST"))
      return quoteTemplates(request);
    if (path === "/api/quotes" && (request.method === "GET" || request.method === "POST"))
      return quotes(request);
    const quoteDetailMatch = path.match(/^\/api\/quotes\/([^/]+)$/);
    if (quoteDetailMatch?.[1] && (request.method === "GET" || request.method === "PATCH"))
      return quoteDetail(request, quoteDetailMatch[1]);
    const quoteStatusMatch = path.match(/^\/api\/quotes\/([^/]+)\/status$/);
    if (request.method === "PATCH" && quoteStatusMatch?.[1])
      return quoteStatus(request, quoteStatusMatch[1]);
    const quoteValidateMatch = path.match(/^\/api\/quotes\/([^/]+)\/validate$/);
    if (request.method === "POST" && quoteValidateMatch?.[1])
      return validateQuote(request, quoteValidateMatch[1]);

    const stageMatch = path.match(/^\/api\/crm\/deals\/([^/]+)\/stage$/);
    if (request.method === "PATCH" && stageMatch?.[1]) return moveDealStage(request, stageMatch[1]);

    const taskStageMatch = path.match(/^\/api\/tasks\/([^/]+)\/stage$/);
    if (request.method === "PATCH" && taskStageMatch?.[1])
      return moveTaskStage(request, taskStageMatch[1]);

    const taskCommentsMatch = path.match(/^\/api\/tasks\/([^/]+)\/comments$/);
    if (request.method === "POST" && taskCommentsMatch?.[1])
      return addTaskComment(request, taskCommentsMatch[1]);

    const taskDetailMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (request.method === "GET" && taskDetailMatch?.[1])
      return taskDetail(request, taskDetailMatch[1]);
    if (request.method === "PATCH" && taskDetailMatch?.[1])
      return updateTask(request, taskDetailMatch[1]);

    const chatSessionMatch = path.match(/^\/api\/staff\/chat\/sessions\/([^/]+)$/);
    if (chatSessionMatch?.[1] && (request.method === "PATCH" || request.method === "DELETE"))
      return staffChatSessionDetail(request, chatSessionMatch[1]);

    const chatMessagesMatch = path.match(/^\/api\/staff\/chat\/sessions\/([^/]+)\/messages$/);
    if (chatMessagesMatch?.[1] && (request.method === "GET" || request.method === "POST"))
      return staffChatMessages(request, chatMessagesMatch[1]);
    const chatOneDriveMatch = path.match(/^\/api\/staff\/chat\/sessions\/([^/]+)\/onedrive-links$/);
    if (request.method === "POST" && chatOneDriveMatch?.[1])
      return staffChatLinkOneDriveFile(request, chatOneDriveMatch[1]);

    const convertMatch = path.match(/^\/api\/deals\/([^/]+)\/convert-to-project$/);
    if (request.method === "POST" && convertMatch?.[1])
      return convertDealToProject(request, convertMatch[1]);

    if (request.method === "POST" && path === "/api/lead-capture") {
      const payload = await readJson(request);
      const lead = await createLead({ ...payload, source: payload.source ?? "public_form" });
      return json({ ok: true, lead }, { status: 201 });
    }

    if (request.method === "POST" && path === "/api/webhooks/n8n/form-submission")
      return handleWebhook(request);
    if (request.method === "POST" && path === "/api/webhooks/n8n/automation-event")
      return automationEvent(request);
    if (request.method === "POST" && path === "/api/webhooks/lemlist")
      return lemlistWebhook(request);
    if (request.method === "POST" && path === "/api/webhooks/whatsapp/inbound")
      return whatsappInbound(request);
    if (request.method === "POST" && path === "/api/search/semantic")
      return semanticSearch(request);

    const hermesMatch = path.match(/^\/api\/hermes\/tools\/([^/]+)$/);
    if (request.method === "POST" && hermesMatch?.[1]) return hermesTool(request, hermesMatch[1]);

    if (request.method === "POST" && path === "/api/internal/messenger/outbox/claim")
      return messengerOutboxClaim(request);
    const messengerResultMatch = path.match(
      /^\/api\/internal\/messenger\/outbox\/([^/]+)\/result$/,
    );
    if (request.method === "POST" && messengerResultMatch?.[1])
      return messengerOutboxResult(request, messengerResultMatch[1]);

    return json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Unexpected API error";
    return json({ error: message }, { status: message.includes("required") ? 400 : 500 });
  }
}
