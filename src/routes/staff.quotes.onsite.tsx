import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowLeft, Plus, Save, Trash2 } from "lucide-react";

export const Route = createFileRoute("/staff/quotes/onsite")({
  component: OnSiteQuote,
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

function centsToRand(cents: number) {
  return cents ? String(Math.round(cents) / 100) : "";
}

function lineTotal(line: Line) {
  const quantity = Number(line.quantity) || 0;
  const unitPrice = Number(line.unitPrice) || 0;
  return quantity * unitPrice;
}

function OnSiteQuote() {
  const navigate = useNavigate();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [siteName, setSiteName] = useState("");
  const [siteAssetFamily, setSiteAssetFamily] = useState("");
  const [siteAssetModel, setSiteAssetModel] = useState("");
  const [siteAssetNotes, setSiteAssetNotes] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...blankLine }]);
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
        setOrganizationId(body.organizations?.[0]?.id ?? "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Quote support failed"))
      .finally(() => setLoading(false));
  }, []);

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
        quantity: "1",
        unitCost: lineType === "technology" ? "" : "0",
        unitPrice: lineType === "technology" ? "" : "0",
      },
    ]);
  }

  function setLineType(index: number, lineType: Line["lineType"]) {
    const current = lines[index];
    updateLine(index, {
      lineType,
      partId: lineType === "technology" ? current?.partId ?? "" : "",
      partCode: lineType === "technology" ? current?.partCode ?? "" : "",
      description:
        lineType === "technology" && current?.lineType === "technology" ? current.description : "",
      unitCost: lineType === "technology" ? current?.unitCost ?? "" : "0",
      unitPrice: lineType === "technology" ? current?.unitPrice ?? "" : "0",
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
    <form onSubmit={createQuote} className="mx-auto max-w-3xl space-y-5 px-0 sm:px-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/staff/quotes"
            className="mb-2 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Quotes
          </Link>
          <h1 className="text-2xl font-bold">On-site Quote</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Fast entry for site visits. Same draft and validation path, fewer taps.
          </p>
        </div>
        <button
          disabled={saving || loading}
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-70"
        >
          <Save className="h-4 w-4" /> {saving ? "Saving" : "Create"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      <section className="space-y-4 rounded-lg border border-border/60 bg-surface p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Client organization</span>
            <select
              value={organizationId}
              onChange={(event) => {
                setOrganizationId(event.target.value);
                setSiteId("");
              }}
              required
              className="h-11 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
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
              className="h-11 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
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
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="font-medium">New site name</span>
              <input
                value={siteName}
                onChange={(event) => setSiteName(event.target.value)}
                required={!siteId}
                placeholder="Site name"
                className="h-11 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
              />
            </label>
          )}

          <label className="space-y-1 text-sm">
            <span className="font-medium">Panel family</span>
            <select
              value={siteAssetFamily}
              onChange={(event) => setSiteAssetFamily(event.target.value)}
              className="h-11 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
            >
              <option value="">Unknown</option>
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
              placeholder="Model"
              className="h-11 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
            />
          </label>

          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-medium">Site notes</span>
            <textarea
              value={siteAssetNotes}
              onChange={(event) => setSiteAssetNotes(event.target.value)}
              placeholder="Installed assets, site clues, exclusions."
              className="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-brand-orange"
            />
          </label>

          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-medium">Quote notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Scope notes, exclusions, approvals."
              className="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-brand-orange"
            />
          </label>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-border/60 bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Lines</h2>
            <p className="text-sm text-muted-foreground">
              Technology, labour / travel / accommodation, and SLA.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => addLine("technology")}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-surface-2"
          >
            <Plus className="h-4 w-4" /> Technology
          </button>
          <button
            type="button"
            onClick={() => addLine("labor_travel_accommodation")}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-surface-2"
          >
            <Plus className="h-4 w-4" /> Labour / travel / accommodation
          </button>
          <button
            type="button"
            onClick={() => addLine("sla")}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-surface-2"
          >
            <Plus className="h-4 w-4" /> SLA
          </button>
        </div>

        <div className="space-y-3">
          {lines.map((line, index) => (
            <div key={index} className="rounded-md border border-border bg-background p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <select
                  value={line.lineType}
                  onChange={(event) => setLineType(index, event.target.value as Line["lineType"])}
                  className="h-11 rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-orange sm:col-span-2"
                >
                  <option value="technology">Technology</option>
                  <option value="labor_travel_accommodation">Labour / travel / accommodation</option>
                  <option value="sla">SLA</option>
                </select>

                {line.lineType === "technology" ? (
                  <select
                    value={line.partId}
                    onChange={(event) => choosePart(index, event.target.value)}
                    className="h-11 rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-orange sm:col-span-2"
                  >
                    <option value="">Select part</option>
                    {parts.map((part) => (
                      <option key={part.id} value={part.id}>
                        {part.part_code} · {part.description}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="rounded-md border border-dashed border-border bg-white px-3 py-2 text-sm text-muted-foreground sm:col-span-2">
                    {line.lineType === "sla"
                      ? "Enter SLA terms in the description below."
                      : "Combined labour / travel / accommodation line."}
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
                  className="h-11 rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-orange sm:col-span-2"
                />

                <div className="grid gap-3 sm:grid-cols-3 sm:col-span-2">
                  <input
                    value={line.quantity}
                    onChange={(event) => updateLine(index, { quantity: event.target.value })}
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    className="h-11 rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-orange"
                    placeholder="Qty"
                  />
                  <input
                    value={line.unitCost}
                    onChange={(event) => updateLine(index, { unitCost: event.target.value })}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={line.lineType === "sla" ? "Optional cost" : "Cost"}
                    className="h-11 rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-orange"
                  />
                  <input
                    value={line.unitPrice}
                    onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
                    type="number"
                    min="0"
                    step="0.01"
                    required={line.lineType !== "sla"}
                    placeholder={line.lineType === "sla" ? "Optional price" : "Price"}
                    className="h-11 rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-orange"
                  />
                </div>

                <button
                  type="button"
                  disabled={lines.length === 1}
                  onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                  className="inline-flex h-11 items-center justify-center rounded-md border border-border px-3 text-sm text-muted-foreground hover:bg-surface-2 disabled:opacity-40 sm:col-span-2"
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
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
