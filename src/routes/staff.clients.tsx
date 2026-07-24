import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Building2,
  FileSignature,
  FolderKanban,
  Loader2,
  Plus,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import type { FormEvent, ReactNode } from "react";

export const Route = createFileRoute("/staff/clients")({
  component: Clients,
});

type Contact = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  organization_name: string | null;
  owner_name: string | null;
  deals: number;
  value_cents: number;
};

type Quote = {
  id: string;
  quote_number: string;
  status: string;
  organization_name: string;
  total_value_cents: number;
};

type Project = {
  id: string;
  name: string;
  status: string;
  organization_name: string | null;
};

type Invoice = {
  id: string;
  status: string;
  total_cents: number;
  organization_name: string | null;
};

type ClientSummary = {
  id: string;
  name: string;
  contacts: number;
  sites: number;
  buildings: number;
  assets: number;
  projects: number;
  work_items: number;
  quotes: number;
  client_pos: number;
  reports: number;
  invoices: number;
  evidence: number;
  risks: number;
  quoted_value_cents: number;
  invoice_value_cents: number;
};

type Report = {
  id: string;
  title: string;
  report_type: string;
  status: string;
  created_at: string;
  signoff_link_id: string | null;
  signoff_link_status: string | null;
  signoff_expires_at: string | null;
  signoff_signed_at: string | null;
  signoff_signer_name: string | null;
  signoff_signer_role: string | null;
};

function money(cents: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);
}

