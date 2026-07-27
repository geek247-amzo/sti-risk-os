import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/staff/compliance")({ component: Compliance });

type Area = { id: string; site_id: string; name: string; area_type: string; site_name: string };
type Asset = {
  id: string;
  area_id: string | null;
  name: string;
  asset_type: string;
  area_name: string | null;
};
type Visit = {
  id: string;
  site_id: string;
  started_at: string;
  status: string;
  site_name: string;
  organization_name: string;
};
type Organization = { id: string; name: string };
type Site = { id: string; organization_id: string; name: string; address: string | null };
type RecordRow = {
  id: string;
  status: "green" | "red" | "yellow";
  note: string | null;
  area_name: string;
  asset_name: string | null;
  site_name: string;
  organization_name: string;
  assessed_at: string;
  is_current: boolean;
  assessed_by_name: string | null;
};
const input =
  "h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange";

function Compliance() {
  const [areas, setAreas] = useState<Area[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [areaId, setAreaId] = useState("");
  const [visitOrganizationId, setVisitOrganizationId] = useState("");
  const [visitSiteId, setVisitSiteId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function load() {
    const [c, r] = await Promise.all([
      fetch("/api/compliance-context"),
      fetch("/api/compliance-records"),
    ]);
    const cb = await c.json();
    const rb = await r.json();
    if (!c.ok || !r.ok) throw new Error(cb.error ?? rb.error ?? "Unable to load compliance");
    setOrganizations(cb.organizations ?? []);
    setSites(cb.sites ?? []);
    setAreas(cb.areas ?? []);
    setAssets(cb.assets ?? []);
    setVisits(cb.visits ?? []);
    setRecords(rb.records ?? []);
  }

  const visitSites = sites.filter((site) => site.organization_id === visitOrganizationId);

  async function createSiteVisit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await fetch("/api/site-visits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to create site visit");
      event.currentTarget.reset();
      setVisitOrganizationId("");
      setVisitSiteId("");
      setNotice("Site visit created. It is now available in the assessment selector.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create site visit");
    }
  }
  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Unable to load compliance"));
  }, []);
  const area = areas.find((item) => item.id === areaId);
  const areaAssets = useMemo(
    () => assets.filter((item) => item.area_id === areaId),
    [assets, areaId],
  );
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const r = await fetch("/api/compliance-records", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      event.currentTarget.reset();
      setAreaId("");
      setNotice("Compliance assessment recorded; history preserved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create compliance record");
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Area & asset compliance
          </div>
          <h1 className="text-2xl font-bold">Compliance records</h1>
          <p className="text-sm text-muted-foreground">
            Assessments are append-only. The latest row is the current state.
          </p>
        </div>
        <button
          onClick={() =>
            load().catch((e) => setError(e instanceof Error ? e.message : "Unable to refresh"))
          }
          className={`${input} inline-flex items-center gap-2`}
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}
      <form
        onSubmit={createSiteVisit}
        className="grid gap-3 rounded-xl border border-border/60 bg-surface p-5 shadow-sm md:grid-cols-2"
      >
        <div className="md:col-span-2">
          <h2 className="font-semibold">Create site visit</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create the visit first; it will then appear below for compliance assessment. The platform
            creates the required operational container automatically.
          </p>
        </div>
        <select
          name="organizationId"
          required
          value={visitOrganizationId}
          onChange={(event) => {
            setVisitOrganizationId(event.target.value);
            setVisitSiteId("");
          }}
          className={input}
        >
          <option value="">Select customer</option>
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </select>
        <select
          name="siteId"
          required
          value={visitSiteId}
          onChange={(event) => setVisitSiteId(event.target.value)}
          className={input}
        >
          <option value="">Select site</option>
          {visitSites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
        <select name="visitType" className={input} defaultValue="maintenance">
          <option value="maintenance">Maintenance</option>
          <option value="project">Project</option>
        </select>
        <select name="captureMode" required className={input} defaultValue="technician_submitted">
          <option value="technician_submitted">Technician submitted</option>
          <option value="client_self_service_submitted">Client self-service</option>
        </select>
        <textarea
          name="notes"
          placeholder="Visit notes (optional)"
          className="min-h-20 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand-orange md:col-span-2"
        />
        <button className="inline-flex h-10 items-center justify-center rounded-md bg-brand-blue px-4 text-sm font-semibold text-white md:col-span-2">
          Create site visit
        </button>
      </form>
      <form
        onSubmit={create}
        className="grid gap-3 rounded-xl border border-border/60 bg-surface p-5 shadow-sm md:grid-cols-2"
      >
        <h2 className="md:col-span-2 font-semibold">Record assessment</h2>
        <select name="siteVisitId" required className={input} defaultValue="">
          <option value="" disabled>
            Select site visit
          </option>
          {visits.map((visit) => (
            <option key={visit.id} value={visit.id}>
              {visit.organization_name} · {visit.site_name} ·{" "}
              {new Date(visit.started_at).toLocaleString()}
            </option>
          ))}
        </select>
        <select
          name="areaId"
          required
          value={areaId}
          onChange={(e) => setAreaId(e.target.value)}
          className={input}
        >
          <option value="" disabled>
            Select area
          </option>
          {areas.map((item) => (
            <option key={item.id} value={item.id}>
              {item.site_name} · {item.name} · {item.area_type}
            </option>
          ))}
        </select>
        <select name="assetId" className={input} defaultValue="">
          <option value="">Area-level assessment</option>
          {areaAssets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name} · {asset.asset_type}
            </option>
          ))}
        </select>
        <select name="status" required className={input} defaultValue="green">
          <option value="green">Green · compliant</option>
          <option value="red">Red · non-compliant</option>
          <option value="yellow">Yellow · work in progress</option>
        </select>
        <textarea
          name="note"
          placeholder={area ? "Assessment note (required for yellow)" : "Assessment note"}
          className="min-h-20 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand-orange md:col-span-2"
        />
        <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand-orange px-4 text-sm font-semibold text-primary-foreground md:col-span-2">
          <ShieldCheck className="h-4 w-4" /> Save assessment
        </button>
      </form>
      <section className="rounded-xl border border-border/60 bg-surface p-5 shadow-sm">
        <h2 className="mb-4 font-semibold">Assessment history</h2>
        <div className="space-y-2">
          {records.map((record) => (
            <div
              key={record.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background p-3"
            >
              <div>
                <div className="font-medium">
                  {record.organization_name} · {record.site_name} · {record.area_name}
                  {record.asset_name ? ` · ${record.asset_name}` : ""}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {new Date(record.assessed_at).toLocaleString()} ·{" "}
                  {record.assessed_by_name ?? "Staff"}
                  {record.is_current ? " · Current" : " · Historical"}
                </div>
                {record.note && <div className="mt-2 text-sm">{record.note}</div>}
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase ${record.status === "green" ? "bg-emerald-100 text-emerald-700" : record.status === "red" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}
              >
                {record.status}
              </span>
            </div>
          ))}
          {!records.length && (
            <p className="text-sm text-muted-foreground">No compliance assessments recorded yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
