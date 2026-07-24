import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Banknote,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Filter,
  FolderKanban,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

export const Route = createFileRoute("/staff/projects")({
  component: Projects,
});

type Project = {
  id: string;
  name: string;
  status: string;
  priority: string;
  budget_cents: number;
  currency: string;
  due_on: string | null;
  organization_name: string | null;
  deal_title: string | null;
  deal_id?: string | null;
  deliverables: number;
  active_tasks: number;
};

type PipelineDeal = {
  id: string;
  title: string;
  organizationName: string | null;
  valueCents: number;
  currency: string;
};

type PipelineStage = {
  deals: PipelineDeal[];
};

const statusOptions = ["planned", "active", "on_hold", "completed", "cancelled"];
const priorityOptions = ["low", "medium", "high", "critical"];

function money(cents: number, currency = "ZAR") {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);
}

function dueLabel(dueOn: string | null) {
  if (!dueOn) return "No due date";
  const due = new Date(`${dueOn}T00:00:00`);
  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  return `Due in ${days}d`;
}

function statusClass(status: string) {
  if (status === "completed") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "on_hold") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "cancelled") return "bg-rose-50 text-rose-700 border-rose-200";
  if (status === "planned") return "bg-sky-50 text-sky-700 border-sky-200";
  return "bg-brand-blue/10 text-brand-blue border-brand-blue/20";
}

function priorityClass(priority: string) {
  if (priority === "critical") return "text-rose-700";
  if (priority === "high") return "text-amber-700";
  if (priority === "low") return "text-slate-500";
  return "text-brand-blue";
}

