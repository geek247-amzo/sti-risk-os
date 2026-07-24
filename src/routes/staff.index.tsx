import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Building2,
  ClipboardCheck,
  FileSignature,
  FileStack,
  HardHat,
  PackageCheck,
} from "lucide-react";

export const Route = createFileRoute("/staff/")({
  component: CommandCentre,
});

type PipelineStage = {
  name: string;
  deals: { id: string; title: string; organizationName: string; valueCents: number }[];
};

type Quote = {
  id: string;
  quote_number: string;
  status: string;
  organization_name: string;
  total_value_cents: number;
  attention: string;
};

type Project = {
  id: string;
  name: string;
  status: string;
  priority: string;
  organization_name: string | null;
  active_tasks: number;
};

type Invoice = {
  id: string;
  status: string;
  total_cents: number;
  organization_name: string | null;
};

type CommandData = {
  stages: PipelineStage[];
  quotes: Quote[];
  projects: Project[];
  invoices: Invoice[];
};

function money(cents: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);
}

function CommandCentre() {
  const [data, setData] = useState<CommandData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const [pipelineResponse, quotesResponse, projectsResponse, invoicesResponse] =
        await Promise.all([
          fetch("/api/crm/pipeline"),
          fetch("/api/quotes"),
          fetch("/api/projects"),
          fetch("/api/billing/invoices"),
        ]);
      const [pipeline, quotes, projects, invoices] = await Promise.all([
        pipelineResponse.json(),
        quotesResponse.json(),
        projectsResponse.json(),
        invoicesResponse.json(),
      ]);
      if (!pipelineResponse.ok) throw new Error(pipeline.error ?? "Pipeline failed to load");
      if (!quotesResponse.ok) throw new Error(quotes.error ?? "Quotes failed to load");
      if (!projectsResponse.ok) throw new Error(projects.error ?? "Work failed to load");
      if (!invoicesResponse.ok) throw new Error(invoices.error ?? "Finance failed to load");
      setData({
        stages: pipeline.stages ?? [],
        quotes: quotes.quotes ?? [],
        projects: projects.projects ?? [],
        invoices: invoices.invoices ?? [],
      });
    }

    load().catch((err) => setError(err instanceof Error ? err.message : "Command Centre failed"));
  }, []);

  const summary = useMemo(() => {
    const deals = data?.stages.flatMap((stage) => stage.deals) ?? [];
    const openQuotes =
      data?.quotes.filter((quote) => !["accepted", "rejected"].includes(quote.status)) ?? [];
    const siteJobs =
      data?.projects.filter((project) => ["planned", "active", "on_hold"].includes(project.status)) ??
      [];
    const outstandingInvoices =
      data?.invoices.filter((invoice) => ["sent", "overdue"].includes(invoice.status)) ?? [];
    return {
      pipelineValue: deals.reduce((sum, deal) => sum + Number(deal.valueCents ?? 0), 0),
      urgentWork: siteJobs.filter(
        (project) => project.priority === "critical" || project.priority === "high",
      ).length,
      openQuotes: openQuotes.length,
      quoteValue: openQuotes.reduce((sum, quote) => sum + Number(quote.total_value_cents ?? 0), 0),
      poReady: data?.quotes.filter((quote) => quote.status === "accepted").length ?? 0,
      reportsMissing: siteJobs.reduce((sum, project) => sum + Number(project.active_tasks ?? 0), 0),
      outstandingFinance: outstandingInvoices.reduce(
        (sum, invoice) => sum + Number(invoice.total_cents ?? 0),
        0,
      ),
    };
  }, [data]);

  const operatingChain = [
    "Client",
    "Site",
    "Asset",
    "Work Type",
    "Quote",
    "Client PO",
    "Sales Order",
    "Subcontractor PO",
    "Field Work",
    "Report",
    "Invoice",
    "Evidence",
  ];

  const actions = [
    { to: "/staff/vusi", label: "Open Vusi workspace", icon: ClipboardCheck },
    { to: "/staff/clients", label: "Find client folder", icon: Building2 },
    { to: "/staff/po-orders", label: "Upload or match PO", icon: PackageCheck },
    { to: "/staff/field-work", label: "Review field work", icon: HardHat },
    { to: "/staff/reports", label: "Review reports", icon: FileStack },
    { to: "/staff/steve", label: "Ask Steve", icon: Bot },
  ] as const;

  return (
    <div className="mx-auto max-w-[1600px] space-y-6" data-guide="command-centre">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            STI Operating OS
          </div>
          <h1 className="text-2xl font-bold">Command Centre</h1>
          <p className="text-sm text-muted-foreground">
            Client to evidence control surface for quotes, POs, field work, reports, finance, and
            Steve.
          </p>
        </div>
        <Link
          to="/staff/steve"
          className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
        >
          <Bot className="h-4 w-4" /> Ask Steve what needs attention
        </Link>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Pipeline" value={money(summary.pipelineValue)} />
        <Metric label="Open quotes" value={summary.openQuotes} detail={money(summary.quoteValue)} />
        <Metric label="Urgent work" value={summary.urgentWork} detail="High priority jobs" />
        <Metric
          label="Outstanding finance"
          value={money(summary.outstandingFinance)}
          detail="Sent or overdue"
        />
      </div>

      <div className="rounded-lg border border-border/60 bg-surface p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Operating chain</h2>
            <p className="text-xs text-muted-foreground">
              Every screen should anchor work to this chain.
            </p>
          </div>
          <FileSignature className="h-5 w-5 text-brand-orange" />
        </div>
        <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-6">
          {operatingChain.map((step, index) => (
            <div key={step} className="rounded-md border border-border/60 bg-background p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </div>
              <div className="mt-1 text-sm font-medium">{step}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {actions.map((action) => (
          <Link
            key={action.to}
            to={action.to}
            className="flex items-center justify-between rounded-lg border border-border/60 bg-white p-4 text-sm font-semibold hover:border-brand-orange/50 hover:bg-surface"
          >
            <span className="inline-flex items-center gap-3">
              <action.icon className="h-5 w-5 text-brand-blue" />
              {action.label}
            </span>
            <span className="text-muted-foreground">Open</span>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Queue title="Quotes waiting for action" items={data?.quotes.slice(0, 6) ?? []} />
        <Queue
          title="Active work"
          items={(data?.projects ?? [])
            .filter((project) => project.status !== "completed")
            .slice(0, 6)
            .map((project) => ({
              id: project.id,
              quote_number: project.name,
              organization_name: project.organization_name ?? "Unassigned client",
              status: `${project.priority} priority`,
            }))}
        />
        <Queue
          title="PO / finance attention"
          items={(data?.invoices ?? []).slice(0, 6).map((invoice) => ({
            id: invoice.id,
            quote_number: invoice.organization_name ?? "Finance record",
            organization_name: money(invoice.total_cents),
            status: invoice.status,
          }))}
        />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-white p-5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
      {detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
    </div>
  );
}

function Queue({
  title,
  items,
}: {
  title: string;
  items: { id: string; quote_number: string; organization_name: string; status: string }[];
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-4 divide-y divide-border/40">
        {items.map((item) => (
          <div key={item.id} className="py-3 text-sm">
            <div className="font-medium">{item.quote_number}</div>
            <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{item.organization_name}</span>
              <span className="capitalize">{item.status.replaceAll("_", " ")}</span>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="py-6 text-sm text-muted-foreground">Nothing waiting here.</div>
        )}
      </div>
    </div>
  );
}
