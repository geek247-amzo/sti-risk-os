import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, FileText, Loader2, Printer, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/staff/consulting-reports")({ component: ConsultingReports });

type Stage = {
  id: string;
  stage_type: string;
  tier: string;
  status: string;
  organization_name: string;
  site_name: string;
  report_title: string | null;
  service_report_id: string | null;
  created_at: string;
};
type Report = {
  id: string;
  title: string;
  status: string;
  organization: { name: string };
  site: { name: string };
  container: { name: string };
  project: { name: string } | null;
  workItem: { title: string; status: string; scope: string | null; work_type: string | null } | null;
  stage: {
    stageType: string;
    tier: string;
    status: string;
    priceCents: number | null;
    currency: string;
  };
  siteVisit: {
    captureMode: string;
    status: string;
    notes: string | null;
    startedAt: string;
    submittedAt: string | null;
  };
  area: {
    name: string;
    standard_name: string | null;
    client_local_name: string | null;
    custom_area_text: string | null;
  } | null;
  measurements: Array<Record<string, unknown>>;
  assets: Array<Record<string, unknown>>;
  evidence: Array<{
    id: string;
    file_name: string;
    mime_type: string | null;
    evidence_type: string;
    notes: string | null;
    location_text: string | null;
    capture_phase: "before" | "during" | "after" | null;
  }>;
  evidenceByPhase: Record<string, Report["evidence"]>;
  structuredFindings: Array<{
    id: string;
    noteType: string;
    itemText: string;
    location: string | null;
    issueDescription: string;
    remediationAction: string | null;
    quantity: number | null;
    materials: string | null;
    riskLevel: string | null;
  }>;
  assembly: { pricingVisibility: string };
};
const button =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold";

function ConsultingReports() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    const response = await fetch("/api/consulting-stages");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Unable to load stages");
    setStages(body.stages ?? []);
  }
  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Unable to load stages"));
  }, []);
  async function openReport(id: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/consulting-reports/${id}`);
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setReport(b.report);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to open report");
    } finally {
      setBusy(false);
    }
  }
  async function generate(stageId: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/consulting-stages/${stageId}/report`, { method: "POST" });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setReport(b.report);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to generate report");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12 print-page">
      <style>{`@media print { .no-print { display:none !important } .print-page { max-width:none !important; padding:0 !important } }`}</style>
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Consulting & solutioning
          </div>
          <h1 className="text-2xl font-bold">Consulting reports</h1>
          <p className="text-sm text-muted-foreground">
            Generate a draft report from a structured site visit.
          </p>
        </div>
        <button
          className={`${button} border border-border bg-surface`}
          onClick={() =>
            load().catch((e) => setError(e instanceof Error ? e.message : "Unable to refresh"))
          }
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>
      {error && (
        <div className="no-print rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      )}
      {!report && (
        <section className="no-print rounded-xl border border-border/60 bg-surface p-5 shadow-sm">
          <h2 className="mb-4 font-semibold">Billable stages</h2>
          {stages.map((stage) => (
            <div
              key={stage.id}
              className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background p-3"
            >
              <div>
                <div className="font-medium">
                  {stage.organization_name} · {stage.site_name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {stage.stage_type} · {stage.tier} · {stage.status}
                </div>
              </div>
              <div className="flex gap-2">
                {stage.service_report_id && (
                  <button
                    className={`${button} border border-border`}
                    disabled={busy}
                    onClick={() => openReport(stage.service_report_id!)}
                  >
                    <FileText className="h-4 w-4" /> View report
                  </button>
                )}
                <button
                  className={`${button} bg-brand-orange text-primary-foreground`}
                  disabled={busy}
                  onClick={() => generate(stage.id)}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileText className="h-4 w-4" />
                  )}{" "}
                  {stage.service_report_id ? "Regenerate" : "Generate report"}
                </button>
              </div>
            </div>
          ))}
          {!stages.length && (
            <p className="text-sm text-muted-foreground">
              No consulting or solutioning stages exist yet.
            </p>
          )}
        </section>
      )}
      {report && <ConsultingReport report={report} onBack={() => setReport(null)} />}
    </div>
  );
}

