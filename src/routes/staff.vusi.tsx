import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  FileSignature,
  FileWarning,
  HardHat,
  PackageCheck,
  ReceiptText,
  ShieldAlert,
} from "lucide-react";

export const Route = createFileRoute("/staff/vusi")({
  component: VusiWorkspace,
});

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
type TimeAllocation = { category_label: string; activity_label: string; hours: number };

function money(cents: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);
}

function VusiWorkspace() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [timeAllocation, setTimeAllocation] = useState<TimeAllocation[]>([]);
  const [timeForm, setTimeForm] = useState({ categoryKey: "project_delivery", activityLabel: "", hours: "" });
  const [timeError, setTimeError] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const [quotesResponse, projectsResponse, invoicesResponse, kpiResponse] = await Promise.all([
        fetch("/api/quotes"),
        fetch("/api/projects"),
        fetch("/api/billing/invoices"),
        fetch("/api/staff/kpi-dashboard"),
      ]);
      const [quotesBody, projectsBody, invoicesBody, kpiBody] = await Promise.all([
        quotesResponse.json(),
        projectsResponse.json(),
        invoicesResponse.json(),
        kpiResponse.json(),
      ]);
      if (!quotesResponse.ok) throw new Error(quotesBody.error ?? "Quotes failed to load");
      if (!projectsResponse.ok) throw new Error(projectsBody.error ?? "Work failed to load");
      if (!invoicesResponse.ok) throw new Error(invoicesBody.error ?? "Finance failed to load");
      if (!kpiResponse.ok) throw new Error(kpiBody.error ?? "KPI data failed to load");
      setQuotes(quotesBody.quotes ?? []);
      setProjects(projectsBody.projects ?? []);
      setInvoices(invoicesBody.invoices ?? []);
      setTimeAllocation(kpiBody.timeAllocation ?? []);
    }

    load().catch((err) => setError(err instanceof Error ? err.message : "Workspace failed"));
  }, []);

  const queues = useMemo(() => {
    const activeJobs = projects.filter((project) =>
      ["planned", "active", "on_hold"].includes(project.status),
    );
    return [
      {
        label: "Quotes to create / review",
        value: quotes.filter(
          (quote) => quote.status === "draft" || quote.attention === "vusi_technical_review",
        ).length,
        icon: FileSignature,
        to: "/staff/quotes" as const,
      },
      {
        label: "Waiting for client PO",
        value: quotes.filter((quote) => quote.status === "sent_to_client").length,
        icon: PackageCheck,
        to: "/staff/po-orders" as const,
      },
      {
        label: "Client POs received",
        value: quotes.filter((quote) => quote.status === "accepted").length,
        icon: CheckCircle2,
        to: "/staff/po-orders" as const,
      },
      {
        label: "Sales orders pending",
        value: quotes.filter((quote) => quote.status === "accepted").length,
        icon: ClipboardCheck,
        to: "/staff/po-orders" as const,
      },
      {
        label: "Subcontractor POs pending",
        value: activeJobs.filter((project) => project.priority === "high").length,
        icon: ReceiptText,
        to: "/staff/subcontractors" as const,
      },
      {
        label: "Jobs on site today",
        value: activeJobs.length,
        icon: HardHat,
        to: "/staff/field-work" as const,
      },
      {
        label: "Reports / job cards missing",
        value: activeJobs.reduce((sum, project) => sum + Number(project.active_tasks ?? 0), 0),
        icon: FileWarning,
        to: "/staff/reports" as const,
      },
      {
        label: "New risks / extra work",
        value: activeJobs.filter((project) => project.priority === "critical").length,
        icon: ShieldAlert,
        to: "/staff/assets-risk" as const,
      },
      {
        label: "Subcontractor payments pending",
        value: invoices.filter((invoice) => ["sent", "overdue"].includes(invoice.status)).length,
        icon: ReceiptText,
        to: "/staff/billing" as const,
      },
    ];
  }, [invoices, projects, quotes]);

  async function addTimeEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTimeError("");
    const response = await fetch("/api/staff/kpi-dashboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...timeForm, hours: Number(timeForm.hours) }),
    });
    const body = await response.json();
    if (!response.ok) {
      setTimeError(body.error ?? "Unable to save time entry");
      return;
    }
    setTimeForm((current) => ({ ...current, activityLabel: "", hours: "" }));
    const refresh = await fetch("/api/staff/kpi-dashboard");
    const refreshBody = await refresh.json();
    setTimeAllocation(refreshBody.timeAllocation ?? []);
  }

  const nextQuotes = quotes
    .filter((quote) => quote.status !== "accepted" && quote.status !== "rejected")
    .slice(0, 6);
  const activeJobs = projects
    .filter((project) => project.status !== "completed" && project.status !== "cancelled")
    .slice(0, 6);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Daily control room
          </div>
          <h1 className="text-2xl font-bold">Vusi Workspace</h1>
          <p className="text-sm text-muted-foreground">
            Quotes, POs, site work, reports, job cards, invoices, subcontractors, and risks in one
            operating view.
          </p>
        </div>
        <Link
          to="/staff/steve"
          className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
        >
          <Bot className="h-4 w-4" /> What should I do next?
        </Link>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        {queues.map((queue) => (
          <Link
            key={queue.label}
            to={queue.to}
            className="rounded-lg border border-border/60 bg-white p-4 hover:border-brand-orange/50 hover:bg-surface"
          >
            <div className="flex items-center justify-between gap-3">
              <queue.icon className="h-5 w-5 text-brand-blue" />
              <div className="text-2xl font-bold">{queue.value}</div>
            </div>
            <div className="mt-3 text-sm font-medium">{queue.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <WorkQueue title="Quotes needing movement" rows={nextQuotes} />
        <WorkQueue
          title="Active site work"
          rows={activeJobs.map((project) => ({
            id: project.id,
            quote_number: project.name,
            organization_name: project.organization_name ?? "Unassigned client",
            status: project.priority,
            total_value_cents: project.active_tasks,
          }))}
          taskMode
        />
      </div>

      <section className="rounded-xl border border-border/60 bg-surface p-5 shadow-sm">
        <div className="mb-4">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">D-1 · This week</div>
          <h2 className="text-xl font-bold">Daily time tracking</h2>
          <p className="text-sm text-muted-foreground">Log activity against the existing Category A–F structure; entries roll up weekly.</p>
        </div>
        <form className="grid gap-3 md:grid-cols-[1fr_2fr_120px_auto]" onSubmit={addTimeEntry}>
          <select className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={timeForm.categoryKey} onChange={(event) => setTimeForm({ ...timeForm, categoryKey: event.target.value })}>
            <option value="revenue_development">Revenue Development</option>
            <option value="partner_development">Partner Development</option>
            <option value="project_delivery">Project Delivery</option>
            <option value="quotations">Quotations</option>
            <option value="strategy_management">Strategy &amp; Management</option>
            <option value="travel">Travel</option>
          </select>
          <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" placeholder="Activity" value={timeForm.activityLabel} onChange={(event) => setTimeForm({ ...timeForm, activityLabel: event.target.value })} required />
          <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" type="number" min="0.1" max="24" step="0.1" placeholder="Hours" value={timeForm.hours} onChange={(event) => setTimeForm({ ...timeForm, hours: event.target.value })} required />
          <button className="rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-primary-foreground" type="submit">Log time</button>
        </form>
        {timeError && <p className="mt-2 text-sm text-destructive">{timeError}</p>}
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {timeAllocation.map((entry) => <div key={`${entry.category_label}-${entry.activity_label}`} className="rounded-lg border border-border bg-background p-3 text-sm"><div className="font-medium">{entry.category_label}</div><div className="text-muted-foreground">{entry.activity_label} · {entry.hours}h</div></div>)}
          {!timeAllocation.length && <p className="text-sm text-muted-foreground">No time logged this week.</p>}
        </div>
      </section>
    </div>
  );
}

function WorkQueue({
  title,
  rows,
  taskMode = false,
}: {
  title: string;
  rows: Quote[];
  taskMode?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-4 divide-y divide-border/40">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center justify-between gap-4 py-3 text-sm">
            <div>
              <div className="font-medium">{row.quote_number}</div>
              <div className="mt-1 text-xs text-muted-foreground">{row.organization_name}</div>
            </div>
            <div className="text-right">
              <div className="capitalize">{row.status.replaceAll("_", " ")}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {taskMode ? `${row.total_value_cents} open task(s)` : money(row.total_value_cents)}
              </div>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="py-8 text-sm text-muted-foreground">No records waiting here.</div>
        )}
      </div>
    </div>
  );
}
