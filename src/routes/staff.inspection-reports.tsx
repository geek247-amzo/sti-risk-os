import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, FileText, Loader2, RefreshCw, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/staff/inspection-reports")({ component: InspectionReports });

type Inspection = {
  id: string; template_name: string; template_category: string; asset_name: string; site_name: string;
  organization_name: string; completed_at: string; outcome: string; risk_level: string; status: string;
};
type ReportSummary = { id: string; title: string; status: string; summary: string; organization_name: string; site_name: string; created_at: string; overall_outcome: string; overall_risk_level: string };
type Finding = { id: string; location: string | null; issue_description: string; remediation_action: string | null; quantity: number | null; materials: string | null };
type Evidence = { id: string; file_name: string; location_text: string | null; gps_lat: number | null; gps_lng: number | null; inspection_item_response_id: string };
type ReportItem = { id: string; itemText: string; sansClause: string | null; outcome: string | null; comment: string | null; naReason: string | null; findings: Finding[]; evidence: Evidence[]; photoRequired: boolean; aiComplianceResult: "plausible_match" | "unclear" | "mismatch" | null; aiComplianceRationale: string | null };
type ReportBlock = { inspectionId: string; name: string; category: string; templateVersion: number; asset: { name: string; tag: string | null; type: string; manufacturer: string | null; model: string | null }; area: string | null; technicianName: string | null; startedAt: string; completedAt: string; riskLevel: string; computedRiskLevel: string; outcome: string; signature: { signerName: string; signedAt: string } | null; items: ReportItem[] };
type Report = { id: string; title: string; status: string; summary: string; organization: { name: string }; site: { name: string }; overallOutcome: string; overallRiskLevel: string; inspectionCount: number; generatedAt: string; blocks: ReportBlock[] };

const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold";

