import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { StaffLeadCaptureModal } from "@/components/crm/StaffLeadCaptureModal";
import {
  Filter,
  Plus,
  Building2,
  Calendar,
  Banknote,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";

export const Route = createFileRoute("/staff/crm")({
  component: CrmPipeline,
});

type Deal = {
  id: string;
  title: string;
  organizationName: string;
  contactName: string | null;
  valueCents: number;
  currency: string;
  serviceInterest: string | null;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
};

type Stage = {
  id: string;
  name: string;
  position: number;
  isTerminal: boolean;
  deals: Deal[];
};

function money(cents: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);
}

function age(createdAt: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000));
}

function CrmPipeline() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [stages, setStages] = useState<Stage[]>([]);
  const [error, setError] = useState("");
  const [moving, setMoving] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [query, setQuery] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [notice, setNotice] = useState("");
  const [showAddLead, setShowAddLead] = useState(false);
  const [leadMode, setLeadMode] = useState<"manual" | "image">("manual");
  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [leadMessage, setLeadMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/crm/pipeline");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Pipeline failed to load");
    setStages(body.stages);
  }, []);

  useEffect(() => {
    if (pathname !== "/staff/crm") return;
    load().catch((err) => setError(err instanceof Error ? err.message : "Pipeline failed to load"));
  }, [load, pathname]);

  const owners = useMemo(
    () =>
      Array.from(
        new Set(
          stages.flatMap((stage) => stage.deals.map((deal) => deal.ownerName).filter(Boolean)),
        ),
      ).sort() as string[],
    [stages],
  );

  const filteredStages = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stages.map((stage) => ({
      ...stage,
      deals: stage.deals.filter((deal) => {
        const matchesOwner = ownerFilter === "all" || deal.ownerName === ownerFilter;
        const matchesQuery =
          !q ||
          [
            deal.title,
            deal.organizationName,
            deal.contactName,
            deal.serviceInterest,
            deal.ownerName,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q);
        return matchesOwner && matchesQuery;
      }),
    }));
  }, [ownerFilter, query, stages]);

  async function moveDeal(dealId: string, stageId: string) {
    setMoving(dealId);
    setError("");
    try {
      const response = await fetch(`/api/crm/deals/${dealId}/stage`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stageId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to move deal");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to move deal");
    } finally {
      setMoving("");
    }
  }

  async function submitManualLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = Object.fromEntries(form.entries());
    const email = typeof payload.email === "string" ? payload.email.trim() : "";
    const phone = typeof payload.phone === "string" ? payload.phone.trim() : "";
    if (!email && !phone) {
      setLeadMessage("Enter an email address or phone number.");
      return;
    }

    setLeadSubmitting(true);
    setLeadMessage("");
    setError("");
    try {
      const response = await fetch("/api/crm/contacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Lead capture failed");
      await load();
      formElement.reset();
      setShowAddLead(false);
      setNotice("Lead captured in CRM.");
    } catch (err) {
      setLeadMessage(err instanceof Error ? err.message : "Lead capture failed");
    } finally {
      setLeadSubmitting(false);
    }
  }

  async function submitImageLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (!(form.get("image") instanceof File)) {
      setLeadMessage("Choose an image to process.");
      return;
    }

    setLeadSubmitting(true);
    setLeadMessage("");
    setError("");
    try {
      const response = await fetch("/api/crm/contacts/image-intake", {
        method: "POST",
        body: form,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Image intake failed");
      await load();
      formElement.reset();
      setShowAddLead(false);
      setNotice("Image processed by n8n and lead captured in CRM.");
    } catch (err) {
      setLeadMessage(err instanceof Error ? err.message : "Image intake failed");
    } finally {
      setLeadSubmitting(false);
    }
  }

  if (pathname !== "/staff/crm") {
    return <Outlet />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">CRM</div>
          <h1 className="text-2xl font-bold">Sales Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Live opportunities from public forms, n8n intake, Gemini agent support, and staff CRM
            workflows.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/staff/crm/contacts"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            Contacts <ChevronRight className="h-4 w-4" />
          </Link>
          <button
            onClick={() => setShowFilters((value) => !value)}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            <Filter className="h-4 w-4" /> Filter
          </button>
          <button
            type="button"
            onClick={() => {
              setLeadMode("manual");
              setLeadMessage("");
              setShowAddLead(true);
            }}
            className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
          >
            <Plus className="h-4 w-4" /> Capture Lead
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-brand-blue/30 bg-brand-blue/10 p-3 text-sm text-brand-blue">
          {notice}
        </div>
      )}

      {showFilters && (
        <div className="grid gap-3 rounded-lg border border-border/60 bg-surface p-4 md:grid-cols-[minmax(220px,1fr)_220px_auto]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search deals, organizations, contacts..."
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          />
          <select
            value={ownerFilter}
            onChange={(event) => setOwnerFilter(event.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          >
            <option value="all">All owners</option>
            {owners.map((owner) => (
              <option key={owner} value={owner}>
                {owner}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              setQuery("");
              setOwnerFilter("all");
            }}
            className="h-10 rounded-md border border-border px-3 text-sm hover:bg-surface-2"
          >
            Clear
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {filteredStages.map((s) => {
          const total = s.deals.reduce((sum, d) => sum + d.valueCents, 0);
          return (
            <div key={s.id} className="rounded-md border border-border/60 bg-surface px-4 py-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{s.name}</div>
              <div className="mt-1 flex items-baseline justify-between gap-3">
                <div className="text-lg font-bold">{money(total)}</div>
                <div className="text-xs text-muted-foreground">{s.deals.length} deals</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="-mx-6 overflow-x-auto pb-4">
        <div className="flex min-w-max gap-4 px-6">
          {filteredStages.map((stage) => (
            <div
              key={stage.id}
              className="flex w-80 shrink-0 flex-col rounded-lg border border-border/60 bg-surface/60"
            >
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-brand-orange" />
                  <h3 className="text-sm font-semibold">{stage.name}</h3>
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground">
                    {stage.deals.length}
                  </span>
                </div>
              </div>

              <div className="flex-1 space-y-3 p-3">
                {stage.deals.map((d) => (
                  <article
                    key={d.id}
                    className="rounded-md border border-border/60 bg-surface p-3 transition hover:border-brand-orange/50"
                  >
                    <Link
                      to="/staff/crm/deals/$dealId"
                      params={{ dealId: d.id }}
                      className="block text-sm font-medium leading-snug hover:text-brand-orange"
                    >
                      {d.title}
                    </Link>
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Building2 className="h-3 w-3" /> {d.organizationName}
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-1 text-sm font-semibold text-brand-orange">
                        <Banknote className="h-3.5 w-3.5" />
                        {money(d.valueCents)}
                      </div>
                      <span className="rounded-full bg-brand-blue/15 px-2 py-0.5 text-[10px] font-medium text-brand-blue">
                        {d.serviceInterest ?? "Lead"}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2.5">
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Calendar className="h-3 w-3" /> {age(d.createdAt)}d
                      </span>
                      <select
                        disabled={moving === d.id}
                        value={stage.id}
                        onChange={(event) => moveDeal(d.id, event.target.value)}
                        className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-brand-orange"
                      >
                        {stages.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </article>
                ))}
                {stage.deals.length === 0 && (
                  <div className="rounded-md border border-dashed border-border/70 p-4 text-center text-sm text-muted-foreground">
                    No deals
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {showAddLead && (
        <StaffLeadCaptureModal
          mode={leadMode}
          setMode={setLeadMode}
          submitting={leadSubmitting}
          message={leadMessage}
          onClose={() => {
            if (leadSubmitting) return;
            setShowAddLead(false);
            setLeadMessage("");
          }}
          onManualSubmit={submitManualLead}
          onImageSubmit={submitImageLead}
        />
      )}
    </div>
  );
}
