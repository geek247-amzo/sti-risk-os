import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  ClipboardList,
  PhoneCall,
  Send,
  ShieldCheck,
} from "lucide-react";

export const Route = createFileRoute("/staff/crm/contacts/$contactId")({
  component: ContactDetail,
});

type ContactDetailData = {
  contact: {
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
    role_title: string | null;
    status: string;
    lifecycle_stage: string;
    consent_status: string | null;
    consent_basis: string | null;
    do_not_contact: boolean;
    bounce_status: string | null;
    organization_name: string | null;
    owner_name: string | null;
  };
  deals: {
    id: string;
    title: string;
    value_cents: number;
    currency: string;
    stage_name: string | null;
    status: string;
  }[];
  campaigns: {
    id: string;
    campaign_name: string;
    status: string;
    last_event_type: string | null;
    last_event_at: string | null;
    replied_at: string | null;
    interested_at: string | null;
    deal_id: string | null;
  }[];
  suppressions: {
    id: string;
    suppression_type: string;
    value: string;
    reason: string;
    active: boolean;
  }[];
  tasks: { id: string; title: string; status: string; due_at: string | null; priority: string }[];
  communications: {
    id: string;
    direction: string;
    channel: string;
    subject: string | null;
    summary: string | null;
    created_at: string;
  }[];
  activities: {
    id: string;
    type: string;
    title: string;
    body: string | null;
    created_at: string;
  }[];
  recommendations: { id: string; recommendation_type: string; title: string; body: string }[];
  calls: {
    id: string;
    call_time: string | null;
    call_type: string | null;
    call_from: string | null;
    call_to: string | null;
    disposition: string | null;
    duration_seconds: number | null;
    recording_file: string | null;
    transcription_status: string;
    transcript: string | null;
    transcribed_at: string | null;
    tag_status: string;
    staff_name: string | null;
  }[];
};

type Campaign = { id: string; name: string; status: string };

function money(cents: number, currency = "ZAR") {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);
}