function Clients() {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [clientDetail, setClientDetail] = useState<{
    client: {
      id: string;
      name: string;
      relationship_type: "strategic" | "collaborative" | "end_user";
    };
    contacts: Contact[];
    quotes: Quote[];
    projects: Project[];
    invoices: Invoice[];
    reports: Report[];
  } | null>(null);
  const [query, setQuery] = useState("");
  const [selectedClient, setSelectedClient] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sendingReportId, setSendingReportId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [savingRelationship, setSavingRelationship] = useState(false);

  async function loadClients(selectId?: string) {
    const response = await fetch("/api/clients");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Clients failed to load");
    setClients(body.clients ?? []);
    if (selectId) setSelectedClient(selectId);
  }

  useEffect(() => {
    loadClients().catch((err) => setError(err instanceof Error ? err.message : "Clients failed"));
  }, []);

  const orderedClients = useMemo(
    () =>
      [...clients].sort(
        (a, b) =>
          Number(b.quoted_value_cents ?? 0) - Number(a.quoted_value_cents ?? 0) ||
          a.name.localeCompare(b.name),
      ),
    [clients],
  );

  const filteredClients = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orderedClients.filter((client) => !q || client.name.toLowerCase().includes(q));
  }, [orderedClients, query]);

  const selected = selectedClient
    ? orderedClients.find((client) => client.id === selectedClient)
    : filteredClients[0];

  useEffect(() => {
    async function loadDetail() {
      if (!selected?.id) {
        setClientDetail(null);
        return;
      }
      const response = await fetch(`/api/clients/${encodeURIComponent(selected.id)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Client folder failed to load");
      setClientDetail(body);
      setSelectedClient(selected.id);
    }

    loadDetail().catch((err) => setError(err instanceof Error ? err.message : "Client folder failed"));
  }, [selected?.id]);

  const name = clientDetail?.client.name ?? selected?.name ?? "Client folder";
  const clientQuotes = clientDetail?.quotes ?? [];
  const clientProjects = clientDetail?.projects ?? [];
  const clientInvoices = clientDetail?.invoices ?? [];
  const clientReports = clientDetail?.reports ?? [];

  async function sendSignoffLink(report: Report) {
    setNotice("");
    setError("");
    setSendingReportId(report.id);
    try {
      const response = await fetch("/api/client-signoff-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetType: "service_report",
          targetId: report.id,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to create sign-off link");
      setNotice("Sign-off link queued for approval.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create sign-off link");
    } finally {
      setSendingReportId(null);
    }
  }

  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      const responseText = await response.text();
      let body: { error?: string; customer?: { id: string; name: string } } = {};
      try {
        body = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error(
          response.ok
            ? "Customer was created, but the server returned an unreadable response"
            : "The server could not create the customer. Please try again.",
        );
      }
      if (!response.ok) throw new Error(body.error ?? "Unable to create customer");
      if (!body.customer) throw new Error("Customer creation did not return a customer record");
      await loadClients(body.customer.id);
      setCreateOpen(false);
      setNotice(`${body.customer.name} was created and is ready for work.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create customer");
    } finally {
      setCreating(false);
    }
  }

  async function updateRelationshipType(
    relationshipType: "strategic" | "collaborative" | "end_user",
  ) {
    if (!clientDetail?.client.id) return;
    const previous = clientDetail.client.relationship_type;
    setSavingRelationship(true);
    setError("");
    setClientDetail((current) =>
      current ? { ...current, client: { ...current.client, relationship_type: relationshipType } } : current,
    );
    try {
      const response = await fetch(`/api/clients/${clientDetail.client.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ relationshipType }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to update relationship type");
      setNotice("Client relationship type updated.");
    } catch (err) {
      setClientDetail((current) =>
        current ? { ...current, client: { ...current.client, relationship_type: previous } } : current,
      );
      setError(err instanceof Error ? err.message : "Unable to update relationship type");
    } finally {
      setSavingRelationship(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Master folders
          </div>
          <h1 className="text-2xl font-bold">Clients</h1>
          <p className="text-sm text-muted-foreground">
            Search Agape, Mastec, Edcock, or any account and see the linked operating history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/staff/steve"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            <Bot className="h-4 w-4" /> Search with Steve
          </Link>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 rounded-md bg-brand-blue px-3 py-2 text-sm font-semibold text-white hover:brightness-105"
          >
            <Plus className="h-4 w-4" /> New customer
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
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-border/60 bg-surface p-4">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search client or contact..."
              className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-brand-orange"
            />
          </label>
          <div className="mt-4 max-h-[58vh] divide-y divide-border/40 overflow-y-auto">
            {filteredClients.map((client) => (
              <button
                key={client.id}
                onClick={() => setSelectedClient(client.id)}
                className={`w-full px-3 py-3 text-left text-sm hover:bg-surface-2 ${
                  selected?.id === client.id ? "bg-brand-blue/10" : ""
                }`}
              >
                <div className="font-medium">{client.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {client.contacts} contact(s) · {money(client.quoted_value_cents ?? 0)}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="space-y-5">
          <div className="rounded-lg border border-border/60 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  <Building2 className="h-4 w-4" /> Client folder
                </div>
                <h2 className="mt-2 text-xl font-bold">{name}</h2>
                {clientDetail?.client && (
                  <label className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <span>Relationship</span>
                    <select
                      value={clientDetail.client.relationship_type ?? "end_user"}
                      disabled={savingRelationship}
                      onChange={(event) =>
                        void updateRelationshipType(
                          event.target.value as "strategic" | "collaborative" | "end_user",
                        )
                      }
                      className="h-9 rounded-md border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-800 outline-none focus:border-brand-blue disabled:opacity-60"
                    >
                      <option value="end_user">End user</option>
                      <option value="strategic">Strategic</option>
                      <option value="collaborative">Collaborative</option>
                    </select>
                    {savingRelationship && <Loader2 className="h-4 w-4 animate-spin" />}
                  </label>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3 text-right text-sm">
                <FolderStat label="Work" value={clientProjects.length} />
                <FolderStat label="Quotes" value={clientQuotes.length} />
                <FolderStat label="Finance" value={money(clientInvoices.reduce((s, i) => s + i.total_cents, 0))} />
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <FolderPanel title="Contacts" icon={Building2}>
              {clientDetail?.contacts.map((contact) => (
                <div key={contact.id} className="py-3 text-sm">
                  <div className="font-medium">
                    {contact.first_name} {contact.last_name}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {[contact.email, contact.phone, contact.owner_name].filter(Boolean).join(" · ")}
                  </div>
                </div>
              ))}
            </FolderPanel>

            <FolderPanel title="Work" icon={FolderKanban}>
              {clientProjects.map((project) => (
                <div key={project.id} className="py-3 text-sm">
                  <div className="font-medium">{project.name}</div>
                  <div className="mt-1 text-xs capitalize text-muted-foreground">{project.status}</div>
                </div>
              ))}
            </FolderPanel>

            <FolderPanel title="Quotes / POs" icon={FileSignature}>
              {clientQuotes.map((quote) => (
                <div key={quote.id} className="flex justify-between gap-3 py-3 text-sm">
                  <div>
                    <div className="font-medium">{quote.quote_number}</div>
                    <div className="mt-1 text-xs capitalize text-muted-foreground">
                      {quote.status.replaceAll("_", " ")}
                    </div>
                  </div>
                  <div className="font-semibold">{money(quote.total_value_cents)}</div>
                </div>
              ))}
            </FolderPanel>

            <FolderPanel title="Reports / Evidence / Steve history" icon={Bot}>
              {clientReports.map((report) => (
                <div key={report.id} className="py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{report.title}</div>
                      <div className="mt-1 text-xs capitalize text-muted-foreground">
                        {report.report_type.replaceAll("_", " ")} · {report.status.replaceAll("_", " ")}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {report.signoff_signed_at
                          ? `Signed ${new Date(report.signoff_signed_at).toLocaleString()} by ${report.signoff_signer_name ?? "client"}`
                          : report.signoff_link_status === "active"
                            ? "Awaiting client sign-off"
                            : "No sign-off link issued"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void sendSignoffLink(report)}
                      disabled={sendingReportId === report.id}
                      className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-surface-2 disabled:opacity-60"
                    >
                      {sendingReportId === report.id ? "Sending" : "Send sign-off link"}
                    </button>
                  </div>
                </div>
              ))}
              <div className="py-3 text-sm text-muted-foreground">
                Signed reports feed the client sign-off gate and stay visible on the client record.
              </div>
              <Link
                to="/staff/steve"
                className="mt-2 inline-flex items-center gap-2 rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground"
              >
                <Bot className="h-4 w-4" /> Summarise this client
              </Link>
            </FolderPanel>
          </div>
        </section>
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="new-customer-title">
          <button type="button" className="absolute inset-0" aria-label="Close customer form" onClick={() => !creating && setCreateOpen(false)} />
          <form onSubmit={(event) => void createCustomer(event)} className="staff-panel relative z-10 w-full max-w-2xl overflow-hidden rounded-md border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4 sm:px-6">
              <div>
                <h2 id="new-customer-title" className="text-lg font-semibold text-slate-900">Create customer</h2>
                <p className="mt-1 text-sm text-slate-500">Add the account now. Primary contact details are optional.</p>
              </div>
              <button type="button" disabled={creating} onClick={() => setCreateOpen(false)} className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-5 p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Customer name" name="name" required placeholder="e.g. GeekBox" />
                <Field label="Industry" name="industry" placeholder="e.g. Manufacturing" />
                <Field label="Website" name="website" type="url" placeholder="https://example.co.za" className="sm:col-span-2" />
                <label className="block space-y-1.5 text-sm sm:col-span-2">
                  <span className="font-medium text-slate-700">Relationship type</span>
                  <select name="relationshipType" defaultValue="end_user" className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-slate-900 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/10">
                    <option value="end_user">End user</option>
                    <option value="strategic">Strategic</option>
                    <option value="collaborative">Collaborative</option>
                  </select>
                </label>
              </div>
              <div className="border-t border-slate-200 pt-5">
                <div className="mb-3 text-xs font-semibold uppercase text-slate-500">Primary contact</div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="First name" name="contactFirstName" />
                  <Field label="Last name" name="contactLastName" />
                  <Field label="Email" name="contactEmail" type="email" />
                  <Field label="Phone" name="contactPhone" type="tel" />
                  <Field label="Role" name="contactRole" placeholder="e.g. Facilities Manager" className="sm:col-span-2" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
              <button type="button" disabled={creating} onClick={() => setCreateOpen(false)} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={creating} className="inline-flex min-w-32 items-center justify-center gap-2 rounded-md bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:brightness-105 disabled:opacity-60">
                {creating && <Loader2 className="h-4 w-4 animate-spin" />}{creating ? "Creating" : "Create customer"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, className = "", ...props }: { label: string; className?: string; name: string; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <label className={`block space-y-1.5 text-sm ${className}`}>
      <span className="font-medium text-slate-700">{label}{props.required && <span className="ml-1 text-red-500">*</span>}</span>
      <input {...props} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-slate-900 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/10" />
    </label>
  );
}

function FolderStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-bold">{value}</div>
    </div>
  );
}

function FolderPanel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface p-5">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-brand-blue" />
        {title}
      </div>
      <div className="divide-y divide-border/40">{children}</div>
    </div>
  );
}
