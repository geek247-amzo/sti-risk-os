import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Bot, MailCheck } from "lucide-react";

export const Route = createFileRoute("/staff/growth/campaigns/$campaignId")({
  component: CampaignDetail,
});

type CampaignDetailData = {
  campaign: {
    id: string;
    lemlist_campaign_id: string;
    name: string;
    status: string;
    purpose: string;
    segment: string | null;
    enrolled_contacts: number;
    replies: number;
    interested: number;
    meetings: number;
    bounces: number;
    unsubscribes: number;
  };
  contacts: {
    id: string;
    email: string;
    status: string;
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
    deal_title: string | null;
    last_event_type: string | null;
    last_event_at: string | null;
    replied_at: string | null;
    interested_at: string | null;
    bounced_at: string | null;
    unsubscribed_at: string | null;
  }[];
  events: {
    id: string;
    event_type: string;
    status: string;
    lead_email: string | null;
    first_name: string | null;
    last_name: string | null;
    created_at: string;
    error: string | null;
  }[];
  recommendations: {
    id: string;
    recommendation_type: string;
    title: string;
    body: string;
  }[];
};

function CampaignDetail() {
  const { campaignId } = Route.useParams();
  const [data, setData] = useState<CampaignDetailData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    const response = await fetch(`/api/integrations/lemlist/campaigns/${campaignId}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Campaign failed to load");
    setData(body);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Campaign failed to load"));
  }, [campaignId]);

  async function postAction(url: string, body: Record<string, unknown>, success: string) {
    setBusy(url);
    setError("");
    setNotice("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error ?? "Action failed");
      setNotice(success);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy("");
    }
  }

  const campaign = data?.campaign;
  const stats = [
    ["Enrolled", campaign?.enrolled_contacts ?? 0],
    ["Replies", campaign?.replies ?? 0],
    ["Interested", campaign?.interested ?? 0],
    ["Meetings", campaign?.meetings ?? 0],
    ["Bounces", campaign?.bounces ?? 0],
    ["Unsubscribes", campaign?.unsubscribes ?? 0],
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/staff/growth/campaigns"
          className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-brand-orange"
        >
          <ArrowLeft className="h-4 w-4" /> Campaigns
        </Link>
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Growth Campaign
        </div>
        <h1 className="text-2xl font-bold">{campaign?.name ?? "Campaign"}</h1>
        <p className="text-sm text-muted-foreground">
          {campaign?.lemlist_campaign_id ?? campaignId} ·{" "}
          {campaign?.segment ?? campaign?.purpose ?? "growth"}
        </p>
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

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-md border border-border/60 bg-surface p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="mt-2 text-2xl font-bold">{value}</div>
          </div>
        ))}
      </div>

      <section className="rounded-md border border-brand-blue/20 bg-brand-blue/5 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-brand-blue">
          <Bot className="h-4 w-4" />
          Steve Summary
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {(data?.recommendations ?? []).map((rec) => (
            <article key={rec.id} className="rounded-md border border-border bg-white p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {rec.recommendation_type.replaceAll("_", " ")}
              </div>
              <div className="mt-1 text-sm font-semibold">{rec.title}</div>
              <p className="mt-2 text-sm text-muted-foreground">{rec.body}</p>
            </article>
          ))}
          {data && data.recommendations.length === 0 && (
            <div className="text-sm text-muted-foreground">
              No pending Steve recommendations for this campaign.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-md border border-border/60 bg-surface">
        <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
          <MailCheck className="h-4 w-4 text-brand-orange" />
          <h2 className="text-sm font-semibold">Enrolled Contacts</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last event</th>
                <th className="px-4 py-3">Reply</th>
                <th className="px-4 py-3">Suppression</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {(data?.contacts ?? []).map((contact) => (
                <tr key={contact.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {[contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
                        contact.email}
                    </div>
                    <div className="text-xs text-muted-foreground">{contact.email}</div>
                  </td>
                  <td className="px-4 py-3">{contact.organization_name ?? "Unassigned"}</td>
                  <td className="px-4 py-3 capitalize">{contact.status}</td>
                  <td className="px-4 py-3">
                    {contact.last_event_type ?? "None"}
                    {contact.last_event_at && (
                      <div className="text-xs text-muted-foreground">
                        {new Date(contact.last_event_at).toLocaleString()}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {contact.interested_at
                      ? "Interested"
                      : contact.replied_at
                        ? "Replied"
                        : "No reply"}
                  </td>
                  <td className="px-4 py-3">
                    {contact.unsubscribed_at
                      ? "Unsubscribed"
                      : contact.bounced_at
                        ? "Bounced"
                        : "Clear"}
                  </td>
                  <td className="px-4 py-3">
                    {(contact.interested_at || contact.replied_at) && !contact.deal_title ? (
                      <button
                        type="button"
                        disabled={busy !== ""}
                        onClick={() =>
                          void postAction(
                            `/api/crm/growth/replies/${contact.id}/create-deal`,
                            {},
                            "Deal created from campaign reply.",
                          )
                        }
                        className="rounded-md border border-border bg-white px-2 py-1 text-xs font-semibold hover:bg-surface-2 disabled:opacity-60"
                      >
                        Create deal
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {contact.deal_title ? "Deal linked" : "No action"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {data && data.contacts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No enrolled contacts.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-md border border-border/60 bg-surface">
        <div className="border-b border-border/60 px-5 py-4 text-sm font-semibold">
          Recent Events
        </div>
        <div className="divide-y divide-border/40">
          {(data?.events ?? []).slice(0, 20).map((event) => (
            <div
              key={event.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"
            >
              <div>
                <span className="font-medium">{event.event_type}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {event.lead_email ?? "unknown lead"} · {event.status}
                </span>
                {event.error && <div className="mt-1 text-xs text-destructive">{event.error}</div>}
              </div>
              <div className="flex items-center gap-3">
                {event.status === "failed" && (
                  <button
                    type="button"
                    disabled={busy !== ""}
                    onClick={() =>
                      void postAction(
                        "/api/integrations/lemlist/events/reprocess",
                        { eventIds: [event.id] },
                        "Event reprocessed.",
                      )
                    }
                    className="rounded-md border border-border bg-white px-2 py-1 text-xs font-semibold hover:bg-surface-2 disabled:opacity-60"
                  >
                    Reprocess
                  </button>
                )}
                <div className="text-xs text-muted-foreground">
                  {new Date(event.created_at).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
