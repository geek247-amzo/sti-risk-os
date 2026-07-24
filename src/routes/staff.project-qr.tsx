import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Copy, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

export const Route = createFileRoute("/staff/project-qr")({ component: ProjectQr });
type Project = { id: string; name: string; organization_name: string | null };
type Identity = { id: string; status: string; created_at: string };
type Grant = { id: string; grantee_type: string; grantee_label: string; status: string };

function ProjectQr() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [url, setUrl] = useState("");
  const [grants, setGrants] = useState<Grant[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function loadProjects() {
    const r = await fetch("/api/projects");
    const b = await r.json();
    if (!r.ok) throw new Error(b.error);
    setProjects(b.projects ?? []);
  }
  async function loadProject(id: string) {
    setProjectId(id);
    setUrl("");
    if (!id) {
      setIdentity(null);
      setGrants([]);
      return;
    }
    const r = await fetch(`/api/projects/${id}/qr`);
    const b = await r.json();
    if (!r.ok) throw new Error(b.error);
    setIdentity(b.identities?.find((item: Identity) => item.status === "active") ?? null);
    setGrants(b.grants ?? []);
  }
  useEffect(() => {
    loadProjects().catch((e) =>
      setError(e instanceof Error ? e.message : "Unable to load projects"),
    );
  }, []);
  async function qrAction(action: "create" | "rotate") {
    const r = await fetch(`/api/projects/${projectId}/qr`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error);
    setUrl(b.url);
    setIdentity(b.identity);
    setNotice(
      action === "rotate" ? "QR rotated; the previous code is revoked." : "QR identity created.",
    );
  }
  async function revokeQr() {
    if (!identity) return;
    const r = await fetch(`/api/project-qr-identities/${identity.id}/revoke`, { method: "POST" });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error);
    setIdentity(null);
    setUrl("");
    setNotice("QR identity revoked.");
  }
  async function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    const r = await fetch(`/api/projects/${projectId}/access-grants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error);
    event.currentTarget.reset();
    setGrants((current) => [b.grant, ...current]);
    setNotice("Access grant created.");
  }
  async function revokeGrant(id: string) {
    const r = await fetch(`/api/project-access-grants/${id}/revoke`, { method: "POST" });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error);
    setGrants((current) =>
      current.map((grant) => (grant.id === id ? { ...grant, status: "revoked" } : grant)),
    );
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Project identity
        </div>
        <h1 className="text-2xl font-bold">Project QR access</h1>
        <p className="text-sm text-muted-foreground">
          QR identity and third-party read access are managed independently.
        </p>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      )}
      <section className="rounded-xl border border-border/60 bg-surface p-5 shadow-sm">
        <select
          value={projectId}
          onChange={(e) =>
            loadProject(e.target.value).catch((err) =>
              setError(err instanceof Error ? err.message : "Unable to load project"),
            )
          }
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
        >
          <option value="">Select project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name} · {project.organization_name ?? "Unassigned"}
            </option>
          ))}
        </select>
        {projectId && (
          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_260px]">
            <div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() =>
                    qrAction(identity ? "rotate" : "create").catch((e) =>
                      setError(e instanceof Error ? e.message : "Unable to create QR"),
                    )
                  }
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-brand-orange px-4 text-sm font-semibold text-primary-foreground"
                >
                  <QrCode className="h-4 w-4" />
                  {identity ? "Rotate QR" : "Create QR"}
                </button>
                {identity && (
                  <button
                    onClick={() =>
                      revokeQr().catch((e) =>
                        setError(e instanceof Error ? e.message : "Unable to revoke QR"),
                      )
                    }
                    className="h-10 rounded-md border border-destructive/40 px-4 text-sm text-destructive"
                  >
                    Revoke
                  </button>
                )}
              </div>
              {url && (
                <div className="mt-4 rounded-lg border border-border bg-background p-3 text-sm">
                  <div className="break-all">{url}</div>
                  <button
                    className="mt-2 inline-flex items-center gap-1 text-xs text-brand-blue"
                    onClick={() => navigator.clipboard.writeText(url)}
                  >
                    <Copy className="h-3 w-3" /> Copy URL
                  </button>
                </div>
              )}
              <form onSubmit={grant} className="mt-6 grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]">
                <input
                  name="granteeType"
                  required
                  placeholder="Grantee type"
                  className="h-10 rounded-md border border-border bg-background px-3 text-sm"
                />
                <input
                  name="granteeLabel"
                  required
                  placeholder="Grantee label / company"
                  className="h-10 rounded-md border border-border bg-background px-3 text-sm"
                />
                <button className="h-10 rounded-md border border-border px-3 text-sm">
                  Grant access
                </button>
              </form>
              <div className="mt-4 space-y-2">
                {grants.map((grant) => (
                  <div
                    key={grant.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
                  >
                    <span>
                      {grant.grantee_label} · {grant.grantee_type} · {grant.status}
                    </span>
                    {grant.status === "active" && (
                      <button
                        onClick={() =>
                          revokeGrant(grant.id).catch((e) =>
                            setError(e instanceof Error ? e.message : "Unable to revoke grant"),
                          )
                        }
                        className="text-xs text-destructive"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {url && (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-white p-4">
                <QRCodeSVG value={url} size={210} />
                <span className="text-xs text-muted-foreground">Print via browser</span>
              </div>
            )}
          </div>
        )}
      </section>
      {notice && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}
    </div>
  );
}
