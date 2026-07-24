import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  UserRound,
} from "lucide-react";

export const Route = createFileRoute("/staff/crm/deals/$dealId")({
  component: DealDetail,
});

type DealDetailData = {
  deal: {
    id: string;
    title: string;
    value_cents: number;
    currency: string;
    source: string;
    service_interest: string | null;
    description: string | null;
    status: string;
    stage_name: string | null;
    organization_name: string | null;
    contact_id: string | null;
    first_name: string | null;
    last_name: string | null;
    owner_name: string | null;
    project_id: string | null;
    campaign_source: string | null;
    probability: string | number | null;
    expected_close_date: string | null;
    next_activity_at: string | null;
    campaign_links: number;
    last_campaign_event: string | null;
    last_campaign_event_at: string | null;
    created_at: string;
    updated_at: string;
  };
  activities: {
    id: string;
    type: string;
    title: string;
    body: string | null;
    due_at: string | null;
    completed_at: string | null;
    created_at: string;
  }[];
  tasks: {
    id: string;
    title: string;
    description: string | null;
    priority: string;
    status: string;
    due_at: string | null;
    stage_name: string | null;
  }[];
  communications: {
    id: string;
    direction: string;
    channel: string;
    subject: string | null;
    summary: string | null;
    created_at: string;
  }[];
  memory: {
    id: string;
    content: string;
    metadata: { raw?: Record<string, string>; kind?: string; source?: string };
    created_at: string;
  }[];
};

function money(cents: number, currency = "ZAR") {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/40 py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[65%] text-right font-medium">{value || "Not set"}</span>
    </div>
  );
}

function DealDetail() {
  const { dealId } = Route.useParams();
  const [data, setData] = useState<DealDetailData | null>(null);
  const [error, setError] = useState("");
  const [converting, setConverting] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/crm/deals/${dealId}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Deal failed to load");
    setData(body);
  }, [dealId]);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Deal failed to load"));
  }, [load]);

  async function convertToProject() {
    setConverting(true);
    setError("");
    try {
      const response = await fetch(`/api/deals/${dealId}/convert-to-project`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to convert deal");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to convert deal");
    } finally {
      setConverting(false);
    }
  }

  const contactName = [data?.deal.first_name, data?.deal.last_name].filter(Boolean).join(" ");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            to="/staff/crm"
            className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-brand-orange"
          >
            <ArrowLeft className="h-4 w-4" /> Pipeline
          </Link>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">CRM Deal</div>
          <h1 className="text-2xl font-bold">{data?.deal.title ?? "Deal"}</h1>
          <p className="text-sm text-muted-foreground">
            CRM context, campaign history, activity, tasks, and searchable memory.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/staff/chat"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            <Bot className="h-4 w-4" /> Ask Steve
          </Link>
          <button
            onClick={convertToProject}
            disabled={converting || Boolean(data?.deal.project_id)}
            className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {data?.deal.project_id ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <BriefcaseBusiness className="h-4 w-4" />
            )}
            {data?.deal.project_id
              ? "Project Created"
              : converting
                ? "Converting..."
                : "Convert to Project"}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-border/60 bg-surface p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Value</div>
              <div className="mt-2 text-2xl font-bold">
                {money(data?.deal.value_cents ?? 0, data?.deal.currency)}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-surface p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Stage</div>
              <div className="mt-2 text-2xl font-bold">{data?.deal.stage_name ?? "Unstaged"}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-surface p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Status</div>
              <div className="mt-2 text-2xl font-bold capitalize">
                {data?.deal.status ?? "open"}
              </div>
            </div>
          </div>

          <section className="rounded-lg border border-border/60 bg-surface">
            <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
              <ClipboardList className="h-4 w-4 text-brand-orange" />
              <h2 className="text-sm font-semibold">Tasks</h2>
            </div>
            <div className="divide-y divide-border/40">
              {(data?.tasks ?? []).map((task) => (
                <article key={task.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{task.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {task.stage_name ?? "No stage"} · {task.status}
                      </div>
                    </div>
                    <span className="rounded-full bg-brand-blue/15 px-2 py-0.5 text-xs font-medium text-brand-blue">
                      {task.due_at ? new Date(task.due_at).toLocaleDateString() : "No due date"}
                    </span>
                  </div>
                </article>
              ))}
              {data && data.tasks.length === 0 && (
                <div className="px-5 py-6 text-sm text-muted-foreground">No linked tasks.</div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-border/60 bg-surface">
            <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
              <CalendarClock className="h-4 w-4 text-brand-orange" />
              <h2 className="text-sm font-semibold">Activity</h2>
            </div>
            <div className="divide-y divide-border/40">
              {(data?.activities ?? []).map((activity) => (
                <article key={activity.id} className="px-5 py-4">
                  <div className="text-sm font-medium">{activity.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {activity.type} · {new Date(activity.created_at).toLocaleString()}
                  </div>
                  {activity.body && (
                    <p className="mt-2 text-sm text-muted-foreground">{activity.body}</p>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-border/60 bg-surface">
            <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
              <Bot className="h-4 w-4 text-brand-orange" />
              <h2 className="text-sm font-semibold">Steve Next Action</h2>
            </div>
            <div className="p-5 text-sm text-muted-foreground">
              Review campaign response state, next activity date, quote follow-up risk, and open
              tasks before making pipeline changes.
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-lg border border-border/60 bg-surface p-5">
            <h2 className="text-sm font-semibold">Context</h2>
            <div className="mt-3">
              <DetailRow label="Source" value={data?.deal.source} />
              <DetailRow label="Campaign source" value={data?.deal.campaign_source} />
              <DetailRow label="Campaign links" value={String(data?.deal.campaign_links ?? 0)} />
              <DetailRow label="Last campaign event" value={data?.deal.last_campaign_event} />
              <DetailRow label="Owner" value={data?.deal.owner_name} />
              <DetailRow label="Service" value={data?.deal.service_interest} />
              <DetailRow label="Expected close" value={data?.deal.expected_close_date} />
              <DetailRow
                label="Next activity"
                value={
                  data?.deal.next_activity_at
                    ? new Date(data.deal.next_activity_at).toLocaleString()
                    : null
                }
              />
              <DetailRow
                label="Created"
                value={
                  data?.deal.created_at ? new Date(data.deal.created_at).toLocaleString() : null
                }
              />
            </div>
          </section>

          <section className="rounded-lg border border-border/60 bg-surface p-5">
            <h2 className="text-sm font-semibold">Business links</h2>
            <div className="mt-3">
              <DetailRow label="Organization" value={data?.deal.organization_name} />
              <DetailRow label="Contact" value={contactName || null} />
            </div>
            <div className="mt-4 flex gap-2 text-muted-foreground">
              <Building2 className="h-4 w-4" />
              <UserRound className="h-4 w-4" />
            </div>
          </section>

          <section className="rounded-lg border border-border/60 bg-surface p-5">
            <h2 className="text-sm font-semibold">Memory</h2>
            <div className="mt-3 space-y-3">
              {(data?.memory ?? []).map((item) => (
                <div
                  key={item.id}
                  className="rounded-md border border-border/60 bg-background p-3 text-sm"
                >
                  <div className="line-clamp-4 whitespace-pre-wrap text-muted-foreground">
                    {item.content}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
