import { createFileRoute } from "@tanstack/react-router";
import {
  Archive,
  Bot,
  Building2,
  CheckCheck,
  FileSignature,
  FileText,
  FileUp,
  FolderKanban,
  Loader2,
  MapPinned,
  Paperclip,
  Plus,
  ReceiptText,
  Send,
  Slash,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

export const Route = createFileRoute("/staff/chat")({
  component: Chat,
});

type ChatSession = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  last_message?: string | null;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type ChatAttachment = {
  id: string;
  message_id?: string | null;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  created_at: string;
};

type ChatEntity = {
  type: "customer" | "client" | "project" | "site" | "invoice" | "quote";
  id: string;
  label: string;
  subtitle: string;
  href: string;
};

const activeChatStorageKey = "sti-risk-active-chat-session";

function entityIcon(type: ChatEntity["type"]) {
  if (type === "customer" || type === "client") return Building2;
  if (type === "project") return FolderKanban;
  if (type === "site") return MapPinned;
  if (type === "invoice") return ReceiptText;
  return FileSignature;
}

function formatTime(value: string | null | undefined) {
  if (!value) return "New";
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

function readableContent(content: string) {
  const trimmed = content.trim();
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) return content;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.reply === "string") return parsed.reply;
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    const partialReply = trimmed.match(/["']reply["']\s*:\s*["']([\s\S]*?)(?:["']\s*[,}]|$)/i);
    if (partialReply?.[1]) return partialReply[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
  return content;
}

function ActionReceipt({ metadata }: { metadata: Record<string, unknown> }) {
  const result = metadata.actionResult;
  if (!result || typeof result !== "object") return null;
  const values = result as Record<string, unknown>;
  const taskId = typeof values.taskId === "string" ? values.taskId : null;
  const recommendationId = typeof values.recommendationId === "string" ? values.recommendationId : null;
  const templateId = typeof values.templateId === "string" ? values.templateId : null;
  if (!taskId && !recommendationId && !templateId) return null;
  const href = taskId
    ? `/staff/work?task=${taskId}`
    : templateId
      ? `/staff/quotes/new?templateId=${templateId}`
      : "/staff/steve";
  return (
    <a href={href} className="mt-3 flex items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 hover:border-emerald-400">
      <span className="inline-flex items-center gap-2 font-medium"><CheckCheck className="h-4 w-4" />{taskId ? "Task created in Work" : templateId ? "Template saved for quotes" : "Recommendation queued for review"}</span>
      <span className="font-semibold">Open</span>
    </a>
  );
}

function InlineText({ children }: { children: string }) {
  const parts = children.split(/(https?:\/\/[^\s]+|\*\*[^*]+\*\*)/g).filter(Boolean);
  return <>{parts.map((part, index) => {
    if (part.startsWith("http")) return <a key={index} href={part} target="_blank" rel="noreferrer" className="font-medium underline decoration-current/30 underline-offset-4 hover:decoration-current">{part}</a>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong>;
    return <span key={index}>{part}</span>;
  })}</>;
}

function MessageText({ content }: { content: string }) {
  const lines = readableContent(content).split("\n");
  return (
    <div className="space-y-2.5 text-sm leading-6">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={index} className="h-2" />;
        if (/^#{1,4}\s+/.test(trimmed)) return <h3 key={index} className="pt-1 font-semibold text-current"><InlineText>{trimmed.replace(/^#{1,4}\s+/, "")}</InlineText></h3>;
        if (/^[-*]\s+/.test(trimmed)) {
          return (
            <div key={index} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-50" />
              <span><InlineText>{trimmed.replace(/^[-*]\s+/, "")}</InlineText></span>
            </div>
          );
        }
        const numbered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
        if (numbered) return <div key={index} className="flex gap-2.5"><span className="font-semibold opacity-55">{numbered[1]}.</span><span><InlineText>{numbered[2]}</InlineText></span></div>;
        return <p key={index}><InlineText>{trimmed}</InlineText></p>;
      })}
    </div>
  );
}

function EntityChips({ entities, mine = false }: { entities: ChatEntity[]; mine?: boolean }) {
  if (!entities.length) return null;
  return <div className="mt-3 flex flex-wrap gap-2">{entities.map((entity) => {
    const Icon = entityIcon(entity.type);
    return <a key={`${entity.type}-${entity.id}`} href={entity.href} className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${mine ? "border-white/25 bg-white/10 text-white hover:bg-white/20" : "border-slate-200 bg-white text-slate-700 hover:border-brand-blue hover:text-brand-blue"}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{entity.label}</span>
    </a>;
  })}</div>;
}

function Chat() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [message, setMessage] = useState("");
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mentionResults, setMentionResults] = useState<ChatEntity[]>([]);
  const [selectedEntities, setSelectedEntities] = useState<ChatEntity[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionType, setMentionType] = useState<ChatEntity["type"] | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string }>({
    ok: false,
    text: "Checking",
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  useEffect(() => {
    void loadInitial();
    void loadStatus();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  useEffect(() => {
    const match = message.match(/(?:^|\s)\/([^/\n]*)$/);
    if (!match) {
      setMentionOpen(false);
      setMentionType(null);
      return;
    }
    if (!mentionType) {
      setMentionOpen(true);
      setMentionResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/staff/chat/entities?type=${mentionType}&q=${encodeURIComponent(match[1].trim())}`);
        const body = await response.json();
        if (!response.ok) return;
        setMentionResults(body.entities ?? []);
        setMentionOpen(true);
      } catch {
        setMentionOpen(false);
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [message, mentionType]);

  async function loadInitial() {
    setLoadingSessions(true);
    setError("");
    try {
      const response = await fetch("/api/staff/chat/sessions");
      const body = await response.json();
      if (!response.ok) throw new Error(apiError(body, "Unable to load chats"));
      const loaded = (body.sessions ?? []) as ChatSession[];
      if (loaded.length) {
        setSessions(loaded);
        const storedId = window.localStorage.getItem(activeChatStorageKey);
        const active = loaded.find((session) => session.id === storedId) ?? loaded[0];
        window.localStorage.setItem(activeChatStorageKey, active.id);
        setActiveSessionId(active.id);
        await loadMessages(active.id);
      } else {
        await createSession();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load chats");
    } finally {
      setLoadingSessions(false);
    }
  }

  async function loadStatus() {
    try {
      const response = await fetch("/api/staff/chat/status");
      const body = await response.json();
      setStatus({
        ok: response.ok && body.ok,
        text: response.ok && body.ok ? "Online" : "Unavailable",
      });
    } catch {
      setStatus({ ok: false, text: "Unavailable" });
    }
  }

  async function createSession() {
    const response = await fetch("/api/staff/chat/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "New chat" }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(apiError(body, "Unable to create chat"));
    const session = body.session as ChatSession;
    setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
    setActiveSessionId(session.id);
    window.localStorage.setItem(activeChatStorageKey, session.id);
    setMessages([]);
    setAttachments([]);
    setPendingAttachments([]);
    return session;
  }

  async function loadMessages(sessionId: string) {
    setLoadingMessages(true);
    setError("");
    try {
      const response = await fetch(`/api/staff/chat/sessions/${sessionId}/messages`);
      const body = await response.json();
      if (!response.ok) throw new Error(apiError(body, "Unable to load messages"));
      setMessages(body.messages ?? []);
      setAttachments(body.attachments ?? []);
      setPendingAttachments([]);
      setSelectedEntities([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load messages");
    } finally {
      setLoadingMessages(false);
    }
  }

  async function selectSession(sessionId: string) {
    setActiveSessionId(sessionId);
    window.localStorage.setItem(activeChatStorageKey, sessionId);
    await loadMessages(sessionId);
  }

  async function removeSession(sessionId: string, mode: "archive" | "delete") {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    if (
      mode === "delete" &&
      !window.confirm(`Delete "${session.title}"? This removes it from your chat list.`)
    ) {
      return;
    }

    setError("");
    try {
      const response = await fetch(`/api/staff/chat/sessions/${sessionId}`, {
        method: mode === "archive" ? "PATCH" : "DELETE",
        headers: mode === "archive" ? { "content-type": "application/json" } : undefined,
        body: mode === "archive" ? JSON.stringify({ status: "archived" }) : undefined,
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          apiError(body, mode === "archive" ? "Unable to archive chat" : "Unable to delete chat"),
        );
      }

      const remaining = sessions.filter((item) => item.id !== sessionId);
      setSessions(remaining);
      if (activeSessionId !== sessionId) return;

      const next = remaining[0];
      if (next) {
        setActiveSessionId(next.id);
        await loadMessages(next.id);
      } else {
        await createSession();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update chat");
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length || !activeSessionId) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.set("sessionId", activeSessionId);
      Array.from(files).forEach((file) => form.append("files", file));
      const response = await fetch("/api/staff/chat/uploads", {
        method: "POST",
        body: form,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(apiError(body, "Upload failed"));
      const uploaded = (body.attachments ?? []) as ChatAttachment[];
      setAttachments((current) => [...current, ...uploaded]);
      setPendingAttachments((current) => [...current, ...uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const content = message.trim();
    if (!content || !activeSessionId || sending) return;
    const localPending = pendingAttachments;
    const localEntities = selectedEntities;
    const optimisticId = `pending-${Date.now()}`;
    setSending(true);
    setError("");
    setMessage("");
    setPendingAttachments([]);
    setSelectedEntities([]);
    setMentionOpen(false);
    setMentionType(null);
    setMessages((current) => [...current, {
      id: optimisticId,
      role: "user",
      content,
      metadata: { entityReferences: localEntities, delivery: "sending" },
      created_at: new Date().toISOString(),
    }]);
    try {
      const response = await fetch(`/api/staff/chat/sessions/${activeSessionId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content,
          attachmentIds: localPending.map((attachment) => attachment.id),
          entityReferences: localEntities,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(apiError(body, "Steve did not respond"));
      setMessages((current) => [
        ...current.filter((item) => item.id !== optimisticId),
        body.userMessage,
        body.assistantMessage,
      ]);
      const updatedTitle = content.length > 52 ? `${content.slice(0, 52)}...` : content;
      setSessions((current) =>
        current.map((session) =>
          session.id === activeSessionId
            ? {
                ...session,
                title:
                  session.title === "New chat" || session.title === "New Hermes chat"
                    ? updatedTitle
                    : session.title,
                last_message: body.assistantMessage.content,
                last_message_at: body.assistantMessage.created_at,
              }
            : session,
        ),
      );
    } catch (err) {
      setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setMessage(content);
      setPendingAttachments(localPending);
      setSelectedEntities(localEntities);
      setError(err instanceof Error ? err.message : "Steve did not respond");
    } finally {
      setSending(false);
    }
  }

  function selectEntity(entity: ChatEntity) {
    setSelectedEntities((current) => current.some((item) => item.type === entity.type && item.id === entity.id) ? current : [...current, entity]);
    setMessage((current) => current.replace(/(?:^|\s)\/([^/\n]*)$/, (match) => `${match.startsWith(" ") ? " " : ""}${entity.label} `));
    setMentionOpen(false);
    setMentionType(null);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  const suggestions = [
    "Which deals and tasks need attention today?",
    "Summarise open growth risks and recommended next actions.",
    "Create a follow-up plan for the highest-value opportunities.",
    "What project or task blockers should Steve flag for review?",
  ];

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden xl:flex-row">
      <section className="staff-panel flex min-h-0 shrink-0 flex-col rounded-md border border-border bg-white xl:w-72">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Ask Steve</h2>
            <p className="text-xs text-muted-foreground">Platform intelligence</p>
          </div>
          <button
            onClick={() => void createSession()}
            className="grid h-9 w-9 place-items-center rounded-md bg-brand-blue text-white hover:opacity-90"
            title="New chat"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loadingSessions ? (
            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading chats
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                role="button"
                tabIndex={0}
                onClick={() => void selectSession(session.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void selectSession(session.id);
                  }
                }}
                className={`group mb-1 w-full rounded-md p-3 text-left transition-colors ${
                  activeSessionId === session.id
                    ? "bg-[#556ee6]/10 text-foreground"
                    : "hover:bg-surface-2"
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-1 text-sm font-semibold">{session.title}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {session.last_message || "No messages yet"}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void removeSession(session.id, "archive");
                      }}
                      className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-white hover:text-brand-blue"
                      title="Archive chat"
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void removeSession(session.id, "delete");
                      }}
                      className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-white hover:text-destructive"
                      title="Delete chat"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-2 text-[11px] text-muted-foreground">
                  {formatTime(session.last_message_at ?? session.updated_at)}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="staff-panel flex min-h-0 min-w-0 flex-1 flex-col rounded-md border border-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-[#556ee6]/12 text-brand-blue">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-foreground">
                {activeSession?.title ?? "Ask Steve"}
              </h1>
              <p className="text-xs text-muted-foreground">
                Ask Steve about deals, contacts, growth, projects, and tasks.
              </p>
            </div>
          </div>
          <div
            className={`rounded-full px-3 py-1 text-xs ${status.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-400/15 text-amber-700"}`}
          >
            {status.text}
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-4 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {loadingMessages ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading conversation
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="grid h-full place-items-center">
              <div className="max-w-xl text-center">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#556ee6]/10 text-brand-blue">
                  <Sparkles className="h-7 w-7" />
                </div>
                <h2 className="mt-4 text-xl font-semibold text-foreground">Steve is ready</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Start with a deal, contact, growth, project, task, or KPI request.
                </p>
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setMessage(suggestion)}
                      className="rounded-md border border-border bg-white p-3 text-left text-sm hover:border-brand-blue hover:text-brand-blue"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {messages.map((item) => {
                const mine = item.role === "user";
                const referencedEntities = Array.isArray(item.metadata?.entityReferences)
                  ? (item.metadata.entityReferences as ChatEntity[])
                  : [];
                const isPending = item.metadata?.delivery === "sending";
                const messageAttachments = attachments.filter(
                  (attachment) => attachment.message_id === item.id,
                );
                return (
                  <div
                    key={item.id}
                    className={`flex gap-3 ${mine ? "justify-end" : "justify-start"}`}
                  >
                    {!mine && (
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#556ee6]/12 text-brand-blue">
                        <Bot className="h-4 w-4" />
                      </div>
                    )}
                    <div
                      className={`max-w-[min(86%,46rem)] break-words rounded-md px-4 py-3.5 shadow-sm ${mine ? "rounded-br-sm bg-brand-blue text-white" : "rounded-bl-sm border border-slate-200/70 bg-slate-50 text-foreground"}`}
                    >
                      <MessageText content={item.content} />
                      <EntityChips entities={referencedEntities} mine={mine} />
                      {!mine && <ActionReceipt metadata={item.metadata} />}
                      {messageAttachments.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {messageAttachments.map((attachment) => (
                            <span
                              key={attachment.id}
                              className="inline-flex items-center gap-1 rounded bg-white/15 px-2 py-1 text-xs"
                            >
                              <Paperclip className="h-3 w-3" />
                              {attachment.original_name}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className={`mt-2 flex items-center gap-1 text-[11px] ${mine ? "justify-end text-white/75" : "text-muted-foreground"}`}>
                        {formatTime(item.created_at)}
                        {mine && (isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />)}
                      </div>
                    </div>
                    {mine && (
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600">
                        <UserRound className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                );
              })}
              {sending && (
                <div className="flex items-end gap-3 text-sm text-muted-foreground" aria-label="Steve is typing">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-[#556ee6]/12 text-brand-blue">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="rounded-md rounded-bl-sm border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm">
                    <div className="staff-typing-dots"><span /><span /><span /></div>
                    <span className="sr-only">Steve is typing</span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <form
          onSubmit={(event) => void sendMessage(event)}
          className="border-t border-border p-3 sm:p-4"
        >
          {pendingAttachments.length > 0 && (
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              {pendingAttachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex min-w-0 items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5"
                >
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${attachment.mime_type === "application/pdf" ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"}`}>
                    <FileText className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">{attachment.original_name}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{attachment.mime_type === "application/pdf" ? "PDF ready for Steve" : "File attached"} · {formatSize(attachment.size_bytes)}</span>
                  </span>
                  <button type="button" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700" aria-label={`Remove ${attachment.original_name}`} onClick={() => setPendingAttachments((current) => current.filter((item) => item.id !== attachment.id))}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {selectedEntities.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {selectedEntities.map((entity) => {
                const Icon = entityIcon(entity.type);
                return <span key={`${entity.type}-${entity.id}`} className="inline-flex items-center gap-1.5 rounded-md border border-brand-blue/20 bg-brand-blue/5 px-2.5 py-1.5 text-xs font-medium text-brand-blue">
                  <Icon className="h-3.5 w-3.5" />{entity.label}
                  <button type="button" className="ml-1 opacity-60 hover:opacity-100" aria-label={`Remove ${entity.label}`} onClick={() => setSelectedEntities((current) => current.filter((item) => item.id !== entity.id || item.type !== entity.type))}>×</button>
                </span>;
              })}
            </div>
          )}
          <div className="relative flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.txt,.md,.csv,.json,image/*"
              className="hidden"
              onChange={(event) => void uploadFiles(event.target.files)}
            />
            <button
              type="button"
              onClick={() => {
                setMessage((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}/`);
                setMentionType(null);
                window.setTimeout(() => textareaRef.current?.focus(), 0);
              }}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-border bg-white text-brand-blue hover:border-brand-blue hover:bg-brand-blue/5"
              title="Link platform context"
              aria-label="Open slash commands"
            >
              <Slash className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || !activeSessionId}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-md border border-border bg-white px-3 text-muted-foreground hover:border-brand-blue hover:bg-surface-2 hover:text-brand-blue disabled:opacity-50"
              title="Attach PDF or file"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <><FileUp className="h-4 w-4" /><span className="hidden text-xs font-medium lg:inline">Add file</span></>
              )}
            </button>
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Message Steve, or type / to link a customer, project, site, invoice or quote..."
              rows={2}
              className="min-h-11 min-w-0 flex-1 resize-none rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
            />
            {mentionOpen && (
              <div className="staff-panel absolute bottom-[calc(100%+0.5rem)] left-13 right-0 z-20 max-h-80 overflow-y-auto rounded-md border border-slate-200 bg-white p-2 shadow-xl sm:right-28">
                <div className="flex items-center gap-2 px-2 py-2 text-xs font-semibold uppercase text-slate-500"><Slash className="h-3.5 w-3.5" /> {mentionType ? `Choose ${mentionType}` : "Link platform context"}</div>
                {!mentionType ? (
                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-6">
                    {([
                      ["customer", "Customer", Building2],
                      ["project", "Project", FolderKanban],
                      ["site", "Site", MapPinned],
                      ["invoice", "Invoice", ReceiptText],
                      ["quote", "Quote", FileSignature],
                    ] as const).map(([type, label, Icon]) => (
                      <button key={type} type="button" className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-md border border-transparent p-2 text-xs font-medium text-slate-700 hover:border-slate-200 hover:bg-slate-50" onClick={() => setMentionType(type)}>
                        <Icon className="h-5 w-5 text-brand-blue" />{label}
                      </button>
                    ))}
                    <button type="button" className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-md border border-transparent p-2 text-xs font-medium text-slate-700 hover:border-slate-200 hover:bg-slate-50" onClick={() => {
                      setMentionOpen(false);
                      setMessage((current) => current.replace(/(?:^|\s)\/([^/\n]*)$/, ""));
                      fileInputRef.current?.click();
                    }}>
                      <FileUp className="h-5 w-5 text-brand-blue" />File / PDF
                    </button>
                  </div>
                ) : mentionResults.length ? mentionResults.map((entity) => {
                  const Icon = entityIcon(entity.type);
                  return <button key={`${entity.type}-${entity.id}`} type="button" className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-slate-50" onClick={() => selectEntity(entity)}>
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border bg-white text-brand-blue"><Icon className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-800">{entity.label}</span><span className="block truncate text-xs text-slate-500">{entity.subtitle}</span></span>
                    <span className="text-[10px] font-semibold uppercase text-slate-400">{entity.type}</span>
                  </button>;
                }) : <div className="px-3 py-5 text-center text-sm text-slate-500">No matching records</div>}
              </div>
            )}
            <button
              type="submit"
              disabled={sending || !message.trim() || !activeSessionId}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-md bg-brand-blue px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 sm:px-4"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 px-13 text-[11px] text-muted-foreground">
            <span><Slash className="mr-1 inline h-3 w-3" />Type / to link platform context</span>
            <span className="hidden sm:inline">Enter to send · Shift+Enter for a new line</span>
          </div>
        </form>
      </section>
    </div>
  );
}
