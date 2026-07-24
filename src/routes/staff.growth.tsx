import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CalendarCheck,
  MailCheck,
  MousePointerClick,
  RefreshCw,
  Reply,
  ShieldAlert,
  Target,
  Users,
} from "lucide-react";

export const Route = createFileRoute("/staff/growth")({
  component: GrowthDashboard,
});

type CampaignPerformance = {
  id: string;
  lemlist_campaign_id: string;
  name: string;
  status: string;
  archived: boolean;
  purpose: string;
  segment: string | null;
  enrolled: number;
  replies: number;
  interested: number;
  meetings: number;
  bounces: number;
  unsubscribes: number;
};

type Recommendation = {
  id: string;
  recommendation_type: string;
  title: string;
  body: string;
  confidence: string | number;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
};

function rate(part: number, total: number) {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : "0%";
}

function GrowthDashboard() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [campaigns, setCampaigns] = useState<CampaignPerformance[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [actingId, setActingId] = useState("");

  async function load() {
    const [performanceResponse, recommendationsResponse] = await Promise.all([
      fetch("/api/crm/growth/campaign-performance"),
      fetch("/api/crm/growth/recommendations"),
    ]);
    const performance = await performanceResponse.json();
    const recs = await recommendationsResponse.json();
    if (!performanceResponse.ok) throw new Error(performance.error ?? "Growth dashboard failed");
    if (!recommendationsResponse.ok) throw new Error(recs.error ?? "Steve recommendations failed");
    setCampaigns(performance.campaigns ?? []);
    setRecommendations(recs.recommendations ?? []);
  }

  useEffect(() => {
    if (pathname !== "/staff/growth") return;
    load().catch((err) => setError(err instanceof Error ? err.message : "Growth dashboard failed"));
  }, [pathname]);

  if (pathname !== "/staff/growth") return <Outlet />;

  const totals = campaigns.reduce(
    (sum, campaign) => ({
      active: sum.active + (campaign.archived ? 0 : 1),
      enrolled: sum.enrolled + Number(campaign.enrolled ?? 0),
      replies: sum.replies + Number(campaign.replies ?? 0),
      interested: sum.interested + Number(campaign.interested ?? 0),
      meetings: sum.meetings + Number(campaign.meetings ?? 0),
      bounces: sum.bounces + Number(campaign.bounces ?? 0),
      unsubscribes: sum.unsubscribes + Number(campaign.unsubscribes ?? 0),
    }),
    { active: 0, enrolled: 0, replies: 0, interested: 0, meetings: 0, bounces: 0, unsubscribes: 0 },
  );

  async function syncCampaigns() {
    setSyncing(true);
    setError("");
    try {
      const response = await fetch("/api/integrations/lemlist/campaigns/sync", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Campaign sync failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Campaign sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function recommendationAction(id: string, action: "approve" | "dismiss") {
    setActingId(id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/crm/growth/recommendations/${id}/${action}`, {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok || body.ok === false)
        throw new Error(body.error ?? "Recommendation action failed");
      setNotice(
        body.execution?.ok === false
          ? `Recommendation approved, but enrollment was blocked: ${(body.execution.errors ?? []).join(", ")}`
          : action === "approve"
            ? "Recommendation approved."
            : "Recommendation dismissed.",
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recommendation action failed");
    } finally {
      setActingId("");
    }
  }

  const stats = [
    { label: "Visible Campaigns", value: totals.active, icon: Target },
    { label: "Prospects Contacted", value: totals.enrolled, icon: Users },
    { label: "Replies", value: totals.replies, icon: Reply },
    { label: "Interested", value: totals.interested, icon: MousePointerClick },
    { label: "Meetings", value: totals.meetings, icon: CalendarCheck },
    { label: "Bounce Rate", value: rate(totals.bounces, totals.enrolled), icon: ShieldAlert },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Growth Engine
          </div>
          <h1 className="text-2xl font-bold">Outbound Growth</h1>
          <p className="text-sm text-muted-foreground">
            CRM-approved enrollment, lemlist execution, campaign response handling, and Steve
            recommendations.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/staff/growth/segments"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            Segments
          </Link>
          <Link
            to="/staff/growth/campaigns"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            Campaigns
          </Link>
          <button
            onClick={() => void syncCampaigns()}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-md bg-brand-blue px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            Sync
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

      <section className="rounded-md border border-brand-blue/20 bg-brand-blue/5 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-brand-blue">
          <Bot className="h-4 w-4" />
          Steve Growth Intelligence
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {recommendations.slice(0, 3).map((rec) => (
            <article key={rec.id} className="rounded-md border border-border bg-white p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {rec.recommendation_type.replaceAll("_", " ")}
              </div>
              <div className="mt-1 text-sm font-semibold">{rec.title}</div>
              <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{rec.body}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={actingId === rec.id}
                  onClick={() => void recommendationAction(rec.id, "approve")}
                  className="rounded-md bg-brand-blue px-2 py-1 text-xs font-semibold text-white disabled:opacity-60"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={actingId === rec.id}
                  onClick={() => void recommendationAction(rec.id, "dismiss")}
                  className="rounded-md border border-border px-2 py-1 text-xs font-semibold hover:bg-surface-2 disabled:opacity-60"
                >
                  Dismiss
                </button>
              </div>
            </article>
          ))}
          {recommendations.length === 0 && (
            <div className="text-sm text-muted-foreground">No pending growth recommendations.</div>
          )}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-md border border-border/60 bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {stat.label}
              </div>
              <stat.icon className="h-4 w-4 text-brand-blue" />
            </div>
            <div className="mt-2 text-2xl font-bold">{stat.value}</div>
          </div>
        ))}
      </div>

      <section className="rounded-md border border-border/60 bg-surface">
        <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
          <MailCheck className="h-4 w-4 text-brand-orange" />
          <h2 className="text-sm font-semibold">Campaign Performance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Segment</th>
                <th className="px-4 py-3">Enrolled</th>
                <th className="px-4 py-3">Replies</th>
                <th className="px-4 py-3">Interested</th>
                <th className="px-4 py-3">Meetings</th>
                <th className="px-4 py-3">Suppression</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {campaigns.slice(0, 10).map((campaign) => (
                <tr key={campaign.id}>
                  <td className="px-4 py-3 font-medium">
                    <Link
                      to="/staff/growth/campaigns/$campaignId"
                      params={{ campaignId: campaign.id }}
                      className="hover:text-brand-orange"
                    >
                      {campaign.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 capitalize">{campaign.status}</td>
                  <td className="px-4 py-3">{campaign.segment ?? campaign.purpose}</td>
                  <td className="px-4 py-3">{campaign.enrolled}</td>
                  <td className="px-4 py-3">{campaign.replies}</td>
                  <td className="px-4 py-3">{campaign.interested}</td>
                  <td className="px-4 py-3">{campaign.meetings}</td>
                  <td className="px-4 py-3">
                    {campaign.bounces} bounce · {campaign.unsubscribes} unsub
                  </td>
                </tr>
              ))}
              {campaigns.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No lemlist campaigns synced yet.
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
