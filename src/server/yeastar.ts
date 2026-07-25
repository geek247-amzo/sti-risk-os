import crypto from "node:crypto";
import https from "node:https";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
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
          ca: Buffer.from(requiredEnv("YEASTAR_TLS_CERT_PEM_B64"), "base64"),
          checkServerIdentity: certificateCheck,
          headers: {
            "User-Agent": "sti-risk-os/1.0",
            ...(body
              ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) }
              : {}),
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

async function geminiTranscribe(audio: Buffer, mimeType: string) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const model = process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: "Transcribe this business phone call accurately. Identify speakers when possible, preserve names, numbers, commitments and action items, and return only the transcript text.",
              },
              { inline_data: { mime_type: mimeType, data: audio.toString("base64") } },
            ],
          },
        ],
      }),
    },
  );
  const payload = (await response.json()) as JsonRecord;
  if (!response.ok) throw new Error(`Gemini transcription failed (${response.status})`);
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const first = candidates[0] as JsonRecord | undefined;
  const content = first?.content as JsonRecord | undefined;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  const transcript = parts
    .map((part) =>
      part && typeof part === "object" ? String((part as JsonRecord).text ?? "") : "",
    )
    .join("\n")
    .trim();
  if (!transcript) throw new Error("Gemini returned an empty transcript");
  return { transcript, model };
}

async function downloadRecording(token: string, recordingId: string, fileName: string) {
  const download = await apiGet("recording/download", { access_token: token, id: recordingId });
  const resource =
    typeof (download as JsonRecord).download_resource_url === "string"
      ? String((download as JsonRecord).download_resource_url)
      : "";
  if (!resource) throw new Error("Yeastar returned no recording download URL");
  const url = new URL(resource, `${apiBase()}/`);
  url.searchParams.set("access_token", token);
  const result = await requestText(url, { headers: { "User-Agent": "sti-risk-os/1.0" } });
  if (result.status < 200 || result.status >= 300 || result.body.length === 0) {
    throw new Error(`Yeastar recording download failed (${result.status})`);
  }
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const directory = process.env.YEASTAR_AUDIO_DIR || "/app/uploads/yeastar";
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, safeName);
  await writeFile(filePath, result.body, { flag: "wx" }).catch(async (error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  });
  return {
    filePath,
    bytes: result.body.length,
    mimeType: result.headers["content-type"]?.split(";")[0] || "audio/wav",
  };
}

async function transcribePendingCalls(pool: pg.Pool) {
  const maxBytes = Number(process.env.YEASTAR_TRANSCRIPTION_MAX_BYTES ?? 15 * 1024 * 1024);
  const rows = await pool.query(
    `SELECT id, provider_recording_id, recording_file, recording_size_bytes
     FROM yeastar_calls
     WHERE provider_recording_id IS NOT NULL
       AND recording_file IS NOT NULL
       AND transcript IS NULL
       AND transcription_status IN ('pending', 'failed')
       AND COALESCE(recording_size_bytes, 0) <= $1
     ORDER BY call_time ASC NULLS LAST
     LIMIT 10`,
    [maxBytes],
  );
  if (rows.rowCount === 0) return { attempted: 0, completed: 0 };
  const token = await getAccessToken();
  let completed = 0;
  for (const row of rows.rows) {
    await pool.query(
      "UPDATE yeastar_calls SET transcription_status = 'processing', transcription_error = NULL WHERE id = $1",
      [row.id],
    );
    try {
      const downloaded = await downloadRecording(
        token,
        row.provider_recording_id,
        row.recording_file,
      );
      const result = await geminiTranscribe(
        await import("node:fs/promises").then((fs) => fs.readFile(downloaded.filePath)),
        downloaded.mimeType,
      );
      await pool.query(
        `UPDATE yeastar_calls SET audio_path = $1, audio_mime_type = $2, audio_size_bytes = $3,
         transcript = $4, transcript_model = $5, transcribed_at = now(), transcription_status = 'completed', updated_at = now()
         WHERE id = $6`,
        [
          downloaded.filePath,
          downloaded.mimeType,
          downloaded.bytes,
          result.transcript,
          result.model,
          row.id,
        ],
      );
      completed += 1;
    } catch (error) {
      await pool.query(
        "UPDATE yeastar_calls SET transcription_status = 'failed', transcription_error = $1, updated_at = now() WHERE id = $2",
        [error instanceof Error ? error.message : "Transcription failed", row.id],
      );
    }
  }
  return { attempted: rows.rowCount, completed };
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonRecord => Boolean(item && typeof item === "object"))
    : [];
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
    const backfillMinutes = Number(
      state.rows[0]?.backfill_minutes ?? process.env.YEASTAR_BACKFILL_MINUTES ?? 120,
    );
    const token = await getAccessToken();
    const query = {
      access_token: token,
      page: "1",
      page_size: "10000",
      order_by: "desc",
      sort_by: "time",
    };
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
        [
          JSON.stringify({
            backfillMinutes,
            cdrCount: cdrs.length,
            recordingCount: recordings.length,
          }),
        ],
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
            providerUid,
            stringValue(cdr, "id"),
            stringValue(recording, "id"),
            callTime(cdr) ?? callTime(recording),
            stringValue(cdr, "call_type") ?? stringValue(recording, "call_type"),
            stringValue(cdr, "call_from") ?? stringValue(recording, "call_from"),
            stringValue(cdr, "call_from_name") ?? stringValue(recording, "call_from_name"),
            stringValue(cdr, "call_from_number") ?? stringValue(recording, "call_from_number"),
            stringValue(cdr, "call_to") ?? stringValue(recording, "call_to"),
            stringValue(cdr, "call_to_name") ?? stringValue(recording, "call_to_name"),
            stringValue(cdr, "call_to_number") ?? stringValue(recording, "call_to_number"),
            stringValue(cdr, "disposition") ?? stringValue(cdr, "last_status"),
            integerValue(cdr, "call_duration") ?? integerValue(recording, "duration"),
            stringValue(recording, "file"),
            integerValue(recording, "size"),
            JSON.stringify(cdr),
            JSON.stringify(recording),
          ],
        );
        upserted += 1;
      }
      const result = {
        cdrCount: cdrs.length,
        recordingCount: recordings.length,
        upserted,
        backfillMinutes,
      };
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
      const transcription = await transcribePendingCalls(pool);
      return { ok: true, ...result, transcription, startedAt: startedAt.toISOString() };
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
  const minutes = Math.min(
    30,
    Math.max(15, Number(process.env.YEASTAR_POLL_INTERVAL_MINUTES ?? 20)),
  );
  const intervalMs = minutes * 60_000;
  pollTimer = setInterval(
    () => void runYeastarPoll(pool).catch((error) => console.error("Yeastar poll failed", error)),
    intervalMs,
  );
  pollTimer.unref?.();
  void runYeastarPoll(pool).catch((error) => console.error("Yeastar initial poll failed", error));
}
