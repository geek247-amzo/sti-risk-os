import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Bot,
  Camera,
  ClipboardList,
  HardHat,
  Link2,
  Plus,
  Upload,
} from "lucide-react";

export const Route = createFileRoute("/staff/field-work")({
  component: FieldWork,
});

type Project = {
  id: string;
  name?: string;
  title?: string;
  status: string;
  priority: string;
  organization_name: string | null;
  site_name?: string | null;
  active_tasks?: number;
  job_cards_waiting?: number;
  reports_waiting?: number;
  job_cards?: JobCard[];
};

type JobCard = {
  id: string;
  status: string;
  parentJobCardId: string | null;
  authorizedBy: string | null;
  signedByName: string | null;
  signedAt: string | null;
};

type Subcontractor = {
  id: string;
  name: string;
  region: string | null;
  compliance_status: string;
};

type ProjectOption = {
  id: string;
  name: string;
  organization_id: string | null;
  site_id: string | null;
  site_name: string | null;
};

type ClientOption = { id: string; name: string };
type StaffOption = { id: string; name: string; role: string };

function FieldWork() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [generatedLink, setGeneratedLink] = useState("");
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [showCardForm, setShowCardForm] = useState(false);
  const [cardWorkItemId, setCardWorkItemId] = useState("");
  const [cardParentId, setCardParentId] = useState("");

  async function load() {
    const [jobsResponse, subcontractorsResponse, projectsResponse, clientsResponse, staffResponse] =
      await Promise.all([
      fetch("/api/field/jobs"),
      fetch("/api/subcontractors"),
      fetch("/api/projects"),
      fetch("/api/clients"),
      fetch("/api/staff/directory"),
    ]);
    const [jobsBody, subcontractorsBody, projectsBody, clientsBody, staffBody] = await Promise.all([
      jobsResponse.json(),
      subcontractorsResponse.json(),
      projectsResponse.json(),
      clientsResponse.json(),
      staffResponse.json(),
    ]);
    if (!jobsResponse.ok) throw new Error(jobsBody.error ?? "Field work failed to load");
    if (!subcontractorsResponse.ok)
      throw new Error(subcontractorsBody.error ?? "Subcontractors failed to load");
    setProjects(jobsBody.jobs ?? []);
    setSubcontractors(subcontractorsBody.subcontractors ?? []);
    setProjectOptions(projectsBody.projects ?? []);
    setClients(clientsBody.clients ?? []);
    setStaff(staffBody.users ?? []);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Field work failed"));
  }, []);

  async function loadSites(clientId: string) {
    if (!clientId) {
      setSites([]);
      return;
    }
    const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Sites failed to load");
    setSites(body.sites ?? []);
  }

  async function createWorkItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/field/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to create work item");
      event.currentTarget.reset();
      setShowForm(false);
      setNotice("Work item created.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create work item");
    }
  }

  const activeJobs = useMemo(
    () =>
      projects.filter((project) =>
        [
          "new",
          "quoted",
          "po_received",
          "scheduled",
          "on_site",
          "report_pending",
          "planned",
          "active",
          "on_hold",
        ].includes(project.status),
      ),
    [projects],
  );

  async function generateJobLink(workItemId: string) {
    setError("");
    setGeneratedLink("");
    try {
      const response = await fetch("/api/field/job-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workItemId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to generate job link");
      setGeneratedLink(body.url || body.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate job link");
    }
  }

  async function issueSubcontractorPo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setGeneratedLink("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/field/subcontractor-pos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to issue subcontractor PO");
      event.currentTarget.reset();
      setShowIssueForm(false);
      setGeneratedLink(body.url || "");
      setNotice("Subcontractor PO issued and job link created.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to issue subcontractor PO");
    }
  }

  async function createJobCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/field/job-cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to create job card");
      event.currentTarget.reset();
      setShowCardForm(false);
      setCardParentId("");
      setNotice(body.jobCard.parent_job_card_id ? "Sub-job-card created." : "Job card created.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create job card");
    }
  }

  const fieldFlow = [
    { label: "Secure job link", icon: Link2 },
    { label: "Checklist", icon: ClipboardList },
    { label: "Photos / videos", icon: Camera },
    { label: "Signed job card", icon: Upload },
    { label: "Report submission", icon: HardHat },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Site execution
          </div>
          <h1 className="text-2xl font-bold">Field Work</h1>
          <p className="text-sm text-muted-foreground">
            Active jobs, subcontractor submissions, checklists, photos, signed job cards, and report
            review.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            data-guide="transaction-new-work"
            onClick={() => setShowForm((value) => !value)}
            className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
          >
            <Plus className="h-4 w-4" /> New work item
          </button>
          <button
            onClick={() => setShowIssueForm((value) => !value)}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            <ClipboardList className="h-4 w-4" /> Issue subcontractor PO
          </button>
          <button
            onClick={() => {
              setCardParentId("");
              setShowCardForm((value) => !value);
            }}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            <ClipboardList className="h-4 w-4" /> Create job card
          </button>
          <Link
            to="/staff/subcontractors"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            <Link2 className="h-4 w-4" /> Prepare job link
          </Link>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}
      {generatedLink && (
        <div className="rounded-md border border-brand-blue/30 bg-brand-blue/10 p-3 text-sm text-brand-blue">
          Job link generated: <span className="font-medium">{generatedLink}</span>
        </div>
      )}
      {showIssueForm && (
        <form
          onSubmit={issueSubcontractorPo}
          className="grid gap-3 rounded-lg border border-border/60 bg-surface p-4 md:grid-cols-[1.2fr_1fr_1fr_160px_160px_auto]"
        >
          <select
            name="workItemId"
            required
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
            defaultValue=""
          >
            <option value="" disabled>
              Select work item
            </option>
            {activeJobs.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title ?? project.name} · {project.organization_name ?? "Unassigned"}
              </option>
            ))}
          </select>
          <select
            name="subcontractorId"
            required
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
            defaultValue=""
          >
            <option value="" disabled>
              Select subcontractor
            </option>
            {subcontractors.map((subcontractor) => (
              <option key={subcontractor.id} value={subcontractor.id}>
                {subcontractor.name}
                {subcontractor.region ? ` · ${subcontractor.region}` : ""}
              </option>
            ))}
          </select>
          <input
            name="poNumber"
            placeholder="PO number"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          />
          <input
            name="amount"
            type="number"
            min="0"
            step="0.01"
            placeholder="Amount"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          />
          <input
            name="dueOn"
            type="date"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          />
          <button className="h-10 rounded-md bg-brand-orange px-4 text-sm font-semibold text-primary-foreground">
            Issue
          </button>
        </form>
      )}
      {showForm && (
        <form
          data-guide="transaction-work-form"
          onSubmit={createWorkItem}
          className="grid gap-3 rounded-lg border border-border/60 bg-surface p-4 md:grid-cols-2 xl:grid-cols-4"
        >
          <select
            name="organizationId"
            required
            defaultValue=""
            onChange={(event) => {
              setSelectedClientId(event.target.value);
              setSites([]);
              void loadSites(event.target.value);
            }}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          >
            <option value="" disabled>
              Select client
            </option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <select
            name="siteId"
            required
            defaultValue=""
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          >
            <option value="" disabled>
              Select site
            </option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
          <select
            name="projectId"
            defaultValue=""
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          >
            <option value="">No project linked</option>
            {projectOptions
              .filter((project) => !selectedClientId || project.organization_id === selectedClientId)
              .map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} · {project.site_name ?? "No site"}
              </option>
              ))}
          </select>
          <input
            name="title"
            required
            placeholder="Work title"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          />
          <select
            name="workType"
            defaultValue="service"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          >
            <option value="service">Service</option>
            <option value="audit">Audit</option>
            <option value="technical_survey">Technical survey</option>
            <option value="site_visit">Site visit</option>
            <option value="extra_live_work">Extra live work</option>
          </select>
          <select
            name="priority"
            defaultValue="medium"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          <input
            name="scheduledFor"
            type="date"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          />
          <select
            name="ownerId"
            defaultValue=""
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          >
            <option value="">Assign to me</option>
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name} · {member.role}
              </option>
            ))}
          </select>
          <select
            name="subcontractorId"
            defaultValue=""
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          >
            <option value="">No subcontractor assigned</option>
            {subcontractors.map((subcontractor) => (
              <option key={subcontractor.id} value={subcontractor.id}>
                {subcontractor.name}
              </option>
            ))}
          </select>
          <button
            data-guide="transaction-save-work"
            className="h-10 rounded-md bg-brand-orange px-4 text-sm font-semibold text-primary-foreground xl:col-span-1"
          >
            Save
          </button>
          <textarea
            name="scope"
            placeholder="Scope"
            className="min-h-20 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand-orange md:col-span-2 xl:col-span-4"
          />
        </form>
      )}
      {showCardForm && (
        <form
          onSubmit={createJobCard}
          className="grid gap-3 rounded-lg border border-border/60 bg-surface p-4 md:grid-cols-[1.2fr_1.2fr_1fr_auto]"
        >
          <select
            name="workItemId"
            required
            value={cardWorkItemId}
            onChange={(event) => setCardWorkItemId(event.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          >
            <option value="" disabled>
              Select work item
            </option>
            {activeJobs.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title ?? project.name} · {project.organization_name ?? "Unassigned"}
              </option>
            ))}
          </select>
          <select
            name="parentJobCardId"
            value={cardParentId}
            onChange={(event) => setCardParentId(event.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          >
            <option value="">Primary job card</option>
            {activeJobs.flatMap((project) =>
              (project.job_cards ?? [])
                .filter((card) => !card.parentJobCardId)
                .map((card) => (
                  <option key={card.id} value={card.id}>
                    {project.title ?? project.name} · card {card.id.slice(0, 8)}
                  </option>
                )),
            )}
          </select>
          <input
            name="authorizedBy"
            required={Boolean(cardParentId)}
            placeholder={
              cardParentId
                ? "Coordinator authorization"
                : "Coordinator authorization (if applicable)"
            }
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          />
          <button className="h-10 rounded-md bg-brand-orange px-4 text-sm font-semibold text-primary-foreground">
            {cardParentId ? "Create sub-card" : "Create card"}
          </button>
        </form>
      )}

      <div className="grid gap-4 md:grid-cols-5">
        {fieldFlow.map((step) => (
          <div key={step.label} className="rounded-lg border border-border/60 bg-white p-4">
            <step.icon className="h-5 w-5 text-brand-blue" />
            <div className="mt-3 text-sm font-medium">{step.label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border/60 bg-surface p-5">
        <h2 className="text-sm font-semibold">Active jobs</h2>
        <div className="mt-4 divide-y divide-border/40">
          {activeJobs.map((project) => (
            <div
              key={project.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
            >
              <div>
                <div className="font-medium">{project.title ?? project.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {project.organization_name ?? "Unassigned client"}
                  {project.site_name ? ` · ${project.site_name}` : ""} ·{" "}
                  {project.job_cards_waiting ?? project.active_tasks ?? 0} job card(s) ·{" "}
                  {project.reports_waiting ?? 0} report(s)
                </div>
              </div>
              {(project.job_cards ?? []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(project.job_cards ?? []).map((card) => (
                    <span
                      key={card.id}
                      className="rounded-full bg-surface-2 px-2 py-1 text-[10px] uppercase text-muted-foreground"
                    >
                      {card.parentJobCardId ? "Sub-card" : "Primary"} · {card.status}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Link
                  to="/staff/steve"
                  className="rounded-md border border-border px-3 py-2 hover:bg-white"
                >
                  <Bot className="h-4 w-4" />
                </Link>
                <button
                  onClick={() => void generateJobLink(project.id)}
                  className="rounded-md border border-border px-3 py-2 text-xs hover:bg-white"
                >
                  Generate link
                </button>
                <button
                  onClick={() => {
                    setCardWorkItemId(project.id);
                    setCardParentId("");
                    setShowCardForm(true);
                  }}
                  className="rounded-md border border-border px-3 py-2 text-xs hover:bg-white"
                >
                  Create card
                </button>
                {(project.job_cards ?? [])
                  .filter((card) => !card.parentJobCardId)
                  .map((card) => (
                    <button
                      key={card.id}
                      onClick={() => {
                        setCardWorkItemId(project.id);
                        setCardParentId(card.id);
                        setShowCardForm(true);
                      }}
                      className="rounded-md border border-brand-orange/40 px-3 py-2 text-xs text-brand-orange hover:bg-white"
                    >
                      Extra work
                    </button>
                  ))}
              </div>
            </div>
          ))}
          {activeJobs.length === 0 && (
            <div className="py-8 text-sm text-muted-foreground">No active site jobs.</div>
          )}
        </div>
      </div>
    </div>
  );
}
