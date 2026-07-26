import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, Bot, FileUp, PackageCheck, ReceiptText, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/staff/po-orders")({
  component: PosAndOrders,
});

type Quote = {
  id: string;
  quote_number: string;
  status: string;
  organization_name: string;
  site_name?: string;
  total_value_cents: number;
};

type ClientPo = {
  id: string;
  po_number: string | null;
  status: string;
  amount_cents: number;
  received_on: string;
  file_name: string | null;
  organization_name: string | null;
  site_name: string | null;
  quote_number: string | null;
  project_name: string | null;
  sales_order_status: string | null;
};

function money(cents: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);
}

function PosAndOrders() {
  const [pos, setPos] = useState<ClientPo[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [poFile, setPoFile] = useState<File | null>(null);
  const [showCapture, setShowCapture] = useState(false);

  async function load() {
    setError("");
    const response = await fetch("/api/pos");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "PO inbox failed to load");
    setPos(body.pos ?? []);
    setQuotes(body.quoteCandidates ?? []);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "PO queue failed"));
  }, []);

  async function capturePo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const quoteId = String(form.get("quoteId") ?? "");
    const selectedQuote = quotes.find((quote) => quote.id === quoteId);
    try {
      const response = await fetch("/api/pos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quoteId: quoteId || null,
          poNumber: form.get("poNumber"),
          amount: form.get("amount"),
          receivedOn: form.get("receivedOn"),
          fileName: poFile?.name ?? form.get("fileName"),
          status: quoteId ? "matched" : "unmatched",
          extractedPayload: selectedQuote
            ? { quoteNumber: selectedQuote.quote_number, client: selectedQuote.organization_name }
            : {},
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to capture PO");
      event.currentTarget.reset();
      setPoFile(null);
      setShowCapture(false);
      setNotice(
        body.salesOrderDraftId
          ? "PO captured and sales order draft created."
          : "PO captured in the inbox.",
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to capture PO");
    }
  }

  const queues = useMemo(
    () => ({
      waiting: quotes.filter((quote) => quote.status === "sent_to_client"),
      received: pos.filter((po) => po.status === "matched" || po.status === "unmatched"),
      drafts: quotes.filter((quote) => quote.status === "approved_internal"),
      salesOrders: pos.filter((po) => po.sales_order_status === "draft"),
    }),
    [pos, quotes],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Client PO to work order
          </div>
          <h1 className="text-2xl font-bold">POs & Orders</h1>
          <p className="text-sm text-muted-foreground">
            Capture client POs, match them to quotes, prepare sales orders, and trigger
            subcontractor work orders.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            data-guide="transaction-capture-po"
            onClick={() => setShowCapture((value) => !value)}
            className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
          >
            <FileUp className="h-4 w-4" /> Capture PO
          </button>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
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

      {showCapture && (
        <form
          data-guide="transaction-po-form"
          onSubmit={capturePo}
          className="grid gap-3 rounded-lg border border-border/60 bg-surface p-4 lg:grid-cols-[1fr_160px_160px_160px_auto]"
        >
          <select
            name="quoteId"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          >
            <option value="">Unmatched PO</option>
            {quotes.map((quote) => (
              <option key={quote.id} value={quote.id}>
                {quote.quote_number} · {quote.organization_name}
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
            name="receivedOn"
            type="date"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          />
          <button
            data-guide="transaction-save-po"
            className="h-10 rounded-md bg-brand-orange px-4 text-sm font-semibold text-primary-foreground"
          >
            Save
          </button>
        </form>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Waiting for client PO" value={queues.waiting.length} />
        <Metric label="PO received / order needed" value={queues.received.length} />
        <Metric label="Sales order drafts" value={queues.salesOrders.length} />
      </div>

      <div className="rounded-lg border border-dashed border-brand-orange/50 bg-brand-orange/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileUp className="h-4 w-4 text-brand-orange" /> PO upload inbox
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Drop a client PO here first. Matched captures auto-create a sales order draft;
              unmatched POs stay in the inbox until staff link a quote.
            </p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110">
            <FileUp className="h-4 w-4" />
            Choose PO
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              className="hidden"
              onChange={(event) => setPoFile(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        {poFile && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-white p-3 text-sm">
            <span>{poFile.name}</span>
            <Link
              to="/staff/steve"
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 hover:bg-surface"
            >
              <Bot className="h-4 w-4" /> Ask Steve to extract PO details
            </Link>
          </div>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Queue title="Waiting for PO" rows={queues.waiting} icon={PackageCheck} />
        <PoQueue title="Client POs received" rows={queues.received} icon={ReceiptText} />
        <Queue title="Ready for sales order" rows={queues.drafts} icon={PackageCheck} />
      </div>
    </div>
  );
}

function PoQueue({
  title,
  rows,
  icon: Icon,
}: {
  title: string;
  rows: ClientPo[];
  icon: typeof PackageCheck;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface p-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-brand-blue" />
        {title}
      </div>
      <div className="mt-4 divide-y divide-border/40">
        {rows.map((po) => (
          <div key={po.id} className="py-3 text-sm">
            <div className="font-medium">{po.po_number ?? po.file_name ?? "Unnumbered PO"}</div>
            <div className="mt-1 flex justify-between gap-3 text-xs text-muted-foreground">
              <span>{po.organization_name ?? "Unmatched client"}</span>
              <span>{money(po.amount_cents)}</span>
            </div>
            <div className="mt-1 text-xs capitalize text-muted-foreground">
              {po.status.replaceAll("_", " ")}
              {po.quote_number ? ` · ${po.quote_number}` : ""}
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="py-8 text-sm text-muted-foreground">No records in this queue.</div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border/60 bg-white p-5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
    </div>
  );
}

function Queue({
  title,
  rows,
  icon: Icon,
}: {
  title: string;
  rows: Quote[];
  icon: typeof PackageCheck;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface p-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-brand-blue" />
        {title}
      </div>
      <div className="mt-4 divide-y divide-border/40">
        {rows.map((quote) => (
          <div key={quote.id} className="py-3 text-sm">
            <div className="font-medium">{quote.quote_number}</div>
            <div className="mt-1 flex justify-between gap-3 text-xs text-muted-foreground">
              <span>{quote.organization_name}</span>
              <span>{money(quote.total_value_cents)}</span>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="py-8 text-sm text-muted-foreground">No records in this queue.</div>
        )}
      </div>
    </div>
  );
}