function ConsultingReport({ report, onBack }: { report: Report; onBack: () => void }) {
  return (
    <article className="space-y-5">
      <div className="no-print flex flex-wrap gap-2">
        <button className={`${button} border border-border bg-surface`} onClick={onBack}>
          ← Back
        </button>
        <button
          className={`${button} border border-border bg-surface`}
          onClick={() => window.print()}
        >
          <Printer className="h-4 w-4" /> Print / Save PDF
        </button>
      </div>
      <header className="rounded-xl border border-border/60 bg-surface p-6 shadow-sm">
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Draft consulting report
        </div>
        <h2 className="mt-1 text-2xl font-bold">{report.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {report.organization.name} · {report.site.name} · Container: {report.container.name}
          {report.project ? ` · ${report.project.name}` : ""}
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <Summary label="Stage" value={`${report.stage.stageType} · ${report.stage.tier}`} />
          <Summary label="Status" value={report.stage.status} />
          <Summary label="Visit" value={report.siteVisit.status} />
          <Summary label="Evidence" value={report.evidence.length} />
        </div>
        {report.workItem && (
          <div className="mt-4 rounded-lg border border-border bg-background p-3 text-sm">
            <span className="font-semibold">Work item:</span> {report.workItem.title} · {report.workItem.status}
            {report.workItem.scope ? ` · ${report.workItem.scope}` : ""}
          </div>
        )}
      </header>
      <section className="rounded-xl border border-border/60 bg-surface p-6 shadow-sm">
        <h3 className="mb-3 text-lg font-bold">Site visit</h3>
        <p className="text-sm">
          Capture mode: {report.siteVisit.captureMode} · Started{" "}
          {new Date(report.siteVisit.startedAt).toLocaleString()}
        </p>
        {report.siteVisit.notes && (
          <p className="mt-3 whitespace-pre-wrap text-sm">{report.siteVisit.notes}</p>
        )}
        {report.area && (
          <div className="mt-4 rounded-lg border border-border bg-background p-4">
            <div className="font-semibold">{report.area.name}</div>
            <div className="text-sm text-muted-foreground">
              Standard: {report.area.standard_name ?? "—"} · Client name:{" "}
              {report.area.client_local_name ?? "—"} · Custom: {report.area.custom_area_text ?? "—"}
            </div>
          </div>
        )}
      </section>
      <section className="rounded-xl border border-border/60 bg-surface p-6 shadow-sm">
        <h3 className="mb-3 text-lg font-bold">Assets and measurements</h3>
        {report.assets.length ? (
          <div className="space-y-2">
            {report.assets.map((asset, i) => (
              <div
                key={String(asset.id ?? i)}
                className="rounded-lg border border-border bg-background p-3 text-sm"
              >
                <span className="font-medium">
                  {String(asset.name ?? asset.asset_type ?? "Asset")}
                </span>{" "}
                · {String(asset.technology_name ?? asset.asset_type ?? "Technology")}{" "}
                {asset.manufacturer ? `· ${String(asset.manufacturer)}` : ""}{" "}
                {asset.model ? `· ${String(asset.model)}` : ""}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No assets recorded for this visit area.</p>
        )}
        {report.measurements.length > 0 && (
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {Object.entries(report.measurements[0])
              .filter(
                ([key, value]) =>
                  !["id", "area_id", "site_visit_id", "created_at", "updated_at"].includes(key) &&
                  value !== null,
              )
              .map(([key, value]) => (
                <Summary key={key} label={key.replaceAll("_", " ")} value={String(value)} />
              ))}
          </div>
        )}
      </section>
      <section className="rounded-xl border border-border/60 bg-surface p-6 shadow-sm">
        <h3 className="mb-3 text-lg font-bold">Evidence by phase</h3>
        {report.evidence.length ? (
          <div className="grid gap-4 md:grid-cols-3">
            {["before", "during", "after"].map((phase) => (
              <div key={phase} className="rounded-lg border border-border bg-background p-3">
                <h4 className="mb-2 text-sm font-semibold capitalize">{phase}</h4>
                {(report.evidenceByPhase[phase] ?? []).length ? (
                  <div className="space-y-2">
                    {(report.evidenceByPhase[phase] ?? []).map((file) => (
                      <div key={file.id} className="text-sm">
                        <div className="font-medium">{file.file_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {file.evidence_type}{file.location_text ? ` · ${file.location_text}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-xs text-muted-foreground">No evidence.</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No evidence attached.</p>
        )}
      </section>
      <section className="rounded-xl border border-border/60 bg-surface p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold">Structured findings</h3>
          <span className="text-xs text-muted-foreground">Pricing: {report.assembly.pricingVisibility.replaceAll("_", " ")}</span>
        </div>
        {report.structuredFindings.length ? (
          <div className="mt-3 space-y-3">
            {report.structuredFindings.map((finding) => (
              <div key={finding.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-semibold">{finding.noteType}: {finding.issueDescription}</span>
                  {finding.riskLevel && <span className="text-xs font-semibold uppercase">{finding.riskLevel} risk</span>}
                </div>
                <div className="mt-1 text-xs text-amber-950">
                  {finding.location ? `Location: ${finding.location} · ` : ""}
                  {finding.remediationAction ?? "Remediation not specified"}
                  {finding.quantity !== null ? ` · Qty ${finding.quantity}` : ""}
                  {finding.materials ? ` · ${finding.materials}` : ""}
                </div>
              </div>
            ))}
          </div>
        ) : <p className="mt-3 text-sm text-muted-foreground">No structured findings attached.</p>}
      </section>
    </article>
  );
}
function Summary({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-bold capitalize">{value}</div>
    </div>
  );
}
