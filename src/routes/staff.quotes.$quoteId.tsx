import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  FileDown,
  FileSignature,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Save,
  Trash2,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

export const Route = createFileRoute("/staff/quotes/$quoteId")({
  component: QuoteDetail,
});

type Quote = {
  id: string;
  quote_number: string;
  status: string;
  currency: string;
  subtotal_cents: number;
  total_cost_cents: number;
  total_value_cents: number;
  margin_cents: number;
  margin_percent: string | number;
  valid_until: string | null;
  client_reference: string | null;
  notes: string | null;
  organization_name: string;
  site_name: string;
  site_address: string | null;
  created_by_name: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
};

type Line = {
  id: string;
  line_type: string | null;
  part_id: string | null;
  part_code: string | null;
  description: string;
  quantity: string | number;
  unit_cost_cents: number;
  unit_price_cents: number;
  total_price_cents: number;
  manufacturer: string | null;
  system_family: string | null;
};

type SupportPart = {
  id: string;
  part_code: string;
  description: string;
  default_unit_cost_cents: number;
  default_unit_price_cents: number;
};

type EditableLine = {
  lineType: "technology" | "labor_travel_accommodation" | "sla";
  partId: string;
  partCode: string;
  description: string;
  quantity: string;
  unitCost: string;
  unitPrice: string;
};

const blankLine: EditableLine = {
  lineType: "technology",
  partId: "",
  partCode: "",
  description: "",
  quantity: "1",
  unitCost: "",
  unitPrice: "",
};

type Validation = {
  id: string;
  status: "green" | "amber" | "red";
  summary: string;
  evidence: unknown[];
  implicated_line_item_ids: string[];
  actor_name: string | null;
  created_at: string;
};

