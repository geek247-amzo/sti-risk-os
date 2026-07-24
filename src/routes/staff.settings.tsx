import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Database,
  KanbanSquare,
  MessageCircleWarning,
  RefreshCw,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

export const Route = createFileRoute("/staff/settings")({
  component: Settings,
});

type SettingsData = {
  pipelineStages: {
    id: string;
    name: string;
    position: number;
    is_terminal: boolean;
    deals: number;
  }[];
  taskStages: {
    id: string;
    name: string;
    position: number;
    is_terminal: boolean;
    board_name: string;
    tasks: number;
  }[];
  imports: {
    id: string;
    source: string;
    leads_file: string | null;
    deals_file: string | null;
    leads_imported: number;
    deals_imported: number;
    organizations_imported: number;
    contacts_imported: number;
    created_at: string;
  }[];
  users: {
    id: string;
    name: string;
    email: string;
    role: string;
    auth_provider: string;
    created_at: string;
  }[];
};

type WhatsAppOperations = {
  messenger: {
    reachable?: boolean;
    connection?: string;
    deliveryStatus?: string;
    lastAckError?: string | null;
    restrictedSince?: string | null;
    restrictedRecipient?: string | null;
    nextRetryAt?: string | null;
    qrRequired?: boolean;
  };
  canSend: boolean;
  warning: string | null;
  nextRetryAt: string | null;
  counts: {
    pending?: number;
    claimed?: number;
    retryable_failed?: number;
    failed?: number;
  };
  outbox: {
    id: string;
    recipient: string;
    message_body: string;
    status: string;
    attempt_count: number;
    provider_message_id: string | null;
    error: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    next_attempt_at: string;
    sent_at: string | null;
  }[];
};

type LemlistHealth = {
  configured: boolean;
  apiReachable: boolean;
  webhookSecretConfigured: boolean;
  baseUrl: string;
  message?: string;
  error?: string;
};

type MicrosoftHealth = {
  configured: boolean;
  mode: string;
  tenantConfigured: boolean;
  tenantId: string | null;
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
  redirectUri: string | null;
  staffEmailDomain: string;
  discoveryReachable: boolean;
  message: string;
  error?: string;
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not scheduled";
  return new Date(value).toLocaleString();
}