function ContactDetail() {
  const { contactId } = Route.useParams();
  const [data, setData] = useState<ContactDetailData | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/crm/contacts/${contactId}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Contact failed to load");
    setData(body);
  }, [contactId]);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Contact failed to load"));
    fetch("/api/integrations/lemlist/campaigns")
      .then((r) => r.json())
      .then((body) => {
        setCampaigns(body.campaigns ?? []);
        setCampaignId(body.campaigns?.[0]?.id ?? "");
      })
      .catch(() => undefined);
  }, [load]);

  async function postAction(url: string, options: RequestInit, success: string) {
    setBusy(url);
    setError("");
    setNotice("");
    try {
      const response = await fetch(url, options);
      const body = await response.json();
      if (!response.ok || body.ok === false)
        throw new Error((body.errors ?? [body.error ?? "Action failed"]).join(", "));
      setNotice(success);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy("");
    }
  }

  async function saveBasis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await postAction(
      `/api/crm/contacts/${contactId}/outreach-basis`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      },
      "Outreach basis recorded.",
    );
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await postAction(
      `/api/crm/contacts/${contactId}/tasks`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      },
      "Follow-up task created.",
    );
    formElement.reset();
  }

  const contact = data?.contact;
  const fullName = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ");
  const activeSuppression = (data?.suppressions ?? []).some((item) => item.active);

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/staff/crm/contacts"
          className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-brand-orange"
        >
          <ArrowLeft className="h-4 w-4" /> Contacts
        </Link>
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">CRM Contact</div>
        <h1 className="text-2xl font-bold">{fullName || contact?.email || "Contact"}</h1>
        <p className="text-sm text-muted-foreground">
          {contact?.organization_name ?? "Unassigned"} · {contact?.role_title ?? "Stakeholder"}
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

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-md border border-border/60 bg-surface p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Consent</div>
          <div className="mt-2 flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-4 w-4" />
            {contact?.consent_basis ?? "Review required"}
          </div>
        </div>
        <div className="rounded-md border border-border/60 bg-surface p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Suppression</div>
          <div className="mt-2 flex items-center gap-2 font-semibold">
            <Ban className="h-4 w-4" />
            {contact?.do_not_contact || activeSuppression ? "Blocked" : "Clear"}
          </div>
        </div>
        <div className="rounded-md border border-border/60 bg-surface p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Campaigns</div>
          <div className="mt-2 text-2xl font-bold">{data?.campaigns.length ?? 0}</div>
        </div>
        <div className="rounded-md border border-border/60 bg-surface p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Open Deals</div>
          <div className="mt-2 text-2xl font-bold">{data?.deals.length ?? 0}</div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <section className="rounded-md border border-border/60 bg-surface">
            <div className="border-b border-border/60 px-5 py-4 text-sm font-semibold">
              Campaign History
            </div>
            <div className="divide-y divide-border/40">
              {(data?.campaigns ?? []).map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"
                >
                  <div>
                    <div className="font-medium">{item.campaign_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.last_event_type ?? "No event"} · {item.status}
                    </div>
                  </div>
                  {item.deal_id && (
                    <Link
                      to="/staff/crm/deals/$dealId"
                      params={{ dealId: item.deal_id }}
                      className="text-brand-blue hover:text-brand-orange"
                    >
                      Deal
                    </Link>
                  )}
                </div>
              ))}
              {data && data.campaigns.length === 0 && (
                <div className="px-5 py-6 text-sm text-muted-foreground">No campaign history.</div>
              )}
            </div>
          </section>

          <section className="rounded-md border border-border/60 bg-surface">
            <div className="border-b border-border/60 px-5 py-4 text-sm font-semibold">Deals</div>
            <div className="divide-y divide-border/40">
              {(data?.deals ?? []).map((deal) => (
                <Link
                  key={deal.id}
                  to="/staff/crm/deals/$dealId"
                  params={{ dealId: deal.id }}
                  className="block px-5 py-3 text-sm hover:bg-surface-2"
                >
                  <div className="font-medium">{deal.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {deal.stage_name ?? "Unstaged"} · {money(deal.value_cents, deal.currency)}
                  </div>
                </Link>
              ))}
            </div>
          </section>

          <section className="rounded-md border border-border/60 bg-surface">
            <div className="border-b border-border/60 px-5 py-4 text-sm font-semibold">
              Timeline
            </div>
            <div className="divide-y divide-border/40">
              {[...(data?.communications ?? []), ...(data?.activities ?? [])]
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .slice(0, 30)
                .map((item) => (
                  <div
                    key={`${"channel" in item ? "comm" : "act"}-${item.id}`}
                    className="px-5 py-3 text-sm"
                  >
                    <div className="font-medium">
                      {"channel" in item ? `${item.channel} ${item.direction}` : item.title}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(item.created_at).toLocaleString()}
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {"summary" in item ? item.summary : item.body}
                    </p>
                  </div>
                ))}
            </div>
          </section>

          <section className="rounded-md border border-border/60 bg-surface">
            <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4 text-sm font-semibold">
              <PhoneCall className="h-4 w-4 text-brand-orange" /> Call history
            </div>
            <div className="divide-y divide-border/40">
              {(data?.calls ?? []).map((call) => (
                <div key={call.id} className="px-5 py-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">
                      {call.call_from ?? "Unknown"} → {call.call_to ?? "Unknown"}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {call.call_time ? new Date(call.call_time).toLocaleString() : "Unknown time"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {call.call_type ?? "Call"} · {call.disposition ?? "No disposition"}
                    {call.staff_name ? ` · ${call.staff_name}` : ""}
                    {call.duration_seconds ? ` · ${call.duration_seconds}s` : ""}
                  </div>
                  {call.transcript ? (
                    <details className="mt-3 rounded-md bg-muted/40 p-3">
                      <summary className="cursor-pointer text-xs font-medium">
                        Transcript ({call.transcription_status})
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                        {call.transcript}
                      </p>
                    </details>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Transcript {call.transcription_status}
                    </div>
                  )}
                </div>
              ))}
              {data && data.calls.length === 0 && (
                <div className="px-5 py-6 text-sm text-muted-foreground">
                  No linked call history.
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-md border border-border/60 bg-surface p-5">
            <h2 className="text-sm font-semibold">Add to Campaign</h2>
            <select
              value={campaignId}
              onChange={(event) => setCampaignId(event.target.value)}
              className="mt-3 h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
            >
              <option value="">Select campaign</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                postAction(
                  `/api/integrations/lemlist/leads/enroll`,
                  {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ contactId, campaignId }),
                  },
                  "Contact enrolled.",
                )
              }
              disabled={!campaignId || busy !== ""}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand-blue px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              <Send className="h-4 w-4" /> Enroll
            </button>
          </section>

          <form onSubmit={saveBasis} className="rounded-md border border-border/60 bg-surface p-5">
            <h2 className="text-sm font-semibold">Outreach Basis</h2>
            <select
              name="consentBasis"
              defaultValue={contact?.consent_basis ?? "legitimate_interest"}
              className="mt-3 h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
            >
              <option value="legitimate_interest">Legitimate interest</option>
              <option value="existing_customer">Existing customer</option>
              <option value="partner_relationship">Partner relationship</option>
              <option value="inbound_request">Inbound request</option>
              <option value="manual_review">Manual review</option>
            </select>
            <input
              name="note"
              placeholder="Optional note"
              className="mt-3 h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
            />
            <button className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm font-semibold hover:bg-surface-2">
              <CheckCircle2 className="h-4 w-4" /> Save basis
            </button>
          </form>

          <section className="rounded-md border border-border/60 bg-surface p-5">
            <h2 className="text-sm font-semibold">Suppressions</h2>
            <div className="mt-3 space-y-2">
              {(data?.suppressions ?? []).map((item) => (
                <div
                  key={item.id}
                  className="rounded-md border border-border/60 bg-white p-3 text-sm"
                >
                  <div className="font-medium">{item.reason}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.value} · {item.active ? "active" : "inactive"}
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() =>
                postAction(
                  `/api/crm/contacts/${contactId}/suppressions`,
                  {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ reason: "manual_block", suppressionType: "email" }),
                  },
                  "Manual suppression added.",
                )
              }
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-destructive/40 bg-white px-3 py-2 text-sm font-semibold text-destructive hover:bg-destructive/10"
            >
              <Ban className="h-4 w-4" /> Manual block
            </button>
          </section>

          <form onSubmit={createTask} className="rounded-md border border-border/60 bg-surface p-5">
            <h2 className="text-sm font-semibold">Follow-up Task</h2>
            <input
              name="title"
              required
              placeholder="Task title"
              className="mt-3 h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
            />
            <input
              name="description"
              placeholder="Optional description"
              className="mt-3 h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
            />
            <button className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-white">
              <ClipboardList className="h-4 w-4" /> Create task
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
}
