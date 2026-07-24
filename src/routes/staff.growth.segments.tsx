import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, Building2, ClipboardList, FileText, Send, Users } from "lucide-react";

export const Route = createFileRoute("/staff/growth/segments")({
  component: GrowthSegments,
});

type Segment = {
  id: string;
  view_key: string;
  name: string;
  description: string;
  entity_type: string;
};

type QuoteFollowup = {
  id: string;
  contact_id: string | null;
  title: string;
  organization_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  owner_name: string | null;
  value_cents: number;
};

type DormantClient = {
  id: string;
  name: string;
  contact_id: string | null;
  email: string | null;
  contacts: number;
  owner_name: string | null;
  last_activity_at: string | null;
  last_contact_activity: string | null;
};

type PartnerProspect = {
  id: string;
  name: string;
  contact_id: string | null;
  email: string | null;
  contacts: number;
  account_type: string | null;
  owner_name: string | null;
};

type Campaign = { id: string; name: string; status: string };

function money(cents: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);
}

function GrowthSegments() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [quotes, setQuotes] = useState<QuoteFollowup[]>([]);
  const [dormant, setDormant] = useState<DormantClient[]>([]);
  const [partners, setPartners] = useState<PartnerProspect[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/crm/growth/segments").then((r) => r.json().then((body) => ({ ok: r.ok, body }))),
      fetch("/api/crm/growth/quote-followups").then((r) =>
        r.json().then((body) => ({ ok: r.ok, body })),
      ),
      fetch("/api/crm/growth/dormant-clients").then((r) =>
        r.json().then((body) => ({ ok: r.ok, body })),
      ),
      fetch("/api/crm/growth/partner-prospects").then((r) =>
        r.json().then((body) => ({ ok: r.ok, body })),
      ),
      fetch("/api/integrations/lemlist/campaigns").then((r) =>
        r.json().then((body) => ({ ok: r.ok, body })),
      ),
    ])
      .then(
        ([segmentResponse, quoteResponse, dormantResponse, partnerResponse, campaignResponse]) => {
          for (const response of [
            segmentResponse,
            quoteResponse,
            dormantResponse,
            partnerResponse,
          ]) {
            if (!response.ok) throw new Error(response.body.error ?? "Growth segment load failed");
          }
          setSegments(segmentResponse.body.segments ?? []);
          setQuotes(quoteResponse.body.quoteFollowups ?? []);
          setDormant(dormantResponse.body.dormantClients ?? []);
          setPartners(partnerResponse.body.partnerProspects ?? []);
          if (campaignResponse.ok) {
            setCampaigns(campaignResponse.body.campaigns ?? []);
            setCampaignId(campaignResponse.body.campaigns?.[0]?.id ?? "");
          }
        },
      )
      .catch((err) => setError(err instanceof Error ? err.message : "Growth segment load failed"));
  }, []);

  async function enroll(contactId: string | null) {
    if (!contactId) {
      setError("This row has no contact to enroll.");
      return;
    }
    if (!campaignId) {
      setError("Select a campaign before enrolling.");
      return;
    }
    setBusy(contactId);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/integrations/lemlist/leads/enroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId, campaignId }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok)
        throw new Error((body.errors ?? [body.error ?? "Enrollment blocked"]).join(", "));
      setNotice("Contact enrolled.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrollment failed");
    } finally {
      setBusy("");
    }
  }

  async function task(contactId: string | null, title: string) {
    if (!contactId) {
      setError("This row has no contact for task creation.");
      return;
    }
    setBusy(`task-${contactId}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/crm/contacts/${contactId}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, priority: "high" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Task creation failed");
      setNotice("Follow-up task created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Task creation failed");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Growth Engine
        </div>
        <h1 className="text-2xl font-bold">Segments</h1>
        <p className="text-sm text-muted-foreground">
          Saved CRM growth views for campaign enrollment review and follow-up work.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 bg-surface p-4">
        <span className="text-sm font-semibold">Campaign action</span>
        <select
          value={campaignId}
          onChange={(event) => setCampaignId(event.target.value)}
          className="h-10 min-w-64 rounded-md border border-border bg-white px-3 text-sm"
        >
          <option value="">Select campaign</option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.name}
            </option>
          ))}
        </select>
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

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {segments.map((segment) => (
          <div key={segment.id} className="rounded-md border border-border/60 bg-surface p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {segment.entity_type}
            </div>
            <div className="mt-1 text-sm font-semibold">{segment.name}</div>
            <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{segment.description}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="rounded-md border border-border/60 bg-surface">
          <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
            <FileText className="h-4 w-4 text-brand-orange" />
            <h2 className="text-sm font-semibold">Quote Follow-ups</h2>
          </div>
          <div className="divide-y divide-border/40">
            {quotes.slice(0, 8).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
              >
                <div>
                  <div className="font-medium">{item.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.organization_name ?? "Unassigned"} · {money(item.value_cents)} ·{" "}
                    {item.owner_name ?? "No owner"}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => void enroll(item.contact_id)}
                    disabled={busy !== ""}
                    className="grid h-8 w-8 place-items-center rounded-md border border-border bg-white hover:bg-surface-2"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => void task(item.contact_id, `Quote follow-up: ${item.title}`)}
                    disabled={busy !== ""}
                    className="grid h-8 w-8 place-items-center rounded-md border border-border bg-white hover:bg-surface-2"
                  >
                    <ClipboardList className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
            {quotes.length === 0 && (
              <div className="px-5 py-6 text-sm text-muted-foreground">
                No quote follow-ups found.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-md border border-border/60 bg-surface">
          <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
            <Building2 className="h-4 w-4 text-brand-orange" />
            <h2 className="text-sm font-semibold">Dormant Clients</h2>
          </div>
          <div className="divide-y divide-border/40">
            {dormant.slice(0, 8).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
              >
                <div>
                  <div className="font-medium">{item.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.contacts} contacts · {item.owner_name ?? "No owner"}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => void enroll(item.contact_id)}
                    disabled={busy !== ""}
                    className="grid h-8 w-8 place-items-center rounded-md border border-border bg-white hover:bg-surface-2"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() =>
                      void task(item.contact_id, `Dormant client follow-up: ${item.name}`)
                    }
                    disabled={busy !== ""}
                    className="grid h-8 w-8 place-items-center rounded-md border border-border bg-white hover:bg-surface-2"
                  >
                    <ClipboardList className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
            {dormant.length === 0 && (
              <div className="px-5 py-6 text-sm text-muted-foreground">
                No dormant clients found.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-md border border-border/60 bg-surface">
          <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
            <Users className="h-4 w-4 text-brand-orange" />
            <h2 className="text-sm font-semibold">Partner Prospects</h2>
          </div>
          <div className="divide-y divide-border/40">
            {partners.slice(0, 8).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
              >
                <div>
                  <div className="font-medium">{item.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.account_type ?? "Partner prospect"} · {item.contacts} contacts
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => void enroll(item.contact_id)}
                    disabled={busy !== ""}
                    className="grid h-8 w-8 place-items-center rounded-md border border-border bg-white hover:bg-surface-2"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() =>
                      void task(item.contact_id, `Partner prospect follow-up: ${item.name}`)
                    }
                    disabled={busy !== ""}
                    className="grid h-8 w-8 place-items-center rounded-md border border-border bg-white hover:bg-surface-2"
                  >
                    <ClipboardList className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
            {partners.length === 0 && (
              <div className="px-5 py-6 text-sm text-muted-foreground">
                No partner prospects found.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
