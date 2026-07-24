import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/staff/growth/campaigns")({
  component: GrowthCampaigns,
});

type Campaign = {
  id: string;
  lemlist_campaign_id: string;
  name: string;
  status: string;
  purpose: string;
  segment: string | null;
  enrolled_contacts: number;
  active_contacts: number;
  replies: number;
  interested: number;
  last_synced_at: string | null;
};

function GrowthCampaigns() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);

  async function load() {
    const response = await fetch("/api/integrations/lemlist/campaigns");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Campaigns failed to load");
    setCampaigns(body.campaigns ?? []);
  }

  useEffect(() => {
    if (pathname !== "/staff/growth/campaigns") return;
    load().catch((err) =>
      setError(err instanceof Error ? err.message : "Campaigns failed to load"),
    );
  }, [pathname]);

  async function sync() {
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

  if (pathname !== "/staff/growth/campaigns") return <Outlet />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Growth Engine
          </div>
          <h1 className="text-2xl font-bold">Campaigns</h1>
          <p className="text-sm text-muted-foreground">
            Synced lemlist campaigns mapped to CRM enrollment and events.
          </p>
        </div>
        <button
          onClick={() => void sync()}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-md bg-brand-blue px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          Sync campaigns
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border/60 bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Campaign</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Segment</th>
              <th className="px-4 py-3">Active</th>
              <th className="px-4 py-3">Replies</th>
              <th className="px-4 py-3">Interested</th>
              <th className="px-4 py-3">Last sync</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {campaigns.map((campaign) => (
              <tr key={campaign.id} className="hover:bg-surface-2/60">
                <td className="px-4 py-3">
                  <Link
                    to="/staff/growth/campaigns/$campaignId"
                    params={{ campaignId: campaign.id }}
                    className="font-medium hover:text-brand-orange"
                  >
                    {campaign.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {campaign.lemlist_campaign_id}
                  </div>
                </td>
                <td className="px-4 py-3 capitalize">{campaign.status}</td>
                <td className="px-4 py-3">{campaign.segment ?? campaign.purpose}</td>
                <td className="px-4 py-3">{campaign.active_contacts}</td>
                <td className="px-4 py-3">{campaign.replies}</td>
                <td className="px-4 py-3">{campaign.interested}</td>
                <td className="px-4 py-3">
                  {campaign.last_synced_at
                    ? new Date(campaign.last_synced_at).toLocaleString()
                    : "Not synced"}
                </td>
              </tr>
            ))}
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No campaigns synced.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
