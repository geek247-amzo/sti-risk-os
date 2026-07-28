import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Camera, CheckCircle2, Loader2, ShieldAlert, Upload } from "lucide-react";

export const Route = createFileRoute("/staff/vusi-tools")({ component: VusiToolsSansScan });

type Item = {
  id: string;
  standard_code: string;
  setting: string;
  requirement_description: string;
  is_red_flag: boolean;
};
type Result = Item & { score: "met" | "not_met" | "unclear"; gemini_rationale: string };

const settingLabels = {
  shared: "Shared / common area",
  industrial: "Industrial area",
  server_room: "Server room",
  corporate: "Corporate office",
};

function VusiToolsSansScan() {
  const [items, setItems] = useState<Item[]>([]);
  const [siteVisits, setSiteVisits] = useState<
    { id: string; site_name: string; started_at: string }[]
  >([]);
  const [setting, setSetting] = useState("shared");
  const [siteVisitId, setSiteVisitId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/vusi-tools/sans-scan");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Unable to load Vusi Tools");
    setItems(body.items ?? []);
    setSiteVisits(body.siteVisits ?? []);
  }
  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Unable to load Vusi Tools"));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!files.length) {
      setError("Add at least one photo before scanning.");
      return;
    }
    setBusy(true);
    setError("");
    setResults([]);
    const form = new FormData();
    form.set("setting", setting);
    if (siteVisitId) form.set("siteVisitId", siteVisitId);
    files.forEach((file) => form.append("files", file));
    try {
      const response = await fetch("/api/vusi-tools/sans-scan", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Scan failed");
      setResults(body.results ?? []);
      setFiles([]);
      const input = document.getElementById("vusi-sans-files") as HTMLInputElement | null;
      if (input) input.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setBusy(false);
    }
  }

  const redFlags = results.filter((r) => r.is_red_flag && r.score === "not_met");
  const counts = {
    met: results.filter((r) => r.score === "met").length,
    not_met: results.filter((r) => r.score === "not_met").length,
    unclear: results.filter((r) => r.score === "unclear").length,
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Vusi Tools · Advisory
          </div>
          <h1 className="text-2xl font-bold">SANS Fire Compliance Photo Scan</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Photograph a room or area for an immediate visual read. This is context for on-site
            efficiency, not a signed-off inspection or asset record.
          </p>
        </div>
        <Link
          to="/staff/vusi-tools/findings-report"
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-brand-blue/30 bg-brand-blue/5 px-3 py-2 text-sm font-semibold text-brand-blue hover:bg-brand-blue/10"
        >
          Open Area Findings Report
        </Link>
      </div>
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}
      <form
        onSubmit={(e) => void submit(e)}
        className="grid gap-5 rounded-xl border border-border/60 bg-white p-5 shadow-sm"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">
            What kind of space is this?
            <select
              className="h-11 rounded-md border border-border bg-background px-3 font-normal"
              value={setting}
              onChange={(e) => setSetting(e.target.value)}
            >
              {Object.entries(settingLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Link to active site visit{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
              <select
                className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3"
                value={siteVisitId}
                onChange={(e) => setSiteVisitId(e.target.value)}
              >
                <option value="">No site visit link</option>
                {siteVisits.map((visit) => (
                  <option key={visit.id} value={visit.id}>
                    {visit.site_name} · {new Date(visit.started_at).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </div>
        <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-brand-blue/30 bg-brand-blue/5 p-5 text-center">
          <Camera className="h-7 w-7 text-brand-blue" />
          <span className="font-semibold">Take or choose photos</span>
          <span className="text-xs text-muted-foreground">
            Use several wide and close-up views. Up to 10 photos, 20MB each.
          </span>
          <input
            id="vusi-sans-files"
            className="sr-only"
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </label>
        {files.length > 0 && (
          <div className="text-sm text-muted-foreground">
            {files.length} photo(s) ready: {files.map((f) => f.name).join(", ")}
          </div>
        )}
        <button
          disabled={busy || !files.length}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-brand-orange px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Scanning…
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" />
              Run advisory scan
            </>
          )}
        </button>
      </form>
      {results.length > 0 && (
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-white p-4">
              <div className="text-2xl font-bold">{results.length}</div>
              <div className="text-xs text-muted-foreground">Items checked</div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-2xl font-bold text-emerald-700">{counts.met}</div>
              <div className="text-xs text-emerald-700">Visually met</div>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="text-2xl font-bold text-red-700">{counts.not_met}</div>
              <div className="text-xs text-red-700">Gaps flagged</div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="text-2xl font-bold text-amber-700">{counts.unclear}</div>
              <div className="text-xs text-amber-700">Unclear</div>
            </div>
          </div>
          {redFlags.length > 0 && (
            <div className="rounded-xl border border-red-300 bg-red-50 p-5">
              <div className="flex items-center gap-2 font-bold text-red-800">
                <ShieldAlert className="h-5 w-5" />
                Red flags first
              </div>
              <div className="mt-3 space-y-3">
                {redFlags.map((r) => (
                  <ResultRow key={r.id} result={r} />
                ))}
              </div>
            </div>
          )}
          <div className="rounded-xl border border-border/60 bg-white p-5">
            <h2 className="font-bold">Full visual read</h2>
            <div className="mt-3 divide-y divide-border/60">
              {results
                .filter((r) => !redFlags.includes(r))
                .map((r) => (
                  <ResultRow key={r.id} result={r} />
                ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Advisory only. Confirm any concern through a formal inspection before relying on it for
            certification, quotation, or compliance sign-off.
          </p>
        </section>
      )}
      {!results.length && items.length > 0 && (
        <div className="rounded-lg border border-border/60 bg-surface p-4 text-sm text-muted-foreground">
          This scan will check{" "}
          {items.filter((i) => i.setting === "shared" || i.setting === setting).length} visual rules
          for the selected setting, with red flags prioritised.
        </div>
      )}
    </div>
  );
}

function ResultRow({ result }: { result: Result }) {
  const styles = { met: "text-emerald-700", not_met: "text-red-700", unclear: "text-amber-700" };
  const labels = { met: "Met", not_met: "Not met", unclear: "Unclear" };
  return (
    <div className="flex gap-3 py-3">
      <CheckCircle2 className={`mt-0.5 h-5 w-5 shrink-0 ${styles[result.score]}`} />
      <div>
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <span>{labels[result.score]}</span>
          <span className="font-normal text-muted-foreground">{result.standard_code}</span>
        </div>
        <div className="text-sm">{result.requirement_description}</div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">
          {result.gemini_rationale}
        </div>
      </div>
    </div>
  );
}
