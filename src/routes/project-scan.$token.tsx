import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

export const Route = createFileRoute("/project-scan/$token")({ component: ProjectScan });
type RecordRow = {
  id: string;
  status: "green" | "red" | "yellow";
  note: string | null;
  area_name: string;
  asset_name: string | null;
  assessed_at: string;
};
type Data = { project: { name: string; status: string }; complianceRecords: RecordRow[] };

function ProjectScan() {
  const { token } = Route.useParams();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch(`/api/project-scan/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error);
        setData(b);
      })
      .catch(() => setError(true));
  }, [token]);
  if (error)
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-600" />
          <h1 className="mt-4 text-xl font-bold">Project view not available</h1>
          <p className="mt-2 text-sm text-slate-600">
            This QR code is inactive or access has not been granted.
          </p>
        </div>
      </main>
    );
  if (!data)
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6 text-sm text-slate-600">
        Loading project view…
      </main>
    );
  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="rounded-xl bg-slate-900 p-6 text-white">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-300">
            STI Risk project record
          </div>
          <h1 className="mt-2 text-2xl font-bold">{data.project.name}</h1>
          <p className="mt-2 text-sm text-slate-300">
            Read-only compliance history · Project status: {data.project.status}
          </p>
        </header>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Compliance history</h2>
          <div className="mt-4 space-y-3">
            {data.complianceRecords.map((record) => (
              <div
                key={record.id}
                className="flex items-start gap-3 rounded-lg border border-slate-200 p-4"
              >
                <StateIcon status={record.status} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {record.area_name}
                    {record.asset_name ? ` · ${record.asset_name}` : ""}
                  </div>
                  <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">
                    {record.status} · {new Date(record.assessed_at).toLocaleString()}
                  </div>
                  {record.note && (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{record.note}</p>
                  )}
                </div>
              </div>
            ))}
            {!data.complianceRecords.length && (
              <p className="text-sm text-slate-600">
                No compliance assessments have been linked to this project yet.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
function StateIcon({ status }: { status: RecordRow["status"] }) {
  return status === "green" ? (
    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
  ) : status === "red" ? (
    <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
  ) : (
    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
  );
}
