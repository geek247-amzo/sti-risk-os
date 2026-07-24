import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileSignature,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";

export const Route = createFileRoute("/staff/quotes")({
  component: Quotes,
});

type Quote = {
  id: string;
  quote_number: string;
  status: string;
  currency: string;
  total_value_cents: number;
  margin_cents: number;
  margin_percent: string | number;
  valid_until: string | null;
  organization_name: string;
  site_name: string;
  created_by_name: string | null;
  validation_status: "green" | "amber" | "red" | null;
  validation_summary: string | null;
  attention: string;
  updated_at: string;
};

type QuoteTemplate = {
  id: string;
  name: string;
  description: string | null;
  organization_name: string | null;
  site_name: string | null;
  updated_at: string;
};

const statuses = [
  "all",
  "draft",
  "pending_technical_review",
  "approved_internal",
  "sent_to_client",
  "accepted",
  "rejected",
];

function money(cents: number, currency = "ZAR") {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function statusClass(status: string) {
  if (status === "accepted") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "rejected") return "bg-rose-50 text-rose-700 border-rose-200";
  if (status === "approved_internal")
    return "bg-brand-blue/10 text-brand-blue border-brand-blue/20";
  if (status === "sent_to_client") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "pending_technical_review")
    return "bg-orange-50 text-orange-700 border-orange-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

function validationClass(status: Quote["validation_status"]) {
  if (status === "green") return "text-emerald-700";
  if (status === "red") return "text-rose-700";
  if (status === "amber") return "text-amber-700";
  return "text-muted-foreground";
}

function Quotes() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [templates, setTemplates] = useState<QuoteTemplate[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [quotesResponse, supportResponse] = await Promise.all([
        fetch("/api/quotes"),
        fetch("/api/quote-support"),
      ]);
      const quotesBody = await quotesResponse.json();
      if (!quotesResponse.ok) throw new Error(quotesBody.error ?? "Quotes failed to load");
      const supportBody = supportResponse.ok ? await supportResponse.json() : {};
      setQuotes(quotesBody.quotes ?? []);
      setTemplates(supportBody.templates ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Quotes failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (pathname !== "/staff/quotes") return;
    void load();
  }, [pathname]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return quotes.filter((quote) => {
      const matchesStatus = statusFilter === "all" || quote.status === statusFilter;
      const matchesQuery =
        !q ||
        [
          quote.quote_number,
          quote.organization_name,
          quote.site_name,
          quote.status,
          quote.validation_summary,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [query, quotes, statusFilter]);

  const stats = useMemo(
    () => ({
      open: quotes.filter((quote) => !["accepted", "rejected"].includes(quote.status)).length,
      review: quotes.filter((quote) => quote.attention === "vusi_technical_review").length,
      value: quotes
        .filter((quote) => !["rejected"].includes(quote.status))
        .reduce((sum, quote) => sum + Number(quote.total_value_cents ?? 0), 0),
      margin: quotes.reduce((sum, quote) => sum + Number(quote.margin_cents ?? 0), 0),
    }),
    [quotes],
  );

  if (pathname !== "/staff/quotes") return <Outlet />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Quotations</div>
          <h1 className="text-2xl font-bold">Quotes & Technical Validation</h1>
          <p className="text-sm text-muted-foreground">
            Draft client quotes, run Steve compatibility checks, and track approval status.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/staff/quotes/onsite"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            <Plus className="h-4 w-4" /> On-site Quote
          </Link>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <Link
            to="/staff/quotes/new"
            className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
          >
            <Plus className="h-4 w-4" /> New Quote
          </Link>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-border/60 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Open</div>
              <div className="mt-2 text-2xl font-bold">{stats.open}</div>
            </div>
            <FileSignature className="h-5 w-5 text-brand-blue" />
          </div>
        </div>
        <div className="rounded-lg border border-border/60 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Needs Vusi
              </div>
              <div className="mt-2 text-2xl font-bold">{stats.review}</div>
            </div>
            <ShieldAlert className="h-5 w-5 text-brand-orange" />
          </div>
        </div>
        <div className="rounded-lg border border-border/60 bg-white p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Quote Value</div>
          <div className="mt-2 text-2xl font-bold">{money(stats.value)}</div>
        </div>
        <div className="rounded-lg border border-border/60 bg-white p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Gross Margin</div>
          <div className="mt-2 text-2xl font-bold">{money(stats.margin)}</div>
        </div>
      </div>

      <div className="rounded-lg border border-border/60 bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Templates</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Start a quote from a saved template instead of rebuilding the same structure.
            </div>
          </div>
          <div className="text-sm text-muted-foreground">{templates.length} saved</div>
        </div>
        {templates.length === 0 ? (
          <div className="mt-4 text-sm text-muted-foreground">No saved templates yet.</div>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {templates.slice(0, 6).map((template) => (
              <Link
                key={template.id}
                to="/staff/quotes/new"
                search={{ templateId: template.id }}
                className="rounded-md border border-border bg-white p-3 text-sm hover:border-brand-orange hover:bg-surface-2"
              >
                <div className="font-semibold">{template.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {template.organization_name ?? "Any client"}
                  {template.site_name ? ` · ${template.site_name}` : ""}
                </div>
                {template.description && (
                  <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                    {template.description}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 rounded-lg border border-border/60 bg-surface p-4 lg:grid-cols-[minmax(240px,1fr)_220px]">
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search quote number, client, site, or validation..."
            className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-brand-orange"
          />
        </label>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
        >
          {statuses.map((status) => (
            <option key={status} value={status}>
              {status === "all" ? "All statuses" : statusLabel(status)}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border border-border/60 bg-surface">
        <div className="divide-y divide-border/40">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading quotes...</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No quotes match this view.</div>
          ) : (
            filtered.map((quote) => (
              <Link
                key={quote.id}
                to="/staff/quotes/$quoteId"
                params={{ quoteId: quote.id }}
                className="grid gap-3 p-4 transition hover:bg-surface-2/60 lg:grid-cols-[minmax(220px,1fr)_180px_160px_140px]"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{quote.quote_number}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass(quote.status)}`}
                    >
                      {statusLabel(quote.status)}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {quote.organization_name} · {quote.site_name}
                  </div>
                  <div className={`mt-1 text-xs ${validationClass(quote.validation_status)}`}>
                    {quote.validation_status ? (
                      <>
                        Steve: {quote.validation_status} · {quote.validation_summary}
                      </>
                    ) : (
                      "Steve check not run"
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock3 className="h-4 w-4" />
                  {quote.valid_until ? `Valid until ${quote.valid_until}` : "No validity date"}
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Margin
                  </div>
                  <div className="font-medium">
                    {money(quote.margin_cents, quote.currency)} · {Number(quote.margin_percent)}%
                  </div>
                </div>
                <div className="text-right lg:text-left">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Total
                  </div>
                  <div className="font-semibold">
                    {money(quote.total_value_cents, quote.currency)}
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        <div className="flex items-center gap-2 font-semibold">
          <CheckCircle2 className="h-4 w-4" />
          Approval rule
        </div>
        <p className="mt-1">
          Internal approval is blocked until the latest Steve technical check is green.
        </p>
      </div>
    </div>
  );
}
