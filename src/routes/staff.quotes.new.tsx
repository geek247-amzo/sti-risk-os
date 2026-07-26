import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowLeft, Plus, Save, Trash2 } from "lucide-react";

export const Route = createFileRoute("/staff/quotes/new")({
  component: NewQuote,
});

type Organization = { id: string; name: string };
type Site = { id: string; organization_id: string; name: string; address: string | null };
type Part = {
  id: string;
  part_code: string;
  description: string;
  category: string;
  manufacturer: string | null;
  system_family: string | null;
  default_unit_cost_cents: number;
  default_unit_price_cents: number;
};
type QuoteTemplate = {
  id: string;
  name: string;
  description: string | null;
  organization_name: string | null;
  site_name: string | null;
  template_data: Record<string, unknown>;
  updated_at: string;
};
type Line = {
  lineType: "technology" | "labor_travel_accommodation" | "sla";
  partId: string;
  partCode: string;
  description: string;
  quantity: string;
  unitCost: string;
  unitPrice: string;
};

const blankLine: Line = {
  lineType: "technology",
  partId: "",
  partCode: "",
  description: "",
  quantity: "1",
  unitCost: "",
  unitPrice: "",
};

function toTemplateLine(raw: Record<string, unknown>): Line {
  const lineTypeRaw = String(raw.lineType ?? raw.line_type ?? "").trim();
  const hasPart =
    Boolean(raw.partId ?? raw.part_id ?? raw.partCode ?? raw.part_code) ||
    lineTypeRaw === "technology";
  const lineType = (["technology", "labor_travel_accommodation", "sla"] as const).includes(
    lineTypeRaw as Line["lineType"],
  )
    ? (lineTypeRaw as Line["lineType"])
    : hasPart
      ? "technology"
      : "labor_travel_accommodation";
  const quantity = raw.quantity ?? raw.qty ?? 1;
  const unitCost =
    raw.unitCost ?? raw.unit_cost ?? raw.unit_cost_cents ?? raw.default_unit_cost_cents ?? "";
  const unitPrice =
    raw.unitPrice ?? raw.unit_price ?? raw.unit_price_cents ?? raw.default_unit_price_cents ?? "";

  return {
    lineType,
    partId: String(raw.partId ?? raw.part_id ?? ""),
    partCode: String(raw.partCode ?? raw.part_code ?? ""),
    description: String(raw.description ?? ""),
    quantity: String(quantity ?? "1"),
    unitCost: String(unitCost === null || unitCost === undefined ? "" : unitCost),
    unitPrice: String(unitPrice === null || unitPrice === undefined ? "" : unitPrice),
  };
}

function centsToRand(cents: number) {
  return cents ? String(Math.round(cents) / 100) : "";
}

function lineTotal(line: Line) {
  const quantity = Number(line.quantity) || 0;
  const unitPrice = Number(line.unitPrice) || 0;
  return quantity * unitPrice;
}

