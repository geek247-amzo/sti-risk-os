import crypto from "node:crypto";
import https from "node:https";
import type pg from "pg";

type JsonRecord = Record<string, unknown>;

type YeastarResponse = {
  errcode?: number;
  errmsg?: string;
  total_number?: number;
  data?: unknown;
};

let pollInProgress = false;
let pollTimer: NodeJS.Timeout | undefined;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function certificateCheck(host: string, certificate: { raw?: Buffer }) {
  const expected = requiredEnv("YEASTAR_TLS_CERT_SHA256").replace(/:/g, "").toLowerCase();
  const actual = certificate.raw
    ? crypto.createHash("sha256").update(certificate.raw).digest("hex").toLowerCase()
    : "";
  if (actual !== expected) {
    return new Error(`Yeastar certificate pin mismatch for ${host}`);
  }
  // Yeastar ships a generic UCCPBX certificate, so hostname verification is intentionally
  // replaced by the explicit certificate pin above when connecting to the PBX IP.
  return undefined;
}

function requestText(url: URL, options: https.RequestOptions & { body?: string } = {}) {
  return new Promise<{ status: number; headers: https.IncomingHttpHeaders; body: Buffer }>(
    (resolve, reject) => {
      const { body, ...requestOptions } = options;
      const request = https.request(
        url,
        {
          ...requestOptions,
          method: requestOptions.method ?? (body ? "POST" : "GET"),
          rejectUnauthorized: true,
          checkServerIdentity: certificateCheck,
          headers: {
            ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}),
            ...(requestOptions.headers ?? {}),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          response.on("end", () =>
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      request.setTimeout(Number(process.env.YEASTAR_API_TIMEOUT_MS ?? 15000), () =>
        request.destroy(new Error("Yeastar API request timed out")),
      );
      request.on("error", reject);
      if (body) request.write(body);
      request.end();
    },
  );
}

function apiBase() {
  return requiredEnv("YEASTAR_API_BASE_URL").replace(/\/$/, "");
}

async function apiGet(endpoint: string, params: Record<string, string>) {
  const url = new URL(`${apiBase()}/openapi/v1.0/${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const result = await requestText(url);
  let payload: YeastarResponse;
  try {
    payload = JSON.parse(result.body.toString("utf8")) as YeastarResponse;
  } catch {
    throw new Error(`Yeastar returned non-JSON response (${result.status})`);
  }
  if (result.status < 200 || result.status >= 300 || payload.errcode !== 0) {
    throw new Error(`Yeastar ${endpoint} failed: ${payload.errmsg ?? `HTTP ${result.status}`}`);
  }
  return payload;
}

async function getAccessToken() {
  const url = new URL(`${apiBase()}/openapi/v1.0/get_token`);
  const result = await requestText(url, {
    method: "POST",
    body: JSON.stringify({
      username: requiredEnv("YEASTAR_CLIENT_ID"),
      password: requiredEnv("YEASTAR_CLIENT_SECRET"),
    }),
  });
  const payload = JSON.parse(result.body.toString("utf8")) as JsonRecord;
  const token = typeof payload.access_token === "string" ? payload.access_token : "";
  if (result.status < 200 || result.status >= 300 || !token) {
    throw new Error(`Yeastar token exchange failed: ${String(payload.errmsg ?? result.status)}`);
  }
  return token;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item): item is JsonRecord => Boolean(item && typeof item === "object")) : [];
}

function stringValue(record: JsonRecord, key: string) {
  const value = record[key];
  return value === null || value === undefined ? null : String(value);
}

function integerValue(record: JsonRecord, key: string) {
  const value = Number(record[key]);
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

function callTime(record: JsonRecord) {
  const timestamp = Number(record.timestamp);
  if (Number.isFinite(timestamp) && timestamp > 0) return new Date(timestamp * 1000).toISOString();
  const raw = stringValue(record, "time");
  if (!raw) return null;
  const parsed = new Date(raw.replace(/\//g, "-"));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function uid(record: JsonRecord) {
  return stringValue(record, "uid") ?? `yeastar-${String(record.id ?? crypto.randomUUID())}`;
}

export async function runYeastarPoll(pool: pg.Pool) {
  if (pollInProgress) return { skipped: true, reason: "poll already in progress" };
  pollInProgress = true;
  const startedAt = new Date();
  let logId: string | undefined;
  try {
    const state = await pool.query(
      "SELECT backfill_minutes FROM yeastar_sync_state WHERE id = true",
    );
    const backfillMinutes = Number(state.rows[0]?.backfill_minutes ?? process.env.YEASTAR_BACKFILL_MINUTES ?? 120);
    const token = await getAccessToken();
    const query = { access_token: token, page: "1", page_size: "10000", order_by: "desc", sort_by: "time" };
    const [cdrPayload, recordingPayload] = await Promise.all([
      apiGet("cdr/list", query),
      apiGet("recording/list", query),
    ]);
    const cdrs = records(cdrPayload.data);
    const recordings = records(recordingPayload.data);
    const cutoff = Date.now() - backfillMinutes * 60_000;
    const recordingByUid = new Map(recordings.map((record) => [uid(record), record]));
    const merged = new Map<string, { cdr?: JsonRecord; recording?: JsonRecord }>();
    for (const cdr of cdrs) {
      const time = callTime(cdr);
      if (!time || new Date(time).getTime() >= cutoff) merged.set(uid(cdr), { cdr });
    }
    for (const recording of recordings) {
      const time = callTime(recording);
      if (!time || new Date(time).getTime() >= cutoff) {
        const key = uid(recording);
        merged.set(key, { ...(merged.get(key) ?? {}), recording });
      }
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const log = await client.query(
        `INSERT INTO integration_sync_log (integration, operation, direction, status, request)
         VALUES ('yeastar', 'call_poll', 'inbound', 'running', $1::jsonb) RETURNING id`,
        [JSON.stringify({ backfillMinutes, cdrCount: cdrs.length, recordingCount: recordings.length })],
      );
      logId = log.rows[0].id;
      let upserted = 0;
      for (const [providerUid, item] of merged) {
        const cdr = item.cdr ?? {};
        const recording = item.recording ?? recordingByUid.get(providerUid) ?? {};
        await client.query(
          `INSERT INTO yeastar_calls (
             provider_uid, provider_cdr_id, provider_recording_id, call_time, call_type,
             call_from, call_from_name, call_from_number, call_to, call_to_name, call_to_number,
             disposition, duration_seconds, recording_file, recording_size_bytes, raw_cdr, raw_recording,
             last_seen_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,now(),now())
           ON CONFLICT (provider_uid) DO UPDATE SET
             provider_cdr_id = COALESCE(EXCLUDED.provider_cdr_id, yeastar_calls.provider_cdr_id),
             provider_recording_id = COALESCE(EXCLUDED.provider_recording_id, yeastar_calls.provider_recording_id),
             call_time = COALESCE(EXCLUDED.call_time, yeastar_calls.call_time),
             call_type = COALESCE(EXCLUDED.call_type, yeastar_calls.call_type),
             call_from = COALESCE(EXCLUDED.call_from, yeastar_calls.call_from),
             call_from_name = COALESCE(EXCLUDED.call_from_name, yeastar_calls.call_from_name),
             call_from_number = COALESCE(EXCLUDED.call_from_number, yeastar_calls.call_from_number),
             call_to = COALESCE(EXCLUDED.call_to, yeastar_calls.call_to),
             call_to_name = COALESCE(EXCLUDED.call_to_name, yeastar_calls.call_to_name),
             call_to_number = COALESCE(EXCLUDED.call_to_number, yeastar_calls.call_to_number),
             disposition = COALESCE(EXCLUDED.disposition, yeastar_calls.disposition),
             duration_seconds = COALESCE(EXCLUDED.duration_seconds, yeastar_calls.duration_seconds),
             recording_file = COALESCE(EXCLUDED.recording_file, yeastar_calls.recording_file),
             recording_size_bytes = COALESCE(EXCLUDED.recording_size_bytes, yeastar_calls.recording_size_bytes),
             raw_cdr = CASE WHEN EXCLUDED.raw_cdr <> '{}'::jsonb THEN EXCLUDED.raw_cdr ELSE yeastar_calls.raw_cdr END,
             raw_recording = CASE WHEN EXCLUDED.raw_recording <> '{}'::jsonb THEN EXCLUDED.raw_recording ELSE yeastar_calls.raw_recording END,
             last_seen_at = now(), updated_at = now()`,
          [
            providerUid, stringValue(cdr, "id"), stringValue(recording, "id"), callTime(cdr) ?? callTime(recording),
            stringValue(cdr, "call_type") ?? stringValue(recording, "call_type"),
            stringValue(cdr, "call_from") ?? stringValue(recording, "call_from"),
            stringValue(cdr, "call_from_name") ?? stringValue(recording, "call_from_name"),
            stringValue(cdr, "call_from_number") ?? stringValue(recording, "call_from_number"),
            stringValue(cdr, "call_to") ?? stringValue(recording, "call_to"),
            stringValue(cdr, "call_to_name") ?? stringValue(recording, "call_to_name"),
            stringValue(cdr, "call_to_number") ?? stringValue(recording, "call_to_number"),
            stringValue(cdr, "disposition") ?? stringValue(cdr, "last_status"),
            integerValue(cdr, "call_duration") ?? integerValue(recording, "duration"),
            stringValue(recording, "file"), integerValue(recording, "size"), JSON.stringify(cdr), JSON.stringify(recording),
          ],
        );
        upserted += 1;
      }
      const result = { cdrCount: cdrs.length, recordingCount: recordings.length, upserted, backfillMinutes };
      await client.query(
        `INSERT INTO yeastar_sync_state (id, last_successful_poll_at, last_result, updated_at)
         VALUES (true, now(), $1::jsonb, now())
         ON CONFLICT (id) DO UPDATE SET last_successful_poll_at = now(), last_result = EXCLUDED.last_result, updated_at = now()`,
        [JSON.stringify(result)],
      );
      await client.query(
        `UPDATE integration_sync_log SET status = 'completed', response = $1::jsonb, completed_at = now() WHERE id = $2`,
        [JSON.stringify(result), logId],
      );
      await client.query("COMMIT");
      return { ok: true, ...result, startedAt: startedAt.toISOString() };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (logId) {
        await pool.query(
          "UPDATE integration_sync_log SET status = 'failed', error = $1, completed_at = now() WHERE id = $2",
          [error instanceof Error ? error.message : "Yeastar poll failed", logId],
        );
      }
      throw error;
    } finally {
      client.release();
    }
  } finally {
    pollInProgress = false;
  }
}

export function startYeastarPoller(pool: pg.Pool) {
  if (pollTimer || process.env.NODE_ENV !== "production") return;
  if (!process.env.YEASTAR_CLIENT_ID || !process.env.YEASTAR_CLIENT_SECRET) return;
  const minutes = Math.min(30, Math.max(15, Number(process.env.YEASTAR_POLL_INTERVAL_MINUTES ?? 20)));
  const intervalMs = minutes * 60_000;
  pollTimer = setInterval(() => void runYeastarPoll(pool).catch((error) => console.error("Yeastar poll failed", error)), intervalMs);
  pollTimer.unref?.();
  void runYeastarPoll(pool).catch((error) => console.error("Yeastar initial poll failed", error));
}
