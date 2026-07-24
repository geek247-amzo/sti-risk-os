import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Banknote, Bot, CalendarDays, FileText } from "lucide-react";

export const Route = createFileRoute("/staff/billing")({
  component: Billing,
});

type Invoice = {
  id: string;
  invoice_number: string | null;
  status: "draft" | "sent" | "paid" | "overdue" | "void";
  currency: string;
  total_cents: number;
  issued_on: string | null;
  due_on: string | null;
  paid_at: string | null;
  organization_name: string | null;
  project_name: string | null;
  deal_title: string | null;
};

const statusClass: Record<Invoice["status"], string> = {
  draft: "bg-surface-2 text-muted-foreground",
  sent: "bg-brand-blue/15 text-brand-blue",
  paid: "bg-emerald-500/15 text-emerald-400",
  overdue: "bg-destructive/20 text-destructive",
  void: "bg-surface-2 text-muted-foreground",
};

function money(cents: number, currency = "ZAR") {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);
}

function Billing() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    const response = await fetch("/api/billing/invoices");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Billing failed to load");
    setInvoices(body.invoices);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Billing failed to load"));
  }, []);

  async function createInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/billing/invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to create invoice");
      event.currentTarget.reset();
      setShowNewInvoice(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create invoice");
    } finally {
      setCreating(false);
    }
  }

  const outstanding = invoices
    .filter((invoice) => invoice.status === "sent" || invoice.status === "overdue")
    .reduce((sum, invoice) => sum + invoice.total_cents, 0);
  const overdue = invoices.filter((invoice) => invoice.status === "overdue").length;
  const paid = invoices
    .filter((invoice) => invoice.status === "paid")
    .reduce((sum, invoice) => sum + invoice.total_cents, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Billing</div>
          <h1 className="text-2xl font-bold">Invoice Status</h1>
          <p className="text-sm text-muted-foreground">
            Draft, sent, paid, and overdue invoice tracking linked to projects, deals, and
            organizations.
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
            onClick={() => setShowNewInvoice((value) => !value)}
            className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
          >
            <FileText className="h-4 w-4" /> New Invoice
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      {showNewInvoice && (
        <form
          onSubmit={createInvoice}
          className="grid gap-3 rounded-lg border border-border/60 bg-surface p-4 md:grid-cols-[160px_140px_140px_minmax(180px,1fr)_auto]"
        >
          <input
            name="invoiceNumber"
            placeholder="Invoice no."
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          />
          <input
            name="total"
            type="number"
            min="0"
            step="0.01"
            required
            placeholder="Total"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          />
          <select
            name="status"
            defaultValue="draft"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          >
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
          </select>
          <input
            name="dueOn"
            type="date"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          />
          <button
            disabled={creating}
            className="inline-flex h-10 items-center justify-center rounded-md bg-brand-orange px-4 text-sm font-semibold text-primary-foreground disabled:opacity-70"
          >
            {creating ? "Creating" : "Create"}
          </button>
        </form>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border/60 bg-surface p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Outstanding</div>
          <div className="mt-2 text-2xl font-bold">{money(outstanding)}</div>
        </div>
        <div className="rounded-lg border border-border/60 bg-surface p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Overdue</div>
          <div className="mt-2 text-2xl font-bold">{overdue}</div>
        </div>
        <div className="rounded-lg border border-border/60 bg-surface p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Paid</div>
          <div className="mt-2 text-2xl font-bold">{money(paid)}</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border/60 bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Invoice</th>
              <th className="hidden px-4 py-3 lg:table-cell">Context</th>
              <th className="px-4 py-3">Status</th>
              <th className="hidden px-4 py-3 md:table-cell">Due</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {invoices.map((invoice) => (
              <tr key={invoice.id} className="transition hover:bg-surface-2/60">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="grid h-9 w-9 place-items-center rounded-md bg-brand-orange/15 text-brand-orange">
                      <Banknote className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-medium">
                        {invoice.invoice_number ?? invoice.id.slice(0, 8)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {invoice.organization_name ?? "Unassigned"}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="hidden px-4 py-3 lg:table-cell">
                  {invoice.project_name ?? invoice.deal_title ?? "No project"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass[invoice.status]}`}
                  >
                    {invoice.status}
                  </span>
                </td>
                <td className="hidden px-4 py-3 md:table-cell">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {invoice.due_on ? new Date(invoice.due_on).toLocaleDateString() : "Not set"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-semibold text-brand-orange">
                  {money(invoice.total_cents, invoice.currency)}
                </td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No invoices tracked yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
