import { createFileRoute } from "@tanstack/react-router";
import {
  Archive,
  ExternalLink,
  Inbox,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

export const Route = createFileRoute("/staff/email")({
  component: Email,
});

type MicrosoftEmail = {
  id: string;
  subject?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: { emailAddress?: { name?: string; address?: string } }[];
  receivedDateTime?: string;
  sentDateTime?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  isRead?: boolean;
  webLink?: string;
  importance?: string;
  hasAttachments?: boolean;
};

type AiDraft = {
  id: string;
  to_recipients: string[];
  subject: string;
  body_html: string;
  body_text?: string | null;
  status: "ai_draft" | "needs_edits" | "outlook_created" | "archived";
  source_email_id?: string | null;
  outlook_message_id?: string | null;
  prompt?: string | null;
  edit_instructions?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  approved_at?: string | null;
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

function apiError(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return fallback;
}

function emailAddress(value: MicrosoftEmail["from"]) {
  return value?.emailAddress?.name || value?.emailAddress?.address || "Unknown sender";
}

function iframeDoc(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#111827;margin:0;padding:20px;background:#fff}
    img{max-width:100%;height:auto} table{max-width:100%;border-collapse:collapse}
    a{color:#2563eb} blockquote{border-left:3px solid #d1d5db;margin-left:0;padding-left:12px;color:#4b5563}
  </style></head><body>${html}</body></html>`;
}

function Email() {
  const [activeTab, setActiveTab] = useState<"inbox" | "drafts" | "create">("inbox");
  const [connected, setConnected] = useState(false);
  const [emails, setEmails] = useState<MicrosoftEmail[]>([]);
  const [selectedEmailId, setSelectedEmailId] = useState("");
  const [selectedEmail, setSelectedEmail] = useState<MicrosoftEmail | null>(null);
  const [drafts, setDrafts] = useState<AiDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const selectedDraft = useMemo(
    () => drafts.find((draft) => draft.id === selectedDraftId) ?? drafts[0] ?? null,
    [drafts, selectedDraftId],
  );

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [statusResponse, draftsResponse] = await Promise.all([
        fetch("/api/microsoft/status"),
        fetch("/api/microsoft/ai-email-drafts"),
      ]);
      const statusBody = await statusResponse.json();
      const draftsBody = await draftsResponse.json();
      if (!draftsResponse.ok) throw new Error(apiError(draftsBody, "Unable to load AI drafts"));
      setDrafts(draftsBody.drafts ?? []);
      setSelectedDraftId((current) => current || draftsBody.drafts?.[0]?.id || "");

      const isConnected = statusResponse.ok && Boolean(statusBody.connected);
      setConnected(isConnected);
      if (!isConnected) {
        setEmails([]);
        return;
      }
      await loadInbox();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load email workspace");
    } finally {
      setLoading(false);
    }
  }

  async function loadInbox() {
    const response = await fetch("/api/microsoft/emails?top=25");
    const body = await response.json();
    if (!response.ok) throw new Error(apiError(body, "Unable to load Microsoft inbox"));
    const loaded = (body.emails ?? []) as MicrosoftEmail[];
    setEmails(loaded);
    if (!selectedEmailId && loaded[0]?.id) {
      setSelectedEmailId(loaded[0].id);
      await loadEmailDetail(loaded[0].id);
    }
  }

  async function loadEmailDetail(id: string) {
    setSelectedEmailId(id);
    setLoadingDetail(true);
    setError("");
    try {
      const response = await fetch(`/api/microsoft/emails/${encodeURIComponent(id)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(apiError(body, "Unable to load email"));
      setSelectedEmail(body.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load email");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function createAiDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setWorking(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/microsoft/ai-email-drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to: String(form.get("to") ?? ""),
          subject: String(form.get("subject") ?? ""),
          tone: String(form.get("tone") ?? ""),
          prompt: String(form.get("prompt") ?? ""),
          sourceEmailId: form.get("useSelectedEmail") === "on" ? selectedEmailId : "",
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(apiError(body, "Unable to create AI draft"));
      const draft = body.draft as AiDraft;
      setDrafts((current) => [draft, ...current.filter((item) => item.id !== draft.id)]);
      setSelectedDraftId(draft.id);
      setActiveTab("drafts");
      setNotice("Steve created an AI draft for review.");
      formElement.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create AI draft");
    } finally {
      setWorking(false);
    }
  }

  async function suggestEdits(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDraft) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setWorking(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch(`/api/microsoft/ai-email-drafts/${selectedDraft.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instructions: String(form.get("instructions") ?? "") }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(apiError(body, "Unable to edit AI draft"));
      const draft = body.draft as AiDraft;
      setDrafts((current) => current.map((item) => (item.id === draft.id ? draft : item)));
      setNotice("Steve updated the draft.");
      formElement.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to edit AI draft");
    } finally {
      setWorking(false);
    }
  }

  async function approveDraft() {
    if (!selectedDraft) return;
    setWorking(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch(`/api/microsoft/ai-email-drafts/${selectedDraft.id}/approve`, {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(apiError(body, "Unable to create Outlook draft"));
      const draft = body.draft as AiDraft;
      setDrafts((current) => current.map((item) => (item.id === draft.id ? draft : item)));
      setNotice("Approved. Outlook draft created for final sending from Microsoft 365.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create Outlook draft");
    } finally {
      setWorking(false);
    }
  }

  async function archiveDraft() {
    if (!selectedDraft) return;
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/microsoft/ai-email-drafts/${selectedDraft.id}`, {
        method: "DELETE",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(apiError(body, "Unable to archive draft"));
      const remaining = drafts.filter((draft) => draft.id !== selectedDraft.id);
      setDrafts(remaining);
      setSelectedDraftId(remaining[0]?.id || "");
      setNotice("Draft archived.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to archive draft");
    } finally {
      setWorking(false);
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
            <h1 className="mt-1 text-2xl font-semibold text-foreground">Email</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Inbox, Steve-generated drafts, review, edit, and approve into Outlook drafts.
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
              onClick={() => void loadAll()}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-2"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {[
            ["inbox", "Inbox", Inbox],
            ["drafts", "AI Drafts", Mail],
            ["create", "Create with Steve", Sparkles],
          ].map(([key, label, Icon]) => (
            <button
              key={String(key)}
              type="button"
              onClick={() => setActiveTab(key as "inbox" | "drafts" | "create")}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                activeTab === key
                  ? "bg-brand-blue text-white"
                  : "bg-surface-2 text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {!connected && !loading && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Microsoft Graph is not connected for this session. Sign out and sign in again with
            Microsoft to grant Outlook access.
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

      {activeTab === "inbox" && (
        <section className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[24rem_1fr]">
          <div className="staff-panel min-h-0 rounded-md border border-border bg-white">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-base font-semibold">Inbox</h2>
              <p className="text-xs text-muted-foreground">Latest Outlook messages.</p>
            </div>
            <div className="max-h-[calc(100vh-18rem)] overflow-y-auto p-2">
              {loading ? (
                <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading inbox
                </div>
              ) : (
                emails.map((email) => (
                  <button
                    key={email.id}
                    type="button"
                    onClick={() => void loadEmailDetail(email.id)}
                    className={`mb-1 w-full rounded-md p-3 text-left hover:bg-surface-2 ${
                      selectedEmailId === email.id ? "bg-brand-blue/10" : ""
                    }`}
                  >
                    <div className="line-clamp-1 text-sm font-semibold">
                      {email.subject || "(No subject)"}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {emailAddress(email.from)} · {formatTime(email.receivedDateTime)}
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {email.bodyPreview}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>

          <EmailReader email={selectedEmail} loading={loadingDetail} />
        </section>
      )}

      {activeTab === "drafts" && (
        <section className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[24rem_1fr]">
          <div className="staff-panel min-h-0 rounded-md border border-border bg-white">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-base font-semibold">AI Drafts</h2>
              <p className="text-xs text-muted-foreground">Review before creating Outlook draft.</p>
            </div>
            <div className="max-h-[calc(100vh-18rem)] overflow-y-auto p-2">
              {drafts.map((draft) => (
                <button
                  key={draft.id}
                  type="button"
                  onClick={() => setSelectedDraftId(draft.id)}
                  className={`mb-1 w-full rounded-md p-3 text-left hover:bg-surface-2 ${
                    selectedDraft?.id === draft.id ? "bg-brand-blue/10" : ""
                  }`}
                >
                  <div className="line-clamp-1 text-sm font-semibold">{draft.subject}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {draft.to_recipients.join(", ") || "No recipient"} ·{" "}
                    {formatTime(draft.updated_at)}
                  </div>
                  <span className="mt-2 inline-flex rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted-foreground">
                    {draft.status.replaceAll("_", " ")}
                  </span>
                </button>
              ))}
              {!drafts.length && (
                <div className="p-3 text-sm text-muted-foreground">
                  No AI drafts yet. Use Create with Steve.
                </div>
              )}
            </div>
          </div>

          <DraftReader
            draft={selectedDraft}
            working={working}
            onApprove={() => void approveDraft()}
            onArchive={() => void archiveDraft()}
            onSuggestEdits={(event) => void suggestEdits(event)}
          />
        </section>
      )}

      {activeTab === "create" && (
        <section className="staff-panel rounded-md border border-border bg-white p-5">
          <form onSubmit={createAiDraft} className="max-w-3xl">
            <div className="flex items-center gap-2 text-base font-semibold">
              <Sparkles className="h-5 w-5 text-brand-blue" />
              Create email with Steve
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Give Steve the intent, tone, recipient, and context. The result is saved to AI Drafts
              for review and edits before Outlook draft creation.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <input
                name="to"
                placeholder="Recipient email"
                className="h-10 rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-blue"
              />
              <input
                name="subject"
                placeholder="Suggested subject"
                className="h-10 rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-blue"
              />
              <select
                name="tone"
                className="h-10 rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-blue"
                defaultValue="professional"
              >
                <option value="professional">Professional</option>
                <option value="warm">Warm</option>
                <option value="direct">Direct</option>
                <option value="technical">Technical</option>
                <option value="executive">Executive</option>
              </select>
              <label className="flex h-10 items-center gap-2 rounded-md border border-border px-3 text-sm text-muted-foreground">
                <input name="useSelectedEmail" type="checkbox" disabled={!selectedEmailId} />
                Use selected inbox email as context
              </label>
              <textarea
                name="prompt"
                required
                rows={9}
                placeholder="Tell Steve what the email needs to say, what outcome you want, key details to include, and any constraints."
                className="sm:col-span-2 rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
              />
            </div>
            <button
              disabled={working}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-brand-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {working ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Generate AI draft
            </button>
          </form>
        </section>
      )}
    </div>
  );
}

function EmailReader({ email, loading }: { email: MicrosoftEmail | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="staff-panel grid min-h-96 place-items-center rounded-md border border-border bg-white text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading email
        </div>
      </div>
    );
  }
  if (!email) {
    return (
      <div className="staff-panel grid min-h-96 place-items-center rounded-md border border-border bg-white text-sm text-muted-foreground">
        Select an inbox email to read it.
      </div>
    );
  }
  const html = email.body?.contentType?.toLowerCase() === "html" ? email.body.content || "" : "";
  return (
    <article className="staff-panel min-h-0 rounded-md border border-border bg-white">
      <header className="border-b border-border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{email.subject || "(No subject)"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              From {emailAddress(email.from)} · {formatTime(email.receivedDateTime)}
            </p>
            {!!email.toRecipients?.length && (
              <p className="mt-1 text-xs text-muted-foreground">
                To{" "}
                {email.toRecipients
                  .map((item) => item.emailAddress?.name || item.emailAddress?.address)
                  .filter(Boolean)
                  .join(", ")}
              </p>
            )}
          </div>
          {email.webLink && (
            <a
              href={email.webLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs text-brand-blue"
            >
              Open in Outlook <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </header>
      <div className="h-[calc(100vh-22rem)] min-h-96">
        {html ? (
          <iframe
            title="Email body"
            sandbox=""
            srcDoc={iframeDoc(html)}
            className="h-full w-full"
          />
        ) : (
          <div className="whitespace-pre-wrap p-5 text-sm leading-6">{email.body?.content}</div>
        )}
      </div>
    </article>
  );
}

function DraftReader({
  draft,
  working,
  onApprove,
  onArchive,
  onSuggestEdits,
}: {
  draft: AiDraft | null;
  working: boolean;
  onApprove: () => void;
  onArchive: () => void;
  onSuggestEdits: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!draft) {
    return (
      <div className="staff-panel grid min-h-96 place-items-center rounded-md border border-border bg-white text-sm text-muted-foreground">
        Select or create an AI draft.
      </div>
    );
  }
  return (
    <article className="staff-panel min-h-0 rounded-md border border-border bg-white">
      <header className="border-b border-border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-blue">
              {draft.status.replaceAll("_", " ")}
            </div>
            <h2 className="mt-1 text-xl font-semibold">{draft.subject}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              To {draft.to_recipients.join(", ") || "No recipient"} · Updated{" "}
              {formatTime(draft.updated_at)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onApprove}
              disabled={
                working || draft.status === "outlook_created" || !draft.to_recipients.length
              }
              className="inline-flex items-center gap-2 rounded-md bg-brand-blue px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {working ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Approve to Outlook
            </button>
            <button
              type="button"
              onClick={onArchive}
              disabled={working}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-surface-2 disabled:opacity-60"
            >
              <Archive className="h-4 w-4" />
              Archive
            </button>
          </div>
        </div>
      </header>
      <div className="grid min-h-0 xl:grid-cols-[1fr_22rem]">
        <div className="h-[calc(100vh-25rem)] min-h-96 border-b border-border xl:border-r xl:border-b-0">
          <iframe
            title="AI draft body"
            sandbox=""
            srcDoc={iframeDoc(draft.body_html)}
            className="h-full w-full"
          />
        </div>
        <form onSubmit={onSuggestEdits} className="p-5">
          <div className="text-sm font-semibold">Suggest edits to Steve</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Steve will rewrite the draft and keep it in this review queue.
          </p>
          <textarea
            name="instructions"
            required
            rows={8}
            placeholder="Example: make it warmer, add the attached quote context, shorten the opening, and ask for a meeting next Tuesday."
            className="mt-3 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
          />
          <button
            disabled={working}
            className="mt-3 inline-flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm font-semibold text-foreground disabled:opacity-60"
          >
            {working ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Ask Steve to edit
          </button>
        </form>
      </div>
    </article>
  );
}
