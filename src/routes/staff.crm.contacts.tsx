import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { StaffLeadCaptureModal } from "@/components/crm/StaffLeadCaptureModal";
import {
  Mail,
  Phone,
  Plus,
  Search,
  Filter,
  Star,
  MoreHorizontal,
  AlertTriangle,
  Ban,
  Send,
  ShieldCheck,
} from "lucide-react";

export const Route = createFileRoute("/staff/crm/contacts")({
  component: Contacts,
});

type Contact = {
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
  campaign_status: string | null;
  active_suppressions: number;
  organization_name: string | null;
  owner_name: string | null;
  deals: number;
  value_cents: number;
};

type Campaign = {
  id: string;
  name: string;
  status: string;
};

function statusClass(s: string) {
  switch (s) {
    case "Lead":
      return "bg-brand-blue/15 text-brand-blue";
    case "Proposal":
      return "bg-brand-orange/15 text-brand-orange";
    case "Negotiation":
      return "bg-amber-500/15 text-amber-300";
    case "Active":
      return "bg-emerald-500/15 text-emerald-400";
    default:
      return "bg-surface-2 text-muted-foreground";
  }
}

function money(cents: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Contacts() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [error, setError] = useState("");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState("");
  const [enrollingId, setEnrollingId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkEnrolling, setBulkEnrolling] = useState(false);
  const [notice, setNotice] = useState("");
  const [showAddLead, setShowAddLead] = useState(false);
  const [leadMode, setLeadMode] = useState<"manual" | "image">("manual");
  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [leadMessage, setLeadMessage] = useState("");

  const loadContacts = useCallback(async () => {
    const response = await fetch("/api/crm/contacts");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Contacts failed to load");
    setContacts(body.contacts);
  }, []);

  useEffect(() => {
    if (pathname !== "/staff/crm/contacts") return;
    Promise.all([
      loadContacts(),
      fetch("/api/integrations/lemlist/campaigns").then(async (response) => {
        const body = await response.json();
        if (response.ok) {
          setCampaigns(body.campaigns ?? []);
          setSelectedCampaign(body.campaigns?.[0]?.id ?? "");
        }
      }),
    ]).catch((err) => setError(err instanceof Error ? err.message : "Contacts failed to load"));
  }, [loadContacts, pathname]);

  const owners = useMemo(
    () =>
      Array.from(
        new Set(contacts.map((contact) => contact.owner_name).filter(Boolean)),
      ).sort() as string[],
    [contacts],
  );

  const statuses = useMemo(
    () => Array.from(new Set(contacts.map((contact) => contact.status).filter(Boolean))).sort(),
    [contacts],
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return contacts.filter(
      (c) =>
        (ownerFilter === "all" || c.owner_name === ownerFilter) &&
        (statusFilter === "all" || c.status === statusFilter) &&
        (!q ||
          [
            c.first_name,
            c.last_name,
            c.email,
            c.phone,
            c.organization_name,
            c.role_title,
            c.owner_name,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q)),
    );
  }, [contacts, ownerFilter, query, statusFilter]);

  async function enroll(contactId: string) {
    if (!selectedCampaign) {
      setNotice("Select a campaign before enrolling a contact.");
      return;
    }
    setEnrollingId(contactId);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/integrations/lemlist/leads/enroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId, campaignId: selectedCampaign }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        throw new Error((body.errors ?? [body.error ?? "Enrollment blocked"]).join(", "));
      }
      setNotice("Contact enrolled.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrollment failed");
    } finally {
      setEnrollingId("");
    }
  }

  async function bulkEnroll() {
    if (!selectedCampaign) {
      setNotice("Select a campaign before enrolling contacts.");
      return;
    }
    if (selectedIds.length === 0) {
      setNotice("Select at least one contact.");
      return;
    }
    if (selectedIds.length > 25) {
      setError("Bulk enrollment is limited to 25 contacts.");
      return;
    }
    setBulkEnrolling(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/integrations/lemlist/leads/bulk-enroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactIds: selectedIds, campaignId: selectedCampaign }),
      });
      const body = await response.json();
      const failures = (body.results ?? []).filter((item: { ok: boolean }) => !item.ok);
      if (!response.ok && !body.results) throw new Error(body.error ?? "Bulk enrollment failed");
      setNotice(
        failures.length
          ? `Bulk enrollment completed with ${failures.length} blocked contact(s). ${failures
              .slice(0, 3)
              .map((item: { errors?: string[] }) => item.errors?.join(", "))
              .filter(Boolean)
              .join(" · ")}`
          : `Enrolled ${selectedIds.length} contact(s).`,
      );
      setSelectedIds([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk enrollment failed");
    } finally {
      setBulkEnrolling(false);
    }
  }

  async function submitManualLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = Object.fromEntries(form.entries());
    const email = typeof payload.email === "string" ? payload.email.trim() : "";
    const phone = typeof payload.phone === "string" ? payload.phone.trim() : "";
    if (!email && !phone) {
      setLeadMessage("Enter an email address or phone number.");
      return;
    }

    setLeadSubmitting(true);
    setLeadMessage("");
    setError("");
    try {
      const response = await fetch("/api/crm/contacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Lead capture failed");
      await loadContacts();
      formElement.reset();
      setShowAddLead(false);
      setNotice("Lead captured in CRM.");
    } catch (err) {
      setLeadMessage(err instanceof Error ? err.message : "Lead capture failed");
    } finally {
      setLeadSubmitting(false);
    }
  }

  async function submitImageLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (!(form.get("image") instanceof File)) {
      setLeadMessage("Choose an image to process.");
      return;
    }

    setLeadSubmitting(true);
    setLeadMessage("");
    setError("");
    try {
      const response = await fetch("/api/crm/contacts/image-intake", {
        method: "POST",
        body: form,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Image intake failed");
      await loadContacts();
      formElement.reset();
      setShowAddLead(false);
      setNotice("Image processed by n8n and lead captured in CRM.");
    } catch (err) {
      setLeadMessage(err instanceof Error ? err.message : "Image intake failed");
    } finally {
      setLeadSubmitting(false);
    }
  }

  if (pathname !== "/staff/crm/contacts") return <Outlet />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">CRM</div>
          <h1 className="text-2xl font-bold">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            Contacts created through public intake, n8n, Gemini agent support, and staff CRM
            workflows.
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={selectedCampaign}
            onChange={(event) => setSelectedCampaign(event.target.value)}
            className="hidden h-10 min-w-48 rounded-md border border-border bg-surface px-3 text-sm outline-none focus:border-brand-orange md:block"
          >
            <option value="">Select campaign</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => void bulkEnroll()}
            disabled={
              bulkEnrolling ||
              selectedIds.length === 0 ||
              selectedIds.length > 25 ||
              !selectedCampaign
            }
            className="inline-flex items-center gap-2 rounded-md bg-brand-blue px-3 py-2 text-sm font-semibold text-white hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Send className="h-4 w-4" />{" "}
            {bulkEnrolling ? "Enrolling..." : `Enroll ${selectedIds.length || ""}`}
          </button>
          <button
            onClick={() => setShowFilters((value) => !value)}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            <Filter className="h-4 w-4" /> Filter
          </button>
          <button
            type="button"
            onClick={() => {
              setLeadMode("manual");
              setLeadMessage("");
              setShowAddLead(true);
            }}
            className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
          >
            <Plus className="h-4 w-4" /> Add Lead
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

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search contacts..."
          className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:border-brand-orange focus:outline-none"
        />
      </div>

      {showFilters && (
        <div className="grid gap-3 rounded-lg border border-border/60 bg-surface p-4 md:grid-cols-[220px_220px_auto]">
          <select
            value={ownerFilter}
            onChange={(event) => setOwnerFilter(event.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          >
            <option value="all">All owners</option>
            {owners.map((owner) => (
              <option key={owner} value={owner}>
                {owner}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          >
            <option value="all">All statuses</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              setOwnerFilter("all");
              setStatusFilter("all");
            }}
            className="h-10 rounded-md border border-border px-3 text-sm hover:bg-surface-2"
          >
            Clear
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border/60 bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="w-8 px-4 py-3"></th>
              <th className="w-8 px-4 py-3">
                <input
                  type="checkbox"
                  checked={
                    filtered.length > 0 &&
                    filtered.slice(0, 25).every((item) => selectedIds.includes(item.id))
                  }
                  onChange={(event) =>
                    setSelectedIds(
                      event.target.checked ? filtered.slice(0, 25).map((item) => item.id) : [],
                    )
                  }
                />
              </th>
              <th className="px-4 py-3">Contact</th>
              <th className="hidden px-4 py-3 lg:table-cell">Company</th>
              <th className="hidden px-4 py-3 xl:table-cell">Contact info</th>
              <th className="px-4 py-3">Status</th>
              <th className="hidden px-4 py-3 lg:table-cell">Outreach</th>
              <th className="hidden px-4 py-3 md:table-cell">Open value</th>
              <th className="px-4 py-3">Owner</th>
              <th className="w-8 px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {filtered.map((c, index) => {
              const name = `${c.first_name} ${c.last_name}`.trim();
              return (
                <tr key={c.id} className="transition hover:bg-surface-2/60">
                  <td className="px-4 py-3">
                    <Star
                      className={`h-4 w-4 ${index < 3 ? "fill-brand-orange text-brand-orange" : "text-muted-foreground"}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(c.id)}
                      onChange={(event) =>
                        setSelectedIds((current) =>
                          event.target.checked
                            ? Array.from(new Set([...current, c.id])).slice(0, 25)
                            : current.filter((id) => id !== c.id),
                        )
                      }
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-orange/15 text-xs font-semibold text-brand-orange">
                        {initials(name)}
                      </div>
                      <div className="min-w-0">
                        <Link
                          to="/staff/crm/contacts/$contactId"
                          params={{ contactId: c.id }}
                          className="font-medium hover:text-brand-orange"
                        >
                          {name || c.email || "Unnamed contact"}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {c.role_title ?? "Stakeholder"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 lg:table-cell">
                    {c.organization_name ?? "Unassigned"}
                  </td>
                  <td className="hidden px-4 py-3 xl:table-cell">
                    <div className="flex flex-col gap-0.5 text-xs">
                      {c.email && (
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Mail className="h-3 w-3" /> {c.email}
                        </span>
                      )}
                      {c.phone && (
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Phone className="h-3 w-3" /> {c.phone}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span
                        className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(c.status)}`}
                      >
                        {c.status}
                      </span>
                      {c.campaign_status && (
                        <span className="w-fit rounded-full bg-brand-blue/10 px-2 py-0.5 text-[10px] font-medium text-brand-blue">
                          {c.campaign_status}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 lg:table-cell">
                    <div className="flex flex-wrap gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${c.consent_status ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"}`}
                      >
                        <ShieldCheck className="h-3 w-3" />
                        {c.consent_status ?? "Review consent"}
                      </span>
                      {(c.do_not_contact || c.active_suppressions > 0 || c.bounce_status) && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
                          <Ban className="h-3 w-3" />
                          Suppressed
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 font-semibold text-brand-orange md:table-cell">
                    {money(c.value_cents)}
                    <div className="text-xs font-normal text-muted-foreground">
                      {c.deals} deal{c.deals === 1 ? "" : "s"}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="grid h-7 w-7 place-items-center rounded-full bg-brand-blue/20 text-[10px] font-semibold text-brand-blue">
                      {initials(c.owner_name ?? "ST")}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => void enroll(c.id)}
                      disabled={enrollingId === c.id || !selectedCampaign}
                      className="grid h-8 w-8 place-items-center rounded-md border border-border bg-white text-muted-foreground hover:bg-surface-2 hover:text-brand-orange disabled:cursor-not-allowed disabled:opacity-50"
                      title="Add to campaign"
                    >
                      {enrollingId === c.id ? (
                        <MoreHorizontal className="h-4 w-4" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No contacts found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showAddLead && (
        <StaffLeadCaptureModal
          mode={leadMode}
          setMode={setLeadMode}
          submitting={leadSubmitting}
          message={leadMessage}
          onClose={() => {
            if (leadSubmitting) return;
            setShowAddLead(false);
            setLeadMessage("");
          }}
          onManualSubmit={submitManualLead}
          onImageSubmit={submitImageLead}
        />
      )}
    </div>
  );
}
