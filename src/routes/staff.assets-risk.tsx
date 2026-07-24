import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import type { ReactNode } from "react";
import { Bot, Building2, Layers3, MapPinned, Plus, ShieldAlert, Siren, Wrench } from "lucide-react";

export const Route = createFileRoute("/staff/assets-risk")({
  component: AssetsRisk,
});

function AssetsRisk() {
  const [data, setData] = useState<{
    sites: { id: string; name: string; organization_name: string; organization_id?: string; open_risks: number; assets: number }[];
    risks: { id: string; title: string; severity: string; status: string; organization_name: string | null }[];
  }>({ sites: [], risks: [] });
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [showSiteForm, setShowSiteForm] = useState(false);
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [showRiskForm, setShowRiskForm] = useState(false);
  const [notice, setNotice] = useState("");

  async function load() {
    const [assetResponse, clientResponse] = await Promise.all([
      fetch("/api/assets-risk"),
      fetch("/api/clients"),
    ]);
    const [assetBody, clientBody] = await Promise.all([assetResponse.json(), clientResponse.json()]);
    setData({ sites: assetBody.sites ?? [], risks: assetBody.risks ?? [] });
    setClients(clientBody.clients ?? []);
  }

  useEffect(() => {
    load()
      .catch(() => setData({ sites: [], risks: [] }));
  }, []);

  async function submit(endpoint: string, form: HTMLFormElement, message: string) {
    setNotice("");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? message);
    form.reset();
    setNotice(message);
    await load();
  }

  async function createSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submit("/api/assets-risk/sites", event.currentTarget, "Site saved.");
    setShowSiteForm(false);
  }

  async function createAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submit("/api/assets-risk/assets", event.currentTarget, "Asset saved.");
    setShowAssetForm(false);
  }

  async function createRisk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submit("/api/assets-risk/risks", event.currentTarget, "Risk saved.");
    setShowRiskForm(false);
  }

  const hierarchy = [
    { label: "Site", icon: MapPinned },
    { label: "Building", icon: Building2 },
    { label: "Floor / area", icon: Layers3 },
    { label: "Room / zone", icon: Layers3 },
    { label: "Asset / panel / device", icon: Wrench },
    { label: "Risk / recommendation", icon: Siren },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Fire intelligence foundation
          </div>
          <h1 className="text-2xl font-bold">Assets & Risk</h1>
          <p className="text-sm text-muted-foreground">
            The site, building, area, asset, compatibility, recommendation, and risk register layer.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowSiteForm((v) => !v)} className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2">
            <Plus className="h-4 w-4" /> Site
          </button>
          <button onClick={() => setShowAssetForm((v) => !v)} className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2">
            <Plus className="h-4 w-4" /> Asset
          </button>
          <button onClick={() => setShowRiskForm((v) => !v)} className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110">
            <ShieldAlert className="h-4 w-4" /> Risk
          </button>
          <Link
            to="/staff/steve"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            <Bot className="h-4 w-4" /> Find risk history
          </Link>
        </div>
      </div>

      {notice && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      {showSiteForm && (
        <AssetForm onSubmit={createSite}>
          <ClientSelect clients={clients} />
          <input name="name" required placeholder="Site name" className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange" />
          <input name="address" placeholder="Address" className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange md:col-span-2" />
          <button className="h-10 rounded-md bg-brand-orange px-4 text-sm font-semibold text-primary-foreground">Save site</button>
        </AssetForm>
      )}

      {showAssetForm && (
        <AssetForm onSubmit={createAsset}>
          <SiteSelect sites={data.sites} />
          <input name="name" required placeholder="Asset name" className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange" />
          <input name="manufacturer" placeholder="Manufacturer" className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange" />
          <input name="model" placeholder="Model" className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange" />
          <button className="h-10 rounded-md bg-brand-orange px-4 text-sm font-semibold text-primary-foreground">Save asset</button>
        </AssetForm>
      )}

      {showRiskForm && (
        <AssetForm onSubmit={createRisk}>
          <ClientSelect clients={clients} optional />
          <SiteSelect sites={data.sites} optional />
          <input name="title" required placeholder="Risk title" className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange" />
          <select name="severity" defaultValue="medium" className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          <input name="recommendedAction" placeholder="Recommended action" className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange md:col-span-2" />
          <button className="h-10 rounded-md bg-brand-orange px-4 text-sm font-semibold text-primary-foreground">Save risk</button>
        </AssetForm>
      )}

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        {hierarchy.map((item, index) => (
          <div key={item.label} className="rounded-lg border border-border/60 bg-white p-4">
            <div className="flex items-center justify-between">
              <item.icon className="h-5 w-5 text-brand-blue" />
              <span className="text-xs font-semibold text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
            </div>
            <div className="mt-4 text-sm font-medium">{item.label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {["Compatibility database", "New risks found on site", "Compliance issues"].map((title) => (
          <div key={title} className="rounded-lg border border-border/60 bg-surface p-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldAlert className="h-4 w-4 text-brand-orange" />
              {title}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              This section is ready for the next migration: assets, devices, findings,
              recommendations, and evidence linked back to clients and jobs.
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-surface p-5">
          <h2 className="text-sm font-semibold">Sites with asset context</h2>
          <div className="mt-4 divide-y divide-border/40">
            {data.sites.slice(0, 8).map((site) => (
              <div key={site.id} className="flex justify-between gap-3 py-3 text-sm">
                <div>
                  <div className="font-medium">{site.name}</div>
                  <div className="text-xs text-muted-foreground">{site.organization_name}</div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {site.assets} asset(s) · {site.open_risks} open risk(s)
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border/60 bg-surface p-5">
          <h2 className="text-sm font-semibold">Risk register</h2>
          <div className="mt-4 divide-y divide-border/40">
            {data.risks.slice(0, 8).map((risk) => (
              <div key={risk.id} className="flex justify-between gap-3 py-3 text-sm">
                <div>
                  <div className="font-medium">{risk.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {risk.organization_name ?? "Unassigned client"}
                  </div>
                </div>
                <div className="text-right text-xs capitalize text-muted-foreground">
                  {risk.severity} · {risk.status}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AssetForm({
  children,
  onSubmit,
}: {
  children: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 rounded-lg border border-border/60 bg-surface p-4 md:grid-cols-5"
    >
      {children}
    </form>
  );
}

function ClientSelect({
  clients,
  optional = false,
}: {
  clients: { id: string; name: string }[];
  optional?: boolean;
}) {
  return (
    <select name="organizationId" required={!optional} className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange">
      {optional && <option value="">No client</option>}
      {!optional && <option value="">Choose client</option>}
      {clients.map((client) => (
        <option key={client.id} value={client.id}>{client.name}</option>
      ))}
    </select>
  );
}

function SiteSelect({
  sites,
  optional = false,
}: {
  sites: { id: string; name: string; organization_name: string }[];
  optional?: boolean;
}) {
  return (
    <select name="siteId" required={!optional} className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange">
      {optional && <option value="">No site</option>}
      {!optional && <option value="">Choose site</option>}
      {sites.map((site) => (
        <option key={site.id} value={site.id}>{site.organization_name} · {site.name}</option>
      ))}
    </select>
  );
}
