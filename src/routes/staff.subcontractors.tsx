import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import {
  Bot,
  ClipboardList,
  FileCheck2,
  HardHat,
  MapPinned,
  PencilLine,
  Plus,
  ReceiptText,
  Save,
  Star,
  X,
} from "lucide-react";

export const Route = createFileRoute("/staff/subcontractors")({
  component: Subcontractors,
});

type RateCard = {
  default_rate_cents: number | null;
  by_work_type: Record<string, number>;
};

type Contractor = {
  id: string;
  name: string;
  primary_contact_name: string | null;
  email: string | null;
  phone: string | null;
  region: string | null;
  work_types: string[];
  status: string;
  compliance_status: string;
  preferred_channel: "email" | "whatsapp";
  rate_card: RateCard | null;
  active_pos: number;
  pending_amount_cents: number;
};

type ContractorFormState = {
  id: string | null;
  name: string;
  primaryContactName: string;
  email: string;
  phone: string;
  region: string;
  workTypesText: string;
  status: string;
  complianceStatus: string;
  preferredChannel: "email" | "whatsapp";
  notes: string;
  defaultRateZar: string;
  rateRows: Array<{ workType: string; rateZar: string }>;
};

const complianceOptions = ["unknown", "pending", "approved", "expired"] as const;
const channelOptions = ["email", "whatsapp"] as const;

function parseWorkTypes(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function centsFromZar(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed * 100));
}

function zarFromCents(value: number | null | undefined) {
  if (value === null || value === undefined) return "";
  return (Number(value) / 100).toFixed(2);
}

function normalizeRateRows(
  workTypesText: string,
  existing: Array<{ workType: string; rateZar: string }>,
) {
  const workTypes = parseWorkTypes(workTypesText);
  const existingRates = new Map(existing.map((row) => [row.workType, row.rateZar]));
  return workTypes.map((workType) => ({
    workType,
    rateZar: existingRates.get(workType) ?? "",
  }));
}

function formFromContractor(contractor: Contractor): ContractorFormState {
  const rateCard = contractor.rate_card ?? { default_rate_cents: null, by_work_type: {} };
  const workTypesText = contractor.work_types.join(", ");
  return {
    id: contractor.id,
    name: contractor.name,
    primaryContactName: contractor.primary_contact_name ?? "",
    email: contractor.email ?? "",
    phone: contractor.phone ?? "",
    region: contractor.region ?? "",
    workTypesText,
    status: contractor.status,
    complianceStatus: contractor.compliance_status,
    preferredChannel: contractor.preferred_channel,
    notes: "",
    defaultRateZar: zarFromCents(rateCard.default_rate_cents),
    rateRows: parseWorkTypes(workTypesText).map((workType) => ({
      workType,
      rateZar: zarFromCents(rateCard.by_work_type[workType] ?? null),
    })),
  };
}

function emptyForm(): ContractorFormState {
  return {
    id: null,
    name: "",
    primaryContactName: "",
    email: "",
    phone: "",
    region: "",
    workTypesText: "",
    status: "active",
    complianceStatus: "unknown",
    preferredChannel: "whatsapp",
    notes: "",
    defaultRateZar: "",
    rateRows: [],
  };
}