function NewQuote() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/staff/quotes/new" }) as { templateId?: string | undefined };
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [templates, setTemplates] = useState<QuoteTemplate[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [siteName, setSiteName] = useState("");
  const [siteAssetFamily, setSiteAssetFamily] = useState("");
  const [siteAssetModel, setSiteAssetModel] = useState("");
  const [siteAssetNotes, setSiteAssetNotes] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [clientReference, setClientReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...blankLine }]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/quote-support")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Quote support failed to load");
        setOrganizations(body.organizations ?? []);
        setSites(body.sites ?? []);
        setParts(body.parts ?? []);
        setTemplates(body.templates ?? []);
        setOrganizationId(body.organizations?.[0]?.id ?? "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Quote support failed"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading || !search.templateId) return;
    const template = templates.find((item) => item.id === search.templateId);
    if (!template) return;
    setSelectedTemplateId(template.id);
    const data = template.template_data ?? {};
    if (typeof data.organizationId === "string") setOrganizationId(data.organizationId);
    if (typeof data.siteId === "string") setSiteId(data.siteId);
    if (typeof data.siteName === "string") setSiteName(data.siteName);
    if (typeof data.siteAssetFamily === "string") setSiteAssetFamily(data.siteAssetFamily);
    if (typeof data.siteAssetModel === "string") setSiteAssetModel(data.siteAssetModel);
    if (typeof data.siteAssetNotes === "string") setSiteAssetNotes(data.siteAssetNotes);
    if (typeof data.validUntil === "string") setValidUntil(data.validUntil);
    if (typeof data.clientReference === "string") setClientReference(data.clientReference);
    if (typeof data.notes === "string") setNotes(data.notes);
    const templateLines = Array.isArray(data.lines) ? data.lines : [];
    if (templateLines.length) {
      setLines(templateLines.map((line) => toTemplateLine(line as Record<string, unknown>)));
    }
  }, [loading, search.templateId, templates]);

  const organizationSites = useMemo(
    () => sites.filter((site) => site.organization_id === organizationId),
    [organizationId, sites],
  );

  const total = useMemo(() => lines.reduce((sum, line) => sum + lineTotal(line), 0), [lines]);

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
    );
  }

  function addLine(lineType: Line["lineType"]) {
    setLines((current) => [
      ...current,
      {
        ...blankLine,
        lineType,
        quantity: lineType === "technology" ? "1" : "1",
        unitCost: lineType === "technology" ? "" : "0",
        unitPrice: lineType === "technology" ? "" : "0",
      },
    ]);
  }

  function setLineType(index: number, lineType: Line["lineType"]) {
    const current = lines[index];
    updateLine(index, {
      lineType,
      partId: lineType === "technology" ? (current?.partId ?? "") : "",
      partCode: lineType === "technology" ? (current?.partCode ?? "") : "",
      description:
        lineType === "technology" && current?.lineType === "technology" ? current.description : "",
      unitCost: lineType === "technology" ? (current?.unitCost ?? "") : "0",
      unitPrice: lineType === "technology" ? (current?.unitPrice ?? "") : "0",
    });
  }

  function choosePart(index: number, partId: string) {
    const part = parts.find((item) => item.id === partId);
    if (!part) {
      updateLine(index, { partId, partCode: "", description: "", unitCost: "", unitPrice: "" });
      return;
    }
    updateLine(index, {
      partId,
      partCode: part.part_code,
      description: part.description,
      unitCost: centsToRand(part.default_unit_cost_cents),
      unitPrice: centsToRand(part.default_unit_price_cents),
    });
  }

  async function createQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/quotes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          siteId: siteId || null,
          siteName,
          siteAssetFamily,
          siteAssetManufacturer: siteAssetFamily,
          siteAssetModel,
          siteAssetNotes,
          validUntil,
          clientReference,
          notes,
          lines: lines.map((line) => ({
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
      if (!response.ok) throw new Error(body.error ?? "Quote could not be created");
      await navigate({ to: "/staff/quotes/$quoteId", params: { quoteId: body.quote.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Quote could not be created");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={createQuote} className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            to="/staff/quotes"
            className="mb-2 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Quotes
          </Link>
          <h1 className="text-2xl font-bold">New Quote</h1>
          <p className="text-sm text-muted-foreground">
            Build a quote against a known client site so Steve can validate compatibility.
          </p>
        </div>
        <button
          data-guide="transaction-create-quote"
          disabled={saving || loading}
          className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-70"
        >
          <Save className="h-4 w-4" /> {saving ? "Saving" : "Create Quote"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      <section className="grid gap-3 rounded-lg border border-border/60 bg-surface p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Templates</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Load a saved quotation template to prefill client, site, and line items.
          </div>
        </div>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Quotation template</span>
          <select
            value={selectedTemplateId}
            onChange={(event) => {
              setSelectedTemplateId(event.target.value);
              const template = templates.find((item) => item.id === event.target.value);
              if (!template) return;
              const data = template.template_data ?? {};
              if (typeof data.organizationId === "string") setOrganizationId(data.organizationId);
              if (typeof data.siteId === "string") setSiteId(data.siteId);
              if (typeof data.siteName === "string") setSiteName(data.siteName);
              if (typeof data.siteAssetFamily === "string")
                setSiteAssetFamily(data.siteAssetFamily);
              if (typeof data.siteAssetModel === "string") setSiteAssetModel(data.siteAssetModel);
              if (typeof data.siteAssetNotes === "string") setSiteAssetNotes(data.siteAssetNotes);
              if (typeof data.validUntil === "string") setValidUntil(data.validUntil);
              if (typeof data.clientReference === "string")
                setClientReference(data.clientReference);
              if (typeof data.notes === "string") setNotes(data.notes);
              const templateLines = Array.isArray(data.lines) ? data.lines : [];
              if (templateLines.length) {
                setLines(
                  templateLines.map((line) => toTemplateLine(line as Record<string, unknown>)),
                );
              }
            }}
            className="h-10 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
          >
            <option value="">Select a saved template</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
                {template.organization_name ? ` · ${template.organization_name}` : ""}
                {template.site_name ? ` · ${template.site_name}` : ""}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="grid gap-4 rounded-lg border border-border/60 bg-surface p-4 lg:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Client organization</span>
          <select
            value={organizationId}
            onChange={(event) => {
              setOrganizationId(event.target.value);
              setSiteId("");
            }}
            required
            className="h-10 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
          >
            <option value="">Select organization</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Site</span>
          <select
            value={siteId}
            onChange={(event) => {
              setSiteId(event.target.value);
              setSiteName("");
            }}
            className="h-10 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
          >
            <option value="">Create or select site</option>
            {organizationSites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>

        {!siteId && (
          <label className="space-y-1 text-sm">
            <span className="font-medium">New site name</span>
            <input
              value={siteName}
              onChange={(event) => setSiteName(event.target.value)}
              required={!siteId}
              placeholder="e.g. Main factory, Block A, Warehouse 2"
              className="h-10 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
            />
          </label>
        )}

        <label className="space-y-1 text-sm">
          <span className="font-medium">Valid until</span>
          <input
            type="date"
            value={validUntil}
            onChange={(event) => setValidUntil(event.target.value)}
            className="h-10 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Known installed panel family</span>
          <select
            value={siteAssetFamily}
            onChange={(event) => setSiteAssetFamily(event.target.value)}
            className="h-10 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
          >
            <option value="">Unknown / use existing site assets</option>
            <option value="ziton">Ziton</option>
            <option value="apollo">Apollo</option>
            <option value="ctec">C-TEC</option>
            <option value="advanced">Advanced</option>
            <option value="morley">Morley</option>
            <option value="kentec">Kentec</option>
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Panel model</span>
          <input
            value={siteAssetModel}
            onChange={(event) => setSiteAssetModel(event.target.value)}
            placeholder="e.g. ZP3, Ziton panel, existing conventional panel"
            className="h-10 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Client reference</span>
          <input
            value={clientReference}
            onChange={(event) => setClientReference(event.target.value)}
            placeholder="PO request, site visit, contact name..."
            className="h-10 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
          />
        </label>

        <label className="space-y-1 text-sm lg:col-span-2">
          <span className="font-medium">Installed asset notes</span>
          <textarea
            value={siteAssetNotes}
            onChange={(event) => setSiteAssetNotes(event.target.value)}
            placeholder="Known fire panel, detector range, subcontractor note, or site report clue."
            className="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-brand-orange"
          />
        </label>

        <label className="space-y-1 text-sm lg:col-span-2">
          <span className="font-medium">Notes</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Scope notes, site context, exclusions, or approval notes."
            className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-brand-orange"
          />
        </label>
      </section>

      <section className="space-y-3 rounded-lg border border-border/60 bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Line Items</h2>
            <p className="text-sm text-muted-foreground">
              Build the quote as technology, labour/travel/accommodation, and SLA.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => addLine("technology")}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-surface-2"
            >
              <Plus className="h-4 w-4" /> Add technology
            </button>
            <button
              type="button"
              onClick={() => addLine("labor_travel_accommodation")}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-surface-2"
            >
              <Plus className="h-4 w-4" /> Add labour / travel / accommodation
            </button>
            <button
              type="button"
              onClick={() => addLine("sla")}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-surface-2"
            >
              <Plus className="h-4 w-4" /> Add SLA
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {lines.map((line, index) => (
            <div
              key={index}
              className="grid gap-3 rounded-md border border-border/60 bg-background p-3 lg:grid-cols-[180px_220px_minmax(220px,1fr)_80px_110px_110px_auto]"
            >
              <select
                value={line.lineType}
                onChange={(event) => setLineType(index, event.target.value as Line["lineType"])}
                className="h-10 rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-orange"
              >
                <option value="technology">Technology</option>
                <option value="labor_travel_accommodation">Labour / travel / accommodation</option>
                <option value="sla">SLA</option>
              </select>
              {line.lineType === "technology" ? (
                <select
                  value={line.partId}
                  onChange={(event) => choosePart(index, event.target.value)}
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
                onChange={(event) => updateLine(index, { description: event.target.value })}
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
                onChange={(event) => updateLine(index, { quantity: event.target.value })}
                type="number"
                min="0.01"
                step="0.01"
                required
                className="h-10 rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-orange"
              />
              <input
                value={line.unitCost}
                onChange={(event) => updateLine(index, { unitCost: event.target.value })}
                type="number"
                min="0"
                step="0.01"
                placeholder={line.lineType === "sla" ? "Optional" : "Cost"}
                className="h-10 rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-orange"
              />
              <input
                value={line.unitPrice}
                onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
                type="number"
                min="0"
                step="0.01"
                required={line.lineType !== "sla"}
                placeholder={line.lineType === "sla" ? "Optional" : "Price"}
                className="h-10 rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-orange"
              />
              <button
                type="button"
                disabled={lines.length === 1}
                onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                className="inline-flex h-10 items-center justify-center rounded-md border border-border px-3 text-sm text-muted-foreground hover:bg-surface-2 disabled:opacity-40"
                aria-label="Remove line"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex justify-end text-lg font-bold">
          Quote total:{" "}
          {new Intl.NumberFormat("en-ZA", {
            style: "currency",
            currency: "ZAR",
          }).format(total)}
        </div>
      </section>
    </form>
  );
}
