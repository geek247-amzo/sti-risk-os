import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, Printer } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

export const Route = createFileRoute("/staff/project-sticker")({ component: ProjectSticker });

type Project = { id: string; name: string; organization_name: string | null };
type Sticker = {
  project: { name: string; status: string; organization_name: string | null };
  sites: Array<{ name: string; address: string | null }>;
  aggregateState: "red" | "yellow" | "green" | "not_yet_assessed";
  issuedAt: string;
  revision: number;
  qrUrl: string;
  instructions: string;
};

const stateLabel: Record<Sticker["aggregateState"], string> = {
  red: "RED — NON-COMPLIANT",
  yellow: "YELLOW — WORK IN PROGRESS",
  green: "GREEN — COMPLIANT",
  not_yet_assessed: "NOT YET ASSESSED",
};
const stateClass: Record<Sticker["aggregateState"], string> = {
  red: "border-red-700 bg-red-600 text-white",
  yellow: "border-yellow-600 bg-yellow-300 text-black",
  green: "border-green-700 bg-green-600 text-white",
  not_yet_assessed: "border-slate-500 bg-slate-200 text-slate-900",
};

function ProjectSticker() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [sticker, setSticker] = useState<Sticker | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/projects")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error);
        setProjects(body.projects ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load projects"));
  }, []);
  async function generate() {
    setError("");
    const r = await fetch(`/api/projects/${projectId}/sticker`, { method: "POST" });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error);
    setSticker(body.sticker);
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12 print-page">
      <style>{`@media print { .no-print { display:none !important } .print-page { max-width:none !important; padding:0 !important } }`}</style>
      <div className="no-print">
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Project QR</div>
        <h1 className="text-2xl font-bold">Printable project sticker</h1>
        <p className="text-sm text-muted-foreground">
          Each generation records the next print revision.
        </p>
      </div>
      <div className="no-print flex gap-2">
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="h-11 flex-1 rounded-md border border-border bg-background px-3 text-sm"
        >
          <option value="">Select project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name} · {project.organization_name ?? "Unassigned"}
            </option>
          ))}
        </select>
        <button
          disabled={!projectId}
          onClick={() =>
            generate().catch((e) =>
              setError(e instanceof Error ? e.message : "Unable to generate sticker"),
            )
          }
          className="inline-flex h-11 items-center gap-2 rounded-md bg-brand-orange px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          <Printer className="h-4 w-4" /> Generate
        </button>
      </div>
      {error && (
        <div className="no-print rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      )}
      {sticker && (
        <>
          <div className="no-print flex justify-end">
            <button
              onClick={() => window.print()}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-semibold"
            >
              <Printer className="h-4 w-4" /> Print sticker
            </button>
          </div>
          <section className="mx-auto max-w-xl border-4 border-black bg-white p-8 text-black shadow-sm">
            <div className="flex items-start justify-between gap-5 border-b-2 border-black pb-5">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.2em]">
                  STI Risk Operating OS
                </div>
                <h2 className="mt-2 text-3xl font-black">{sticker.project.name}</h2>
                <p className="mt-1 text-sm">{sticker.project.organization_name ?? ""}</p>
                {sticker.sites.map((site) => (
                  <p key={site.name} className="text-sm">
                    {site.name}
                    {site.address ? ` · ${site.address}` : ""}
                  </p>
                ))}
              </div>
              <QRCodeSVG value={sticker.qrUrl} size={150} level="M" />
            </div>
            <div
              className={`mt-6 border-2 px-4 py-5 text-center text-xl font-black ${stateClass[sticker.aggregateState]}`}
            >
              {stateLabel[sticker.aggregateState]}
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 border-t border-black pt-4 text-sm">
              <div>
                <b>Issued:</b> {new Date(sticker.issuedAt).toLocaleString()}
              </div>
              <div>
                <b>Revision:</b> {sticker.revision}
              </div>
            </div>
            <p className="mt-5 border-t border-black pt-4 text-center text-sm font-semibold">
              {sticker.instructions}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