function InspectionReports() {
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const [inspectionResponse, reportResponse] = await Promise.all([fetch("/api/inspections?status=completed"), fetch("/api/inspection-reports")]);
    const [inspectionBody, reportBody] = await Promise.all([inspectionResponse.json(), reportResponse.json()]);
    if (!inspectionResponse.ok) throw new Error(inspectionBody.error ?? "Unable to load completed inspections");
    if (!reportResponse.ok) throw new Error(reportBody.error ?? "Unable to load reports");
    setInspections(inspectionBody.inspections ?? []); setReports(reportBody.reports ?? []);
  }
  useEffect(() => { load().catch((err) => setError(err instanceof Error ? err.message : "Unable to load reports")); }, []);

  const grouped = useMemo(() => inspections.reduce<Record<string, Inspection[]>>((groups, inspection) => { const key = `${inspection.organization_name} · ${inspection.site_name} · ${inspection.asset_name}`; groups[key] = [...(groups[key] ?? []), inspection]; return groups; }, {}), [inspections]);

  async function generate() {
    if (!selected.length) { setError("Select at least one completed inspection"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/inspection-reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inspectionIds: selected }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Unable to generate report");
      setReport(body.report); setNotice("Survey report generated from completed inspections."); setSelected([]); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to generate report"); }
    finally { setBusy(false); }
  }

  async function openReport(id: string) {
    setBusy(true); setError("");
    try { const response = await fetch(`/api/inspection-reports/${id}`); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Unable to open report"); setReport(body.report); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to open report"); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-6xl space-y-6 pb-12">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Site survey reporting</div><h1 className="text-2xl font-bold">Inspection reports</h1><p className="text-sm text-muted-foreground">Assemble completed checklist blocks into a SANS-referenced staff report.</p></div><button className={`${button} border border-border bg-surface`} onClick={() => load().catch((err) => setError(err instanceof Error ? err.message : "Unable to refresh"))}><RefreshCw className="h-4 w-4" /> Refresh</button></div>
    {error && <div className="whitespace-pre-line rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><AlertTriangle className="mr-2 inline h-4 w-4" />{error}</div>}
    {notice && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"><Check className="mr-2 inline h-4 w-4" />{notice}</div>}
    {!report && <>
      <section className="rounded-xl border border-border/60 bg-surface p-5 shadow-sm"><div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-semibold">Completed inspection blocks</h2><p className="text-sm text-muted-foreground">Select one asset visit or combine blocks from the same job.</p></div><button className={`${button} bg-brand-orange text-primary-foreground`} disabled={busy || !selected.length} onClick={generate}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Generate report ({selected.length})</button></div>{Object.entries(grouped).map(([group, rows]) => <div key={group} className="mb-5 last:mb-0"><div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</div><div className="space-y-2">{rows.map((inspection) => <label key={inspection.id} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-border bg-background p-3 hover:border-brand-orange"><input type="checkbox" className="h-5 w-5 accent-orange-600" checked={selected.includes(inspection.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, inspection.id] : current.filter((id) => id !== inspection.id))} /><span className="min-w-0 flex-1"><span className="block font-medium">{inspection.template_name}</span><span className="text-xs text-muted-foreground">{inspection.template_category} · completed {new Date(inspection.completed_at).toLocaleString()}</span></span><span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${inspection.outcome === "fail" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>{inspection.outcome} · {inspection.risk_level}</span></label>)}</div></div>)}{!inspections.length && <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No completed inspections are available yet.</div>}</section>
      <section className="rounded-xl border border-border/60 bg-surface p-5 shadow-sm"><h2 className="mb-4 font-semibold">Generated survey reports</h2><div className="space-y-2">{reports.map((item) => <button key={item.id} className="flex min-h-14 w-full items-center justify-between rounded-lg border border-border bg-background px-4 text-left hover:border-brand-orange" onClick={() => openReport(item.id)}><span><span className="block font-medium">{item.title}</span><span className="text-xs text-muted-foreground">{item.organization_name} · {item.site_name} · {new Date(item.created_at).toLocaleString()}</span></span><span className="text-xs font-semibold uppercase text-muted-foreground">{item.overall_outcome} · {item.overall_risk_level}</span></button>)}{!reports.length && <p className="text-sm text-muted-foreground">No survey reports generated yet.</p>}</div></section>
    </>}
    {report && <ReportView report={report} onBack={() => setReport(null)} />}
  </div>;
}

function ReportView({ report, onBack }: { report: Report; onBack: () => void }) {
  const groups = report.blocks.reduce<Record<string, ReportBlock[]>>((result, block) => { const key = `${block.category} · ${block.name}`; result[key] = [...(result[key] ?? []), block]; return result; }, {});
  return <div className="space-y-5"><button className={`${button} border border-border bg-surface`} onClick={onBack}>← Back to reports</button><header className="rounded-xl border border-border/60 bg-surface p-5 shadow-sm md:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Site survey report · {report.status}</div><h2 className="mt-1 text-2xl font-bold">{report.title}</h2><p className="mt-2 text-sm text-muted-foreground">{report.organization?.name ?? "Customer"} · {report.site?.name ?? "Site"}</p></div><div className="flex gap-2"><StatusBadge value={report.overallOutcome} /><StatusBadge value={`${report.overallRiskLevel} risk`} risk /></div></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><Summary label="Inspection blocks" value={report.inspectionCount} /><Summary label="Overall outcome" value={report.overallOutcome} /><Summary label="Overall risk" value={report.overallRiskLevel} /></div><p className="mt-4 text-xs text-muted-foreground">Generated {new Date(report.generatedAt).toLocaleString()} · Draft staff view · PDF export is deferred.</p></header>{Object.entries(groups).map(([group, blocks]) => <section key={group} className="space-y-3"><h3 className="border-b border-border pb-2 text-lg font-bold">{group}</h3>{blocks.map((block) => <InspectionBlock key={block.inspectionId} block={block} />)}</section>)}</div>;
}