type AuditEvent = {
  action: string;
  actor_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type SiteAsset = {
  id: string;
  asset_type: string;
  manufacturer: string | null;
  model: string | null;
  system_family: string | null;
  notes: string | null;
};

const nextActions: Record<string, { status: string; label: string }[]> = {
  draft: [{ status: "pending_technical_review", label: "Send to Technical Review" }],
  pending_technical_review: [
    { status: "draft", label: "Return to Draft" },
    { status: "approved_internal", label: "Approve Internally" },
    { status: "rejected", label: "Reject" },
  ],
  approved_internal: [
    { status: "sent_to_client", label: "Mark Sent to Client" },
    { status: "rejected", label: "Reject" },
  ],
  sent_to_client: [
    { status: "accepted", label: "Mark Accepted" },
    { status: "rejected", label: "Mark Rejected" },
  ],
  accepted: [],
  rejected: [{ status: "draft", label: "Reopen Draft" }],
};

function money(cents: number, currency = "ZAR") {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format((cents ?? 0) / 100);
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function centsToRand(cents: number) {
  return cents ? String(Math.round(cents) / 100) : "";
}

function validationStyles(status?: string) {
  if (status === "green") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "red") return "border-rose-200 bg-rose-50 text-rose-800";
  if (status === "amber") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-border bg-surface text-muted-foreground";
}

function QuoteDetail() {
  const { quoteId } = useParams({ from: "/staff/quotes/$quoteId" });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [validations, setValidations] = useState<Validation[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [siteAssets, setSiteAssets] = useState<SiteAsset[]>([]);
  const [parts, setParts] = useState<SupportPart[]>([]);
  const [editing, setEditing] = useState(false);
  const [draftLines, setDraftLines] = useState<EditableLine[]>([{ ...blankLine }]);
  const [savingLines, setSavingLines] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [signoffUrl, setSignoffUrl] = useState("");
  const [signoffApprovalRequestId, setSignoffApprovalRequestId] = useState("");
  const [signoffChannel, setSignoffChannel] = useState("");

  function toDraftLine(line: Line): EditableLine {
    const isTechnology = line.line_type === "technology" || Boolean(line.part_id || line.part_code);
    return {
      lineType: (line.line_type as EditableLine["lineType"]) ?? (isTechnology ? "technology" : "labor_travel_accommodation"),
      partId: line.part_id ?? "",
      partCode: line.part_code ?? "",
      description: line.description ?? "",
      quantity: String(line.quantity ?? "1"),
      unitCost: String(Math.round((line.unit_cost_cents ?? 0) / 100)),
      unitPrice: String(Math.round((line.unit_price_cents ?? 0) / 100)),
    };
  }

  function updateDraftLine(index: number, patch: Partial<EditableLine>) {
    setDraftLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
    );
  }

  function addDraftLine(lineType: EditableLine["lineType"]) {
    setDraftLines((current) => [
      ...current,
      {
        ...blankLine,
        lineType,
        unitCost: lineType === "technology" ? "" : "0",
        unitPrice: lineType === "technology" ? "" : "0",
      },
    ]);
  }

  function setDraftLineType(index: number, lineType: EditableLine["lineType"]) {
    const current = draftLines[index];
    updateDraftLine(index, {
      lineType,
      partId: lineType === "technology" ? current?.partId ?? "" : "",
      partCode: lineType === "technology" ? current?.partCode ?? "" : "",
      description: lineType === "technology" && current?.lineType === "technology" ? current.description : "",
      unitCost: lineType === "technology" ? current?.unitCost ?? "" : "0",
      unitPrice: lineType === "technology" ? current?.unitPrice ?? "" : "0",
    });
  }

  function chooseDraftPart(index: number, partId: string) {
    const part = parts.find((item) => item.id === partId);
    if (!part) {
      updateDraftLine(index, { partId, partCode: "", description: "", unitCost: "", unitPrice: "" });
      return;
    }
    updateDraftLine(index, {
      partId,
      partCode: part.part_code,
      description: part.description,
      unitCost: centsToRand(part.default_unit_cost_cents),
      unitPrice: centsToRand(part.default_unit_price_cents),
    });
  }

  async function saveDraftLines() {
    setSavingLines(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/quotes/${quoteId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lines: draftLines.map((line) => ({
            lineType: line.lineType,
            partId: line.partId || null,
            partCode: line.partCode,
            description: line.description,
            quantity: line.quantity,
            unitCost: line.unitCost,
            unitPrice: line.unitPrice,
          })),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Quote update failed");
      setNotice("Quote lines updated.");
      setEditing(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Quote update failed");
    } finally {
      setSavingLines(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setSignoffUrl("");
    setSignoffApprovalRequestId("");
    setSignoffChannel("");
    try {
      const [quoteResponse, supportResponse] = await Promise.all([
        fetch(`/api/quotes/${quoteId}`),
        fetch("/api/quote-support"),
      ]);
      const body = await quoteResponse.json();
      if (!quoteResponse.ok) throw new Error(body.error ?? "Quote failed to load");
      const supportBody = supportResponse.ok ? await supportResponse.json() : null;
      if (!supportResponse.ok) throw new Error(supportBody?.error ?? "Quote support failed to load");
      setQuote(body.quote);
      setLines(body.lines ?? []);
      setValidations(body.validations ?? []);
      setAuditEvents(body.auditEvents ?? []);
      setSiteAssets(body.siteAssets ?? []);
      setParts(supportBody?.parts ?? []);
      setDraftLines((body.lines ?? []).map((line: Line) => toDraftLine(line)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Quote failed to load");
    } finally {
      setLoading(false);
    }
  }, [quoteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const latestValidation = validations[0];
  const implicated = useMemo(
    () => new Set(latestValidation?.implicated_line_item_ids ?? []),
    [latestValidation],
  );

  async function runValidation() {
    setBusy("validation");
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/quotes/${quoteId}/validate`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Validation failed");
      setNotice("Steve technical check completed.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setBusy("");
    }
  }

  async function changeStatus(status: string) {
    setBusy(status);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/quotes/${quoteId}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Status change failed");
      setNotice(`Quote moved to ${statusLabel(status)}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status change failed");
    } finally {
      setBusy("");
    }
  }

  async function saveAsTemplate() {
    const name = window.prompt("Template name", `${quote?.quote_number ?? "Quote"} template`)?.trim();
    if (!name) return;
    setBusy("template");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/quote-templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          sourceQuoteId: quoteId,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to save template");
      setNotice(`Template saved: ${body.templateName ?? name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save template");
    } finally {
      setBusy("");
    }
  }

  async function sendQuoteSignoffLink() {
    setBusy("signoff");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/client-signoff-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetType: "quote",
          targetId: quoteId,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to create sign-off link");
      setSignoffUrl(body.url ?? "");
      setSignoffApprovalRequestId(body.approvalRequestId ?? "");
      setSignoffChannel(body.channel ?? "");
      setNotice("Quote sign-off link queued for approval.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create sign-off link");
    } finally {
      setBusy("");
    }
  }

  function printQuote() {
    window.print();
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading quote...</div>;
  if (!quote) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {error || "Quote not found"}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <style>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .print-card { border: none !important; box-shadow: none !important; }
          .print-page { padding: 0 !important; color: #111827 !important; }
        }
      `}</style>

      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            to="/staff/quotes"
            className="mb-2 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Quotes
          </Link>
          <h1 className="text-2xl font-bold">{quote.quote_number}</h1>
          <p className="text-sm text-muted-foreground">
            {quote.organization_name} · {quote.site_name} · {statusLabel(quote.status)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={runValidation}
            disabled={Boolean(busy)}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-70"
          >
            <ShieldCheck className="h-4 w-4" />
            {busy === "validation" ? "Checking" : "Run Technical Check"}
          </button>
          <button
            onClick={printQuote}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            <FileDown className="h-4 w-4" /> Print / Save PDF
          </button>
          <button
            onClick={() => void saveAsTemplate()}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            <Save className="h-4 w-4" /> Save as template
          </button>
        </div>
      </div>

      {error && (
        <div className="no-print flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}
      {notice && (
        <div className="no-print flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          {notice}
        </div>
      )}

      <section className="no-print grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className={`rounded-lg border p-4 ${validationStyles(latestValidation?.status)}`}>
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <div className="font-semibold">
                Steve Technical Check: {latestValidation?.status ?? "not run"}
              </div>
              <p className="mt-1 text-sm">
                {latestValidation?.summary ??
                  "Run the technical check before requesting internal approval."}
              </p>
              {latestValidation && (
                <p className="mt-2 text-xs opacity-80">
                  Checked by {latestValidation.actor_name ?? "staff"} on{" "}
                  {new Date(latestValidation.created_at).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-surface p-4">
          <div className="text-sm font-semibold">Workflow Actions</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(nextActions[quote.status] ?? []).map((action) => (
              <button
                key={action.status}
                onClick={() => void changeStatus(action.status)}
                disabled={Boolean(busy)}
                className="rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-70"
              >
                {busy === action.status ? "Saving" : action.label}
              </button>
            ))}
            {(nextActions[quote.status] ?? []).length === 0 && (
              <span className="text-sm text-muted-foreground">No further workflow actions.</span>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-surface p-4">
          <div className="text-sm font-semibold">Client Sign-Off</div>
          <p className="mt-2 text-sm text-muted-foreground">
            Create a sign-off link once the quote has been sent to the client.
          </p>
          <div className="mt-3">
            <button
              type="button"
              onClick={() => void sendQuoteSignoffLink()}
              disabled={quote.status !== "sent_to_client" || Boolean(busy)}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-70"
            >
              <FileSignature className="h-4 w-4" />
              {busy === "signoff" ? "Queueing" : "Generate sign-off link"}
            </button>
          </div>
          {quote.status !== "sent_to_client" && (
            <p className="mt-2 text-xs text-muted-foreground">
              Quote must be sent to the client first.
            </p>
          )}
          {signoffUrl && (
            <div className="mt-4 space-y-3 rounded-md border border-border bg-background p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Ready to open
                </div>
                {signoffChannel && (
                  <div className="text-xs text-muted-foreground">
                    Approval draft channel: {signoffChannel}
                  </div>
                )}
              </div>
              <div className="rounded-md border border-border bg-white p-3">
                <div className="flex items-start gap-4">
                  <div className="shrink-0 rounded-md border border-border bg-white p-2">
                    <QRCodeSVG value={signoffUrl} size={160} />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">
                      Quote sign-off link
                    </div>
                    <input
                      readOnly
                      value={signoffUrl}
                      onFocus={(event) => event.currentTarget.select()}
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        await navigator.clipboard.writeText(signoffUrl);
                        setNotice("Sign-off link copied.");
                      }}
                      className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-surface-2"
                    >
                      Copy link
                    </button>
                  </div>
                </div>
              </div>
              {signoffApprovalRequestId && (
                <div className="text-xs text-muted-foreground">
                  Approval request: {signoffApprovalRequestId}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="no-print rounded-lg border border-border/60 bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Quote Lines</h2>
            <p className="text-sm text-muted-foreground">
              Classify lines before sending. Technology, labour/travel/accommodation, and SLA are all required.
            </p>
          </div>
          {!editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-surface-2"
            >
              <Plus className="h-4 w-4" /> Edit lines
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDraftLines(lines.map((line) => toDraftLine(line)));
                }}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveDraftLines()}
                disabled={savingLines}
                className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-70"
              >
                <Save className="h-4 w-4" /> {savingLines ? "Saving" : "Save lines"}
              </button>
            </div>
          )}
        </div>

        {!editing ? (
          <div className="mt-4 overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Part</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Unit</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((line) => (
                  <tr key={line.id}>
                    <td className="px-3 py-2">{line.line_type ?? "unclassified"}</td>
                    <td className="px-3 py-2">{line.part_code ?? "Custom"}</td>
                    <td className="px-3 py-2">{line.description}</td>
                    <td className="px-3 py-2 text-right">{line.quantity}</td>
                    <td className="px-3 py-2 text-right">{money(line.unit_price_cents, quote.currency)}</td>
                    <td className="px-3 py-2 text-right">{money(line.total_price_cents, quote.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => addDraftLine("technology")}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-surface-2"
              >
                <Plus className="h-4 w-4" /> Add technology
              </button>
              <button
                type="button"
                onClick={() => addDraftLine("labor_travel_accommodation")}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-surface-2"
              >
                <Plus className="h-4 w-4" /> Add labour / travel / accommodation
              </button>
              <button
                type="button"
                onClick={() => addDraftLine("sla")}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-surface-2"
              >
                <Plus className="h-4 w-4" /> Add SLA
              </button>
            </div>

            <div className="space-y-3">
              {draftLines.map((line, index) => (
                <div
                  key={index}
                  className="grid gap-3 rounded-md border border-border bg-background p-3 lg:grid-cols-[180px_220px_minmax(220px,1fr)_80px_110px_110px_auto]"
                >
                  <select
                    value={line.lineType}
                    onChange={(event) => setDraftLineType(index, event.target.value as EditableLine["lineType"])}
                    className="h-10 rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-orange"
                  >
                    <option value="technology">Technology</option>
                    <option value="labor_travel_accommodation">Labour / travel / accommodation</option>
                    <option value="sla">SLA</option>
                  </select>
                  {line.lineType === "technology" ? (
                    <select
                      value={line.partId}
                      onChange={(event) => chooseDraftPart(index, event.target.value)}
                      className="h-10 rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-orange"
                    >
                      <option value="">Select part</option>
                      {parts.map((part) => (
                        <option key={part.id} value={part.id}>
                          {part.part_code}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex h-10 items-center rounded-md border border-dashed border-border bg-white px-3 text-xs text-muted-foreground">
                      {line.lineType === "sla"
                        ? "SLA terms are entered in the description"
                        : "Combined labour / travel / accommodation line"}
                    </div>
                  )}
                  <input
                    value={line.description}
                    onChange={(event) => updateDraftLine(index, { description: event.target.value })}
                    required
                    placeholder={
                      line.lineType === "sla"
                        ? "SLA terms"
                        : line.lineType === "labor_travel_accommodation"
                          ? "Labour / travel / accommodation"
                          : "Description"
                    }
                    className="h-10 rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-orange"
                  />
                  <input
                    value={line.quantity}
                    onChange={(event) => updateDraftLine(index, { quantity: event.target.value })}
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    className="h-10 rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-orange"
                  />
                  <input
                    value={line.unitCost}
                    onChange={(event) => updateDraftLine(index, { unitCost: event.target.value })}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={line.lineType === "sla" ? "Optional" : "Cost"}
                    className="h-10 rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-orange"
                  />
                  <input
                    value={line.unitPrice}
                    onChange={(event) => updateDraftLine(index, { unitPrice: event.target.value })}
                    type="number"
                    min="0"
                    step="0.01"
                    required={line.lineType !== "sla"}
                    placeholder={line.lineType === "sla" ? "Optional" : "Price"}
                    className="h-10 rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-orange"
                  />
                  <button
                    type="button"
                    disabled={draftLines.length === 1}
                    onClick={() => setDraftLines((current) => current.filter((_, i) => i !== index))}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-border px-3 text-sm text-muted-foreground hover:bg-surface-2 disabled:opacity-40"
                    aria-label="Remove line"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="print-page print-card rounded-lg border border-border/60 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">STI Risk</div>
            <h2 className="mt-2 text-3xl font-black text-slate-950">Quotation</h2>
            <p className="mt-1 text-sm text-slate-600">
              Technical risk, fire, safety, and compliance services
            </p>
          </div>
          <div className="text-left text-sm sm:text-right">
            <div className="font-bold text-slate-950">{quote.quote_number}</div>
            <div className="text-slate-600">Status: {statusLabel(quote.status)}</div>
            <div className="text-slate-600">
              Valid until: {quote.valid_until ?? "To be confirmed"}
            </div>
          </div>
        </div>

        <div className="grid gap-4 py-5 text-sm md:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500">Prepared For</div>
            <div className="mt-1 font-semibold text-slate-950">{quote.organization_name}</div>
            <div className="text-slate-600">{quote.site_name}</div>
            {quote.site_address && <div className="text-slate-600">{quote.site_address}</div>}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500">Reference</div>
            <div className="mt-1 text-slate-700">{quote.client_reference ?? "No reference"}</div>
            <div className="text-slate-600">Prepared by {quote.created_by_name ?? "STI Risk"}</div>
            {quote.approved_by_name && (
              <div className="text-slate-600">Approved by {quote.approved_by_name}</div>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-3 py-2">Part</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {lines.map((line) => (
                <tr key={line.id} className={implicated.has(line.id) ? "bg-rose-50" : undefined}>
                  <td className="px-3 py-2 font-medium text-slate-900">
                    {line.part_code ?? "Custom"}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{line.description}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{line.quantity}</td>
                  <td className="px-3 py-2 text-right text-slate-700">
                    {money(line.unit_price_cents, quote.currency)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-slate-900">
                    {money(line.total_price_cents, quote.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-[1fr_280px]">
          <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-700">
            <div className="font-semibold text-slate-900">Notes</div>
            <p className="mt-1 whitespace-pre-wrap">{quote.notes || "No additional notes."}</p>
            {latestValidation && (
              <p className="mt-3 text-xs">
                Steve technical validation: {latestValidation.status.toUpperCase()} -{" "}
                {latestValidation.summary}
              </p>
            )}
          </div>
          <div className="space-y-2 rounded-md bg-slate-950 p-4 text-white">
            <div className="flex justify-between text-sm">
              <span>Subtotal</span>
              <span>{money(quote.subtotal_cents, quote.currency)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Gross margin</span>
              <span>
                {money(quote.margin_cents, quote.currency)} · {Number(quote.margin_percent)}%
              </span>
            </div>
            <div className="border-t border-white/20 pt-2">
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span>{money(quote.total_value_cents, quote.currency)}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="no-print grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-surface p-4">
          <h2 className="font-semibold">Site Assets</h2>
          <div className="mt-3 space-y-2">
            {siteAssets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No structured assets recorded. Steve may return amber until site context is added.
              </p>
            ) : (
              siteAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="rounded-md border border-border bg-background p-3 text-sm"
                >
                  <div className="font-medium">
                    {asset.manufacturer ?? "Unknown"} {asset.model ?? asset.asset_type}
                  </div>
                  <div className="text-muted-foreground">
                    Family: {asset.system_family ?? "unknown"} · {asset.notes ?? "No notes"}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-surface p-4">
          <h2 className="font-semibold">Approval Timeline</h2>
          <div className="mt-3 space-y-3">
            {auditEvents.map((event) => (
              <div key={`${event.action}-${event.created_at}`} className="flex gap-3 text-sm">
                <Clock3 className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="font-medium">{statusLabel(event.action)}</div>
                  <div className="text-xs text-muted-foreground">
                    {event.actor_name ?? "System"} · {new Date(event.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