function Subcontractors() {
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState<ContractorFormState>(emptyForm());

  async function load() {
    fetch("/api/subcontractors")
      .then((response) => response.json())
      .then((body) => setContractors(body.subcontractors ?? []))
      .catch(() => setContractors([]));
  }

  useEffect(() => {
    void load();
  }, []);

  function startNew() {
    setError("");
    setNotice("");
    setForm(emptyForm());
    setShowForm(true);
  }

  function startEdit(contractor: Contractor) {
    setError("");
    setNotice("");
    setForm(formFromContractor(contractor));
    setShowForm(true);
  }

  function setWorkTypesText(value: string) {
    setForm((current) => ({
      ...current,
      workTypesText: value,
      rateRows: normalizeRateRows(value, current.rateRows),
    }));
  }

  function setRateRow(workType: string, rateZar: string) {
    setForm((current) => ({
      ...current,
      rateRows: current.rateRows.map((row) => (row.workType === workType ? { ...row, rateZar } : row)),
    }));
  }

  async function saveContractor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    const payload = {
      name: form.name.trim(),
      primaryContactName: form.primaryContactName.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      region: form.region.trim() || null,
      workTypes: parseWorkTypes(form.workTypesText),
      status: form.status,
      complianceStatus: form.complianceStatus,
      preferredChannel: form.preferredChannel,
      notes: form.notes.trim() || null,
    };
    const rateCard: RateCard = {
      default_rate_cents: form.defaultRateZar ? centsFromZar(form.defaultRateZar) : null,
      by_work_type: {},
    };
    for (const row of form.rateRows) {
      const cents = row.rateZar ? centsFromZar(row.rateZar) : null;
      if (cents !== null) rateCard.by_work_type[row.workType] = cents;
    }

    if (!payload.name) {
      setError("Name is required");
      return;
    }
    if (!payload.workTypes.length) {
      setError("At least one work type is required");
      return;
    }

    try {
      const response = await fetch(
        form.id ? `/api/subcontractors/${form.id}` : "/api/subcontractors",
        {
          method: form.id ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, rateCard }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to save subcontractor");
      setShowForm(false);
      setForm(emptyForm());
      setNotice("Subcontractor saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save subcontractor");
    }
  }

  const areas = [
    { label: "Regions", icon: MapPinned },
    { label: "Work types", icon: HardHat },
    { label: "Compliance documents", icon: FileCheck2 },
    { label: "Assigned jobs", icon: ClipboardList },
    { label: "Payment status", icon: ReceiptText },
    { label: "Performance score", icon: Star },
  ] as const;

  const activeWorkTypes = parseWorkTypes(form.workTypesText);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Contractor control
          </div>
          <h1 className="text-2xl font-bold">Subcontractors</h1>
          <p className="text-sm text-muted-foreground">
            Contractor routing, secure job links, report quality, compliance, rates, and payment
            status.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={startNew}
            className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
          >
            <Plus className="h-4 w-4" /> Add subcontractor
          </button>
          <Link
            to="/staff/steve"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            <Bot className="h-4 w-4" /> Recommend contractor
          </Link>
        </div>
      </div>

      {notice && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={saveContractor} className="space-y-4 rounded-lg border border-border/60 bg-surface p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input
              name="name"
              required
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Name"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
            />
            <input
              name="primaryContactName"
              value={form.primaryContactName}
              onChange={(event) =>
                setForm((current) => ({ ...current, primaryContactName: event.target.value }))
              }
              placeholder="Primary contact"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
            />
            <input
              name="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="Email"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
            />
            <input
              name="phone"
              value={form.phone}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              placeholder="Phone"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
            />
            <input
              name="region"
              value={form.region}
              onChange={(event) => setForm((current) => ({ ...current, region: event.target.value }))}
              placeholder="Region"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
            />
            <input
              name="workTypes"
              value={form.workTypesText}
              onChange={(event) => setWorkTypesText(event.target.value)}
              placeholder="Work types, comma separated"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
            />
            <select
              name="status"
              value={form.status}
              onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="blocked">Blocked</option>
            </select>
            <select
              name="complianceStatus"
              value={form.complianceStatus}
              onChange={(event) =>
                setForm((current) => ({ ...current, complianceStatus: event.target.value }))
              }
              className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
            >
              {complianceOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <select
              name="preferredChannel"
              value={form.preferredChannel}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  preferredChannel: event.target.value as "email" | "whatsapp",
                }))
              }
              className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
            >
              {channelOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-md border border-border/60 bg-background p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Rate card</div>
                <div className="text-xs text-muted-foreground">
                  Default rate and work-type specific rates in ZAR.
                </div>
              </div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-border/50 bg-surface p-3">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Default rate
                </label>
                <input
                  value={form.defaultRateZar}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, defaultRateZar: event.target.value }))
                  }
                  inputMode="decimal"
                  placeholder="0.00"
                  className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
                />
              </div>
              <div className="rounded-md border border-border/50 bg-surface p-3">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Work-type rates
                </label>
                <div className="mt-2 space-y-2">
                  {activeWorkTypes.length ? (
                    activeWorkTypes.map((workType) => {
                      const row = form.rateRows.find((item) => item.workType === workType);
                      return (
                        <div key={workType} className="grid grid-cols-[1fr_120px] gap-2">
                          <div className="flex items-center rounded-md border border-border bg-background px-3 text-sm">
                            {workType}
                          </div>
                          <input
                            value={row?.rateZar ?? ""}
                            onChange={(event) => setRateRow(workType, event.target.value)}
                            inputMode="decimal"
                            placeholder="0.00"
                            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
                          />
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      Add work types above to configure rates.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <textarea
            name="notes"
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            placeholder="Notes"
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand-orange"
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
            >
              <Save className="h-4 w-4" /> {form.id ? "Save changes" : "Save subcontractor"}
            </button>
            <button
              type="button"
              onClick={() => {
                setForm(emptyForm());
                setShowForm(false);
                setError("");
              }}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
            >
              <X className="h-4 w-4" /> Cancel
            </button>
          </div>
        </form>
      )}

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        {areas.map((area) => (
          <div key={area.label} className="rounded-lg border border-border/60 bg-white p-4">
            <area.icon className="h-5 w-5 text-brand-blue" />
            <div className="mt-3 text-sm font-medium">{area.label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border/60 bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Known subcontractors</h2>
          <div className="text-xs text-muted-foreground">
            Preferred channel and rate card are editable here.
          </div>
        </div>
        <div className="mt-4 divide-y divide-border/40">
          {contractors.map((contractor) => {
            const defaultRate = contractor.rate_card?.default_rate_cents ?? null;
            const rateSummary = defaultRate !== null ? `Default ${zarFromCents(defaultRate)}` : "No default rate";
            return (
              <div key={contractor.id} className="grid gap-3 py-3 text-sm md:grid-cols-[1.2fr_1fr_1.5fr_1fr_auto] md:items-start">
                <div>
                  <div className="font-medium">{contractor.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {contractor.primary_contact_name || contractor.email || contractor.phone || "No contact set"}
                  </div>
                </div>
                <div>
                  <div>{contractor.region ?? "No region"}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Preferred channel: {contractor.preferred_channel}
                  </div>
                </div>
                <div className="text-muted-foreground">
                  {contractor.work_types.join(", ") || "No work types"}
                  <div className="mt-1 text-xs text-muted-foreground">{rateSummary}</div>
                </div>
                <div className="font-medium text-brand-blue">
                  {contractor.compliance_status} · {contractor.active_pos} active
                  <div className="mt-1 text-xs text-muted-foreground">
                    {zarFromCents(contractor.pending_amount_cents)} pending
                  </div>
                </div>
                <div className="flex justify-start md:justify-end">
                  <button
                    type="button"
                    onClick={() => startEdit(contractor)}
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-surface-2"
                  >
                    <PencilLine className="h-4 w-4" /> Edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