function InspectionBlock({ block }: { block: ReportBlock }) { return <article className="rounded-xl border border-border/60 bg-surface shadow-sm"><div className="border-b border-border/60 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="text-lg font-semibold">{block.asset.name}</h4><p className="text-sm text-muted-foreground">{block.asset.tag ?? block.asset.type}{block.area ? ` · ${block.area}` : ""} · v{block.templateVersion}</p><p className="mt-1 text-xs text-muted-foreground">Technician: {block.technicianName ?? "—"} · {new Date(block.startedAt).toLocaleString()} → {new Date(block.completedAt).toLocaleString()}</p></div><div className="flex gap-2"><StatusBadge value={block.outcome} /><StatusBadge value={`${block.riskLevel} risk`} risk /></div></div>{block.signature && <p className="mt-3 text-xs text-emerald-700"><Check className="mr-1 inline h-3 w-3" />Signed by {block.signature.signerName} · {new Date(block.signature.signedAt).toLocaleString()}</p>}</div><div className="divide-y divide-border/50">{block.items.map((item) => <ReportItem key={item.id} item={item} />)}</div></article>; }

function ReportItem({ item }: { item: ReportItem }) { const complianceLabel = item.aiComplianceResult === "plausible_match" ? "AI evidence: plausible match" : item.aiComplianceResult === "mismatch" ? "AI evidence: mismatch" : item.aiComplianceResult === "unclear" ? "AI evidence: unclear" : null; return <div className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h5 className="font-medium">{item.itemText}</h5>{item.sansClause && <p className="text-xs text-muted-foreground">SANS 10139 · clause {item.sansClause}</p>}</div><div className="flex flex-wrap gap-2">{complianceLabel && <span title={item.aiComplianceRationale ?? undefined} className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${item.aiComplianceResult === "mismatch" ? "bg-red-100 text-red-700" : item.aiComplianceResult === "plausible_match" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{complianceLabel}</span>}<StatusBadge value={item.outcome ?? "not answered"} /></div></div>{item.comment && <div className="mt-3 rounded-md bg-background p-3 text-sm"><span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Technician comment</span><p className="mt-1 whitespace-pre-wrap">{item.comment}</p></div>}{item.naReason && <p className="mt-2 text-xs text-muted-foreground">N/A reason: {item.naReason}</p>}{item.findings.length > 0 && <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-800"><ShieldAlert className="h-4 w-4" /> Structured findings</div><div className="mt-2 space-y-2">{item.findings.map((finding) => <div key={finding.id} className="text-sm text-amber-950"><div className="font-medium">{finding.issue_description}</div><div className="text-xs">{finding.location ? `Location: ${finding.location} · ` : ""}{finding.remediation_action ?? "Remediation not specified"}{finding.quantity !== null ? ` · Qty ${finding.quantity}` : ""}{finding.materials ? ` · ${finding.materials}` : ""}</div></div>)}</div></div>}{item.evidence.length > 0 && <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{item.evidence.map((photo) => <figure key={photo.id} className="overflow-hidden rounded-lg border border-border bg-background"><img src={`/api/inspection-evidence/${photo.id}`} alt={photo.location_text ?? photo.file_name} className="aspect-video w-full object-cover" /><figcaption className="p-2 text-xs text-muted-foreground">{photo.location_text ?? photo.file_name}{photo.gps_lat !== null ? ` · GPS ${Number(photo.gps_lat).toFixed(4)}, ${Number(photo.gps_lng).toFixed(4)}` : ""}</figcaption></figure>)}</div>}{item.photoRequired && item.evidence.length === 0 && <p className="mt-3 text-xs font-medium text-amber-700">Photo required but no evidence is attached.</p>}</div>; }

function StatusBadge({ value, risk = false }: { value: string; risk?: boolean }) { const danger = value === "fail" || value === "defective" || value === "critical" || value === "high risk"; return <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${danger ? "bg-red-100 text-red-700" : value === "pass" || value === "ok" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>{value}</span>; }
function Summary({ label, value }: { label: string; value: string | number }) { return <div className="rounded-lg border border-border bg-background p-3"><div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 text-lg font-bold capitalize">{value}</div></div>; }
