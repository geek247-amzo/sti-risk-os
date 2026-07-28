import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Camera, Loader2, Upload } from "lucide-react";

export const Route = createFileRoute("/staff/vusi-tools/findings-report")({
  component: VusiImageFindingsReport,
});

type Finding = {
  id: string;
  finding_description: string;
  sans_reference: string | null;
  severity: "info" | "minor" | "moderate" | "critical";
  gemini_rationale: string;
};
type SiteVisit = { id: string; site_name: string; started_at: string };

const severityOrder = { critical: 0, moderate: 1, minor: 2, info: 3 };
const severityStyles = {
  critical: "border-red-200 bg-red-50 text-red-800",
  moderate: "border-orange-200 bg-orange-50 text-orange-800",
  minor: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-slate-200 bg-slate-50 text-slate-700",
};

function VusiImageFindingsReport() {
  const [siteVisits, setSiteVisits] = useState<SiteVisit[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [locationNote, setLocationNote] = useState("");
  const [siteVisitId, setSiteVisitId] = useState("");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch("/api/vusi-tools/findings-report")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Unable to load site visits");
        setSiteVisits(body.siteVisits ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load site visits"));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Choose one image before generating the report.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    setFindings([]);
    const form = new FormData();
    form.append("file", file);
    if (locationNote.trim()) form.set("locationNote", locationNote.trim());
    if (siteVisitId) form.set("siteVisitId", siteVisitId);
    try {
      const response = await fetch("/api/vusi-tools/findings-report", {
        method: "POST",
        body: form,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to generate report");
      setFindings(body.findings ?? []);
      setNotice(
        body.findings?.length ? "Report generated." : "No visually evident issues were identified.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate report");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Vusi Tools · Advisory
        </div>
        <h1 className="text-2xl font-bold">SANS Area Findings Report</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Upload one photo and Gemini will identify visible safety or SANS-relevant issues without
          being limited to a fixed checklist. This is context for on-site efficiency, not a formal
          inspection or certification.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      <form
        onSubmit={(event) => void submit(event)}
        className="grid gap-5 rounded-xl border border-border/60 bg-white p-5 shadow-sm"
      >
        <label className="grid gap-2 text-sm font-medium">
          Location note <span className="font-normal text-muted-foreground">(optional)</span>
          <input
            className="h-11 rounded-md border border-border bg-background px-3 font-normal"
            placeholder="e.g. server room, north wall"
            value={locationNote}
            onChange={(event) => setLocationNote(event.target.value)}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Link to active site visit{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
          <select
            className="h-11 rounded-md border border-border bg-background px-3 font-normal"
            value={siteVisitId}
            onChange={(event) => setSiteVisitId(event.target.value)}
          >
            <option value="">No site visit link</option>
            {siteVisits.map((visit) => (
              <option key={visit.id} value={visit.id}>
                {visit.site_name} · {new Date(visit.started_at).toLocaleDateString()}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-brand-blue/30 bg-brand-blue/5 p-5 text-center">
          <Camera className="h-7 w-7 text-brand-blue" />
          <span className="font-semibold">Take or choose one photo</span>
          <span className="text-xs text-muted-foreground">
            The report is intentionally single-image.
          </span>
          <input
            className="sr-only"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        {file && <div className="text-sm text-muted-foreground">Ready: {file.name}</div>}
        <button
          disabled={busy || !file}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-brand-orange px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating report…
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" />
              Generate findings report
            </>
          )}
        </button>
      </form>

      {findings.length > 0 && (
        <section className="rounded-xl border border-border/60 bg-white p-5 shadow-sm">
          <h2 className="font-bold">Visible findings</h2>
          <div className="mt-3 space-y-3">
            {[...findings]
              .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
              .map((finding) => (
                <article
                  key={finding.id}
                  className={`rounded-lg border p-4 ${severityStyles[finding.severity]}`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wide">
                    <span>{finding.severity}</span>
                    {finding.sans_reference && (
                      <span className="font-normal normal-case tracking-normal">
                        {finding.sans_reference}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-sm font-semibold">{finding.finding_description}</div>
                  <div className="mt-1 text-xs leading-5 opacity-80">
                    {finding.gemini_rationale}
                  </div>
                </article>
              ))}
          </div>
        </section>
      )}
      <p className="text-xs text-muted-foreground">
        Confirm any concern through a formal inspection before relying on it for certification,
        quotation, or compliance sign-off.
      </p>
    </div>
  );
}
