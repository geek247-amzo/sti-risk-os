import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, FileText, Link2, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/staff/docs")({
  component: Docs,
});

type MicrosoftDoc = {
  id: string;
  name?: string;
  webUrl?: string;
  size?: number;
  lastModifiedDateTime?: string;
  file?: { mimeType?: string };
  remoteItem?: MicrosoftDoc;
};

type ChatSession = {
  id: string;
  title: string;
  status: string;
};

function formatTime(value: string | null | undefined) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function apiError(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return fallback;
}

function Docs() {
  const [connected, setConnected] = useState(false);
  const [docs, setDocs] = useState<MicrosoftDoc[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [linkingId, setLinkingId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setNotice("");
    setError("");
    try {
      const [statusResponse, sessionsResponse] = await Promise.all([
        fetch("/api/microsoft/status"),
        fetch("/api/staff/chat/sessions"),
      ]);
      const statusBody = await statusResponse.json();
      const sessionsBody = await sessionsResponse.json();
      if (!sessionsResponse.ok) throw new Error(apiError(sessionsBody, "Unable to load chats"));

      const loadedSessions = (sessionsBody.sessions ?? []) as ChatSession[];
      setSessions(loadedSessions);
      setSelectedSessionId((current) => current || loadedSessions[0]?.id || "");

      const isConnected = statusResponse.ok && Boolean(statusBody.connected);
      setConnected(isConnected);
      if (!isConnected) {
        setDocs([]);
        return;
      }

      const docsResponse = await fetch("/api/microsoft/docs");
      const docsBody = await docsResponse.json();
      if (!docsResponse.ok) throw new Error(apiError(docsBody, "Unable to load OneDrive docs"));
      setDocs(docsBody.docs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load OneDrive docs");
    } finally {
      setLoading(false);
    }
  }

  async function createChatSession() {
    const response = await fetch("/api/staff/chat/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "OneDrive document review" }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(apiError(body, "Unable to create Steve chat"));
    const session = body.session as ChatSession;
    setSessions((current) => [session, ...current]);
    setSelectedSessionId(session.id);
    return session.id;
  }

  async function linkDocToChat(doc: MicrosoftDoc) {
    const driveItem = doc.remoteItem ?? doc;
    setLinkingId(driveItem.id);
    setNotice("");
    setError("");
    try {
      const sessionId = selectedSessionId || (await createChatSession());
      const response = await fetch(`/api/staff/chat/sessions/${sessionId}/onedrive-links`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ driveItem }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(apiError(body, "Unable to link OneDrive file"));
      setNotice(`Linked "${driveItem.name || "OneDrive file"}" to the selected Steve chat.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to link OneDrive file");
    } finally {
      setLinkingId("");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <section className="staff-panel rounded-md border border-border bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-blue">
              Microsoft 365
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-foreground">Docs</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Browse recent OneDrive files for the signed-in account and link them into Steve chat
              context.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs ${
                connected ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-400/15 text-amber-700"
              }`}
            >
              Microsoft {connected ? "connected" : "not connected"}
            </span>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-2"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium text-foreground" htmlFor="chat-session">
            Link files to Steve chat
          </label>
          <select
            id="chat-session"
            value={selectedSessionId}
            onChange={(event) => setSelectedSessionId(event.target.value)}
            className="h-10 min-w-64 rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-blue"
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title}
              </option>
            ))}
            {!sessions.length && <option value="">Create a new Steve chat on link</option>}
          </select>
        </div>

        {!connected && !loading && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Microsoft Graph is not connected for this session. Sign out and sign in again with
            Microsoft to grant OneDrive access.
          </div>
        )}

        {notice && (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {notice}
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </section>

      <section className="staff-panel min-h-0 flex-1 rounded-md border border-border bg-white">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">Recent OneDrive documents</h2>
          <p className="text-xs text-muted-foreground">
            Files available to the signed-in Microsoft 365 user.
          </p>
        </div>
        <div className="max-h-[calc(100vh-18rem)] overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading OneDrive documents
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {docs.map((doc) => {
                const item = doc.remoteItem ?? doc;
                return (
                  <article
                    key={`${doc.id}-${item.id}`}
                    className="rounded-lg border border-border bg-white p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded bg-brand-blue/10 text-brand-blue">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="line-clamp-2 text-sm font-semibold">
                          {item.name || "Untitled file"}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatSize(Number(item.size ?? 0))} ·{" "}
                          {formatTime(item.lastModifiedDateTime)}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void linkDocToChat(item)}
                            disabled={!connected || linkingId === item.id}
                            className="inline-flex items-center gap-1 rounded-md bg-brand-blue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                          >
                            {linkingId === item.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Link2 className="h-3 w-3" />
                            )}
                            Link to chat
                          </button>
                          {item.webUrl && (
                            <a
                              href={item.webUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-brand-blue"
                            >
                              Open <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
              {!docs.length && (
                <div className="text-sm text-muted-foreground">No documents loaded.</div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