function Settings() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [whatsApp, setWhatsApp] = useState<WhatsAppOperations | null>(null);
  const [lemlist, setLemlist] = useState<LemlistHealth | null>(null);
  const [microsoft, setMicrosoft] = useState<MicrosoftHealth | null>(null);
  const [error, setError] = useState("");
  const [whatsAppError, setWhatsAppError] = useState("");
  const [retryingId, setRetryingId] = useState("");

  const loadWhatsApp = () =>
    fetch("/api/settings/whatsapp-operations")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "WhatsApp operations failed to load");
        setWhatsApp(body);
        setWhatsAppError("");
      })
      .catch((err) =>
        setWhatsAppError(err instanceof Error ? err.message : "WhatsApp operations failed to load"),
      );

  useEffect(() => {
    fetch("/api/settings/summary")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Settings failed to load");
        setData(body);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Settings failed to load"));
    fetch("/api/integrations/lemlist/health")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "lemlist health failed to load");
        setLemlist(body);
      })
      .catch(() => undefined);
    fetch("/api/integrations/microsoft/health")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Microsoft SSO health failed to load");
        setMicrosoft(body);
      })
      .catch(() => undefined);
    void loadWhatsApp();
  }, []);

  const latestImport = data?.imports[0];
  const deliveryStatus = whatsApp?.messenger.deliveryStatus ?? "unknown";
  const restricted = deliveryStatus === "restricted";
  const retryEligible = (item: WhatsAppOperations["outbox"][number]) =>
    ["failed", "retryable_failed"].includes(item.status) &&
    new Date(item.next_attempt_at).getTime() <= Date.now() &&
    !restricted;

  async function retryOutbox(id: string) {
    setRetryingId(id);
    setWhatsAppError("");
    try {
      const response = await fetch(`/api/settings/whatsapp-outbox/${id}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: false }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Retry failed");
      await loadWhatsApp();
    } catch (err) {
      setWhatsAppError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetryingId("");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Workspace</div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Live workspace configuration, import state, staff users, and stage usage.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border/60 bg-surface p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Database className="h-4 w-4 text-brand-orange" /> Latest legacy import
          </div>
          <div className="mt-2 text-2xl font-bold">{latestImport?.deals_imported ?? 0}</div>
          <div className="text-sm text-muted-foreground">
            Deals · {latestImport?.leads_imported ?? 0} leads
          </div>
        </div>
        <div className="rounded-lg border border-border/60 bg-surface p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <KanbanSquare className="h-4 w-4 text-brand-orange" /> Pipeline stages
          </div>
          <div className="mt-2 text-2xl font-bold">{data?.pipelineStages.length ?? 0}</div>
          <div className="text-sm text-muted-foreground">Configured in Postgres</div>
        </div>
        <div className="rounded-lg border border-border/60 bg-surface p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <UsersRound className="h-4 w-4 text-brand-orange" /> Users
          </div>
          <div className="mt-2 text-2xl font-bold">{data?.users.length ?? 0}</div>
          <div className="text-sm text-muted-foreground">Auth and imported owners</div>
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-surface shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-brand-orange" />
              Microsoft SSO
            </div>
            <h2 className="mt-1 text-lg font-semibold">Single-tenant login health</h2>
            <p className="text-sm text-muted-foreground">
              Staff Microsoft login is restricted to the configured Entra tenant and the staff email
              domain.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              microsoft?.configured && microsoft?.discoveryReachable
                ? "bg-emerald-500/10 text-emerald-700"
                : "bg-amber-500/10 text-amber-700"
            }`}
          >
            {microsoft?.configured
              ? microsoft.discoveryReachable
                ? "Ready"
                : "Configured"
              : "Not configured"}
          </span>
        </div>
        <div className="grid gap-3 p-5 md:grid-cols-4">
          <div className="rounded-lg border border-border/60 bg-white p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Tenant Mode
            </div>
            <div className="mt-1 text-lg font-semibold">
              {microsoft?.mode === "single_tenant" ? "Single tenant" : "Unset"}
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-white p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Client Secret
            </div>
            <div className="mt-1 text-lg font-semibold">
              {microsoft?.clientSecretConfigured ? "Set" : "Missing"}
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-white p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Discovery</div>
            <div className="mt-1 text-lg font-semibold">
              {microsoft?.discoveryReachable ? "Reachable" : "Unavailable"}
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-white p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Allowed Domain
            </div>
            <div className="mt-1 text-lg font-semibold">
              {microsoft?.staffEmailDomain ?? "stirisk.co.za"}
            </div>
          </div>
        </div>
        <div className="space-y-1 border-t border-border/60 px-5 py-3 text-sm text-muted-foreground">
          <div>{microsoft?.message ?? "Microsoft SSO health has not loaded yet."}</div>
          <div className="break-all">
            Redirect URI:{" "}
            {microsoft?.redirectUri ??
              "https://stirisk.cloudmonkey.co.za/api/auth/microsoft/callback"}
          </div>
          {microsoft?.tenantId && <div className="break-all">Tenant ID: {microsoft.tenantId}</div>}
          {microsoft?.error && <div className="text-destructive">{microsoft.error}</div>}
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-surface shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              lemlist Integration
            </div>
            <h2 className="mt-1 text-lg font-semibold">Outbound execution health</h2>
            <p className="text-sm text-muted-foreground">
              CRM remains the source of truth; lemlist is used for campaign execution and webhooks.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              lemlist?.configured && lemlist?.apiReachable
                ? "bg-emerald-500/10 text-emerald-700"
                : "bg-amber-500/10 text-amber-700"
            }`}
          >
            {lemlist?.configured
              ? lemlist.apiReachable
                ? "Connected"
                : "Configured"
              : "Not configured"}
          </span>
        </div>
        <div className="grid gap-3 p-5 md:grid-cols-3">
          <div className="rounded-lg border border-border/60 bg-white p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">API</div>
            <div className="mt-1 text-lg font-semibold">
              {lemlist?.apiReachable ? "Reachable" : "Unavailable"}
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-white p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Webhook Secret
            </div>
            <div className="mt-1 text-lg font-semibold">
              {lemlist?.webhookSecretConfigured ? "Set" : "Missing"}
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-white p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Base URL</div>
            <div className="mt-1 truncate text-sm font-semibold">
              {lemlist?.baseUrl ?? "https://api.lemlist.com/api"}
            </div>
          </div>
        </div>
        {(lemlist?.message || lemlist?.error) && (
          <div className="border-t border-border/60 px-5 py-3 text-sm text-muted-foreground">
            {lemlist.message ?? lemlist.error}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border/60 bg-surface shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <MessageCircleWarning className="h-4 w-4 text-brand-orange" />
              WhatsApp Operations
            </div>
            <h2 className="mt-1 text-lg font-semibold">Delivery health and actions</h2>
            <p className="text-sm text-muted-foreground">
              Socket connectivity is tracked separately from outbound delivery acceptance.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadWhatsApp()}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm font-semibold hover:bg-surface-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        <div className="space-y-4 p-5">
          {whatsApp?.warning && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="font-semibold">{whatsApp.warning}</div>
              <div className="mt-1">Next retry window: {formatDateTime(whatsApp.nextRetryAt)}</div>
            </div>
          )}
          {whatsAppError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {whatsAppError}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-border/60 bg-white p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Socket</div>
              <div className="mt-1 text-lg font-semibold">
                {whatsApp?.messenger.connection ?? "unknown"}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-white p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Delivery</div>
              <div className="mt-1 text-lg font-semibold capitalize">{deliveryStatus}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-white p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Failed</div>
              <div className="mt-1 text-lg font-semibold">{whatsApp?.counts.failed ?? 0}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-white p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Queued</div>
              <div className="mt-1 text-lg font-semibold">{whatsApp?.counts.pending ?? 0}</div>
            </div>
          </div>

          <div className="rounded-lg border border-border/60 bg-white">
            <div className="border-b border-border/60 px-4 py-3 text-sm font-semibold">
              WhatsApp outbox todo
            </div>
            <div className="divide-y divide-border/40">
              {(whatsApp?.outbox ?? []).slice(0, 8).map((item) => {
                const canRetry = retryEligible(item);
                return (
                  <div
                    key={item.id}
                    className="flex flex-col gap-3 px-4 py-3 text-sm md:flex-row md:items-center md:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{item.status}</span>
                        <span className="text-muted-foreground">{item.recipient}</span>
                      </div>
                      <div className="mt-1 truncate text-muted-foreground">{item.message_body}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {item.error ?? "No error"} · next attempt{" "}
                        {formatDateTime(item.next_attempt_at)}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!canRetry || retryingId === item.id}
                      onClick={() => void retryOutbox(item.id)}
                      className="inline-flex shrink-0 items-center justify-center rounded-md bg-brand-blue px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {retryingId === item.id ? "Retrying..." : "Retry"}
                    </button>
                  </div>
                );
              })}
              {whatsApp && whatsApp.outbox.length === 0 && (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  No pending or failed WhatsApp outbox items.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-surface">
          <div className="border-b border-border/60 px-5 py-4">
            <h2 className="text-sm font-semibold">Pipeline stages</h2>
          </div>
          <div className="divide-y divide-border/40">
            {(data?.pipelineStages ?? []).map((stage) => (
              <div key={stage.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span>{stage.name}</span>
                <span className="text-muted-foreground">{stage.deals} deals</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-surface">
          <div className="border-b border-border/60 px-5 py-4">
            <h2 className="text-sm font-semibold">Task stages</h2>
          </div>
          <div className="divide-y divide-border/40">
            {(data?.taskStages ?? []).map((stage) => (
              <div key={stage.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span>{stage.name}</span>
                <span className="text-muted-foreground">
                  {stage.board_name} · {stage.tasks} tasks
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border/60 bg-surface">
        <div className="border-b border-border/60 px-5 py-4">
          <h2 className="text-sm font-semibold">Legacy CRM imports</h2>
        </div>
        <div className="divide-y divide-border/40">
          {(data?.imports ?? []).map((item) => (
            <div key={item.id} className="px-5 py-4 text-sm">
              <div className="font-medium">{new Date(item.created_at).toLocaleString()}</div>
              <div className="mt-1 text-muted-foreground">
                {item.deals_imported} deals, {item.leads_imported} leads,{" "}
                {item.organizations_imported} organizations, {item.contacts_imported} contacts
              </div>
            </div>
          ))}
          {data && data.imports.length === 0 && (
            <div className="px-5 py-6 text-sm text-muted-foreground">No imports recorded.</div>
          )}
        </div>
      </div>
    </div>
  );
}