function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [pipelineDeals, setPipelineDeals] = useState<PipelineDeal[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [projectsResponse, pipelineResponse] = await Promise.all([
        fetch("/api/projects"),
        fetch("/api/crm/pipeline"),
      ]);
      const projectsBody = await projectsResponse.json();
      const pipelineBody = await pipelineResponse.json();
      if (!projectsResponse.ok) throw new Error(projectsBody.error ?? "Projects failed to load");
      if (!pipelineResponse.ok) throw new Error(pipelineBody.error ?? "Deals failed to load");
      setProjects(projectsBody.projects ?? []);
      setPipelineDeals(
        (pipelineBody.stages ?? []).flatMap((stage: PipelineStage) => stage.deals ?? []),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Projects failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesQuery =
        !q ||
        [
          project.name,
          project.organization_name,
          project.deal_title,
          project.status,
          project.priority,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      const matchesStatus = statusFilter === "all" || project.status === statusFilter;
      const matchesPriority = priorityFilter === "all" || project.priority === priorityFilter;
      return matchesQuery && matchesStatus && matchesPriority;
    });
  }, [priorityFilter, projects, query, statusFilter]);

  const stats = useMemo(() => {
    const open = projects.filter((project) =>
      ["planned", "active", "on_hold"].includes(project.status),
    );
    return {
      open: open.length,
      completed: projects.filter((project) => project.status === "completed").length,
      activeTasks: projects.reduce((sum, project) => sum + Number(project.active_tasks ?? 0), 0),
      value: open.reduce((sum, project) => sum + Number(project.budget_cents ?? 0), 0),
    };
  }, [projects]);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const selectedDealId = String(formData.get("dealId") ?? "");
    const selectedDeal = pipelineDeals.find((deal) => deal.id === selectedDealId);
    const projectName = String(formData.get("name") ?? "").trim() || selectedDeal?.title;

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: projectName,
          dealId: selectedDealId || null,
          status: formData.get("status"),
          priority: formData.get("priority"),
          budget: formData.get("budget"),
          description: formData.get("description"),
          dueOn: formData.get("dueOn"),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to create project");
      form.reset();
      setShowForm(false);
      setSuccess("Project created.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create project");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Delivery</div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Delivery work linked to deals, organizations, tasks, deliverables, and billing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button
            onClick={() => setShowFilters((value) => !value)}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            <Filter className="h-4 w-4" /> Filter
          </button>
          <Link
            to="/staff/crm"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            <BriefcaseBusiness className="h-4 w-4" /> Deals
          </Link>
          <button
            onClick={() => setShowForm((value) => !value)}
            className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
          >
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showForm ? "Close" : "New Project"}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          {success}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-md border border-border bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Open Projects
              </div>
              <div className="mt-2 text-2xl font-bold">{stats.open}</div>
            </div>
            <FolderKanban className="h-5 w-5 text-brand-blue" />
          </div>
        </div>
        <div className="rounded-md border border-border bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Active Tasks
              </div>
              <div className="mt-2 text-2xl font-bold">{stats.activeTasks}</div>
            </div>
            <ClipboardList className="h-5 w-5 text-brand-blue" />
          </div>
        </div>
        <div className="rounded-md border border-border bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Open Value
              </div>
              <div className="mt-2 text-2xl font-bold">{money(stats.value)}</div>
            </div>
            <Banknote className="h-5 w-5 text-brand-blue" />
          </div>
        </div>
        <div className="rounded-md border border-border bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Completed
              </div>
              <div className="mt-2 text-2xl font-bold">{stats.completed}</div>
            </div>
            <CheckCircle2 className="h-5 w-5 text-brand-blue" />
          </div>
        </div>
      </div>

      {showFilters && (
        <section className="grid gap-3 rounded-md border border-border bg-white p-4 md:grid-cols-[minmax(220px,1fr)_180px_180px_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects, organizations, deals..."
              className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-brand-orange"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          >
            <option value="all">All statuses</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <select
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          >
            <option value="all">All priorities</option>
            {priorityOptions.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              setQuery("");
              setStatusFilter("all");
              setPriorityFilter("all");
            }}
            className="h-10 rounded-md border border-border px-3 text-sm hover:bg-surface-2"
          >
            Clear
          </button>
        </section>
      )}

      {showForm && (
        <section className="rounded-md border border-border bg-white p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold">Create project</h2>
            <p className="text-xs text-muted-foreground">
              Link a project to a CRM deal when the work came from the sales pipeline.
            </p>
          </div>
          <form onSubmit={createProject} className="grid gap-3 lg:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Project name</span>
              <input
                name="name"
                placeholder="Leave blank to use selected deal title"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Linked deal</span>
              <select
                name="dealId"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
              >
                <option value="">No linked deal</option>
                {pipelineDeals.map((deal) => (
                  <option key={deal.id} value={deal.id}>
                    {deal.title} {deal.organizationName ? `- ${deal.organizationName}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Status</span>
              <select
                name="status"
                defaultValue="active"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Priority</span>
              <select
                name="priority"
                defaultValue="medium"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
              >
                {priorityOptions.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Budget</span>
              <input
                name="budget"
                inputMode="decimal"
                placeholder="0"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Due date</span>
              <input
                name="dueOn"
                type="date"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
              />
            </label>
            <label className="space-y-1 lg:col-span-2">
              <span className="text-xs font-medium text-muted-foreground">Description</span>
              <textarea
                name="description"
                rows={3}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand-orange"
              />
            </label>
            <div className="flex justify-end lg:col-span-2">
              <button
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                {saving ? "Creating..." : "Create Project"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-md border border-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Project register</h2>
            <p className="text-xs text-muted-foreground">
              {filteredProjects.length} of {projects.length} projects shown
            </p>
          </div>
          {loading && <span className="text-sm text-muted-foreground">Loading...</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Project</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-left font-medium">Priority</th>
                <th className="px-5 py-3 text-left font-medium">Tasks</th>
                <th className="px-5 py-3 text-left font-medium">Deliverables</th>
                <th className="px-5 py-3 text-left font-medium">Budget</th>
                <th className="px-5 py-3 text-left font-medium">Due</th>
                <th className="px-5 py-3 text-left font-medium">Links</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredProjects.map((project) => (
                <tr key={project.id} className="align-top hover:bg-surface-2/60">
                  <td className="px-5 py-4">
                    <div className="font-medium">{project.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {project.organization_name ?? "No organization"}
                    </div>
                    {project.deal_title && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Deal: {project.deal_title}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusClass(project.status)}`}
                    >
                      {project.status.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`font-medium capitalize ${priorityClass(project.priority)}`}>
                      {project.priority}
                    </span>
                  </td>
                  <td className="px-5 py-4">{project.active_tasks}</td>
                  <td className="px-5 py-4">{project.deliverables}</td>
                  <td className="px-5 py-4">{money(project.budget_cents, project.currency)}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CalendarClock className="h-3.5 w-3.5" />
                      {dueLabel(project.due_on)}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap gap-2">
                      {project.deal_id && (
                        <Link
                          to="/staff/crm/deals/$dealId"
                          params={{ dealId: project.deal_id }}
                          className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-white"
                        >
                          Deal
                        </Link>
                      )}
                      <Link
                        to="/staff/work"
                        className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-white"
                      >
                        Tasks
                      </Link>
                      <Link
                        to="/staff/billing"
                        className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-white"
                      >
                        Billing
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && filteredProjects.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground">
                    No projects match the current view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
