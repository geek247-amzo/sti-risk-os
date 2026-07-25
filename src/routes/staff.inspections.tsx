import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type PointerEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronLeft,
  ClipboardCheck,
  Loader2,
  MapPin,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Wifi,
} from "lucide-react";

export const Route = createFileRoute("/staff/inspections")({ component: StaffInspections });

type Organization = { id: string; name: string };
type Site = { id: string; organization_id: string; name: string; address: string | null };
type Building = { id: string; site_id: string; name: string };
type Floor = { id: string; building_id: string; site_id: string; name: string; level_number: number | null };
type Area = { id: string; site_id: string; building_id: string | null; floor_id: string | null; name: string; area_type: string };
type Asset = {
  id: string; organization_id: string; site_id: string; building_id: string | null; floor_id: string | null;
  area_id: string | null; name: string; asset_type: string; manufacturer: string | null; model: string | null;
  serial_number: string | null; system_family: string | null; status: string; installed_on: string | null; notes: string | null;
};
type Template = { id: string; name: string; version: number; category: string; applicable_asset_type: string | null; item_count: number };
type InspectionSummary = {
  id: string; checklist_template_id: string; checklist_template_version: number; asset_id: string; area_id: string | null;
  started_at: string; completed_at: string | null; risk_level: string; computed_risk_level: string; outcome: string; status: string;
  template_name: string; template_category: string; asset_name: string; site_name: string; organization_name: string;
};
type InspectionItem = {
  id: string; position: number; item_text: string; sans_clause: string | null; response_type: string; required: boolean;
  photo_required: boolean; risk_weight: number; response_id: string | null; outcome: "ok" | "defective" | "na" | null;
  comment: string | null; na_reason: string | null; numeric_value: number | null; responded_at: string | null;
  ai_compliance_result: "plausible_match" | "unclear" | "mismatch" | null; ai_compliance_rationale: string | null;
};
type Evidence = { id: string; file_name: string; inspection_item_response_id: string | null; gps_lat: number | null; gps_lng: number | null; location_text: string | null };
type InspectionDetail = { inspection: InspectionSummary & { checklist_template_id: string; status: string }; items: InspectionItem[]; evidence: Evidence[]; signature: { signer_name: string; signed_at: string } | null };
type InlineKind = "customer" | "site" | "building" | "floor" | "area";

const inputClass = "h-11 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange";
const buttonClass = "inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold";

function StaffInspections() {
  const [context, setContext] = useState<{ organizations: Organization[]; sites: Site[]; buildings: Building[]; floors: Floor[]; areas: Area[]; assets: Asset[] }>({ organizations: [], sites: [], buildings: [], floors: [], areas: [], assets: [] });
  const [templates, setTemplates] = useState<Template[]>([]);
  const [inspections, setInspections] = useState<InspectionSummary[]>([]);
  const [detail, setDetail] = useState<InspectionDetail | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [inlineKind, setInlineKind] = useState<InlineKind | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadContext() {
    const response = await fetch("/api/inspection-capture/context");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Unable to load inspection context");
    setContext(body);
  }

  async function loadTemplates(assetType: string) {
    const query = assetType ? `?status=active&asset_type=${encodeURIComponent(assetType)}` : "?status=active";
    const response = await fetch(`/api/checklist-templates${query}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Unable to load checklist templates");
    setTemplates(body.templates ?? []);
  }

  async function loadInspections(id: string) {
    if (!id) { setInspections([]); return; }
    const response = await fetch(`/api/inspections?asset_id=${encodeURIComponent(id)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Unable to load inspections");
    setInspections(body.inspections ?? []);
  }

  useEffect(() => {
    Promise.all([loadContext(), fetch("/api/checklist-templates?status=active").then((r) => r.json()).then((b) => setTemplates(b.templates ?? []))])
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load capture workspace"))
      .finally(() => setLoading(false));
  }, []);

  const sites = useMemo(() => context.sites.filter((site) => !organizationId || site.organization_id === organizationId), [context.sites, organizationId]);
  const buildings = useMemo(() => context.buildings.filter((building) => !siteId || building.site_id === siteId), [context.buildings, siteId]);
  const floors = useMemo(() => context.floors.filter((floor) => !buildingId || floor.building_id === buildingId), [context.floors, buildingId]);
  const areas = useMemo(() => context.areas.filter((area) => (!siteId || area.site_id === siteId) && (!floorId || area.floor_id === floorId)), [context.areas, siteId, floorId]);
  const assets = useMemo(() => context.assets.filter((asset) => (!organizationId || asset.organization_id === organizationId) && (!siteId || asset.site_id === siteId) && (!buildingId || asset.building_id === buildingId) && (!floorId || asset.floor_id === floorId) && (!areaId || asset.area_id === areaId)), [context.assets, organizationId, siteId, buildingId, floorId, areaId]);
  const selectedAsset = context.assets.find((asset) => asset.id === assetId) ?? null;

  useEffect(() => {
    if (!assetId) { setTemplates([]); setInspections([]); setDetail(null); return; }
    setBusy("loading-asset");
    Promise.all([loadTemplates(selectedAsset?.asset_type ?? ""), loadInspections(assetId)])
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load asset inspections"))
      .finally(() => setBusy(""));
  }, [assetId, selectedAsset?.asset_type]);

  function chooseOrganization(value: string) { setOrganizationId(value); setSiteId(""); setBuildingId(""); setFloorId(""); setAreaId(""); setAssetId(""); setDetail(null); }
  function chooseSite(value: string) { setSiteId(value); setBuildingId(""); setFloorId(""); setAreaId(""); setAssetId(""); setDetail(null); }
  function chooseBuilding(value: string) { setBuildingId(value); setFloorId(""); setAreaId(""); setAssetId(""); setDetail(null); }
  function chooseFloor(value: string) { setFloorId(value); setAreaId(""); setAssetId(""); setDetail(null); }
  function chooseArea(value: string) { setAreaId(value); setAssetId(""); setDetail(null); }

  async function startInspection(templateId: string) {
    if (!assetId) return;
    setBusy(`start-${templateId}`); setError("");
    try {
      const response = await fetch("/api/inspections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ checklistTemplateId: templateId, assetId, areaId: areaId || null }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to start inspection");
      await openInspection(body.inspectionId);
      await loadInspections(assetId);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to start inspection"); }
    finally { setBusy(""); }
  }

  async function openInspection(id: string) {
    setBusy(`open-${id}`); setError("");
    try {
      const response = await fetch(`/api/inspections/${id}`); const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to open inspection");
      setDetail(body);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to open inspection"); }
    finally { setBusy(""); }
  }

  async function saveResponse(item: InspectionItem, changes: Record<string, unknown>) {
    if (!detail || detail.inspection.status !== "in_progress") return;
    setBusy(`save-${item.id}`); setError("");
    try {
      const response = await fetch(`/api/inspections/${detail.inspection.id}/responses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ checklistTemplateItemId: item.id, outcome: changes.outcome ?? item.outcome, comment: changes.comment ?? item.comment, naReason: changes.naReason ?? item.na_reason, numericValue: changes.numericValue ?? item.numeric_value }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to save response");
      await openInspection(detail.inspection.id);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to save response"); }
    finally { setBusy(""); }
  }

  async function uploadEvidence(item: InspectionItem, event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]; if (!files.length || !detail) return;
    const responseId = item.response_id;
    if (!responseId) { setError("Save an item response before attaching its photo"); return; }
    setBusy(`photo-${item.id}`); setError("");
    const form = new FormData(); files.forEach((file) => form.append("files", file)); form.append("inspectionItemResponseId", responseId);
    const location = document.getElementById(`location-${item.id}`) as HTMLInputElement | null;
    if (location?.value) form.append("locationText", location.value);
    if (navigator.geolocation) await new Promise<void>((resolve) => navigator.geolocation.getCurrentPosition((position) => { form.append("gpsLat", String(position.coords.latitude)); form.append("gpsLng", String(position.coords.longitude)); resolve(); }, () => resolve(), { enableHighAccuracy: false, timeout: 5000 }));
    try {
      const response = await fetch(`/api/inspections/${detail.inspection.id}/evidence`, { method: "POST", body: form }); const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to upload evidence");
      setNotice(`${files.length} photo${files.length === 1 ? "" : "s"} attached.`); await openInspection(detail.inspection.id);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to upload evidence"); }
    finally { setBusy(""); event.target.value = ""; }
  }

  async function completeInspection(signature: SignaturePadHandle) {
    if (!detail) return;
    const signatureData = signature.export();
    if (!signatureData) { setError("Technician signature is required before completion"); return; }
    const signerName = prompt("Technician name", "")?.trim();
    if (!signerName) return;
    setBusy("complete"); setError("");
    try {
      const response = await fetch(`/api/inspections/${detail.inspection.id}/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signerName, signatureData }) });
      const body = await response.json();
      if (!response.ok) {
        const missing = (body.missingItems ?? []).map((item: { position: number; item_text: string; photo_required: boolean }) => `${item.position}. ${item.item_text}${item.photo_required ? " (photo required)" : ""}`).join("\n");
        throw new Error(missing ? `${body.error}\n${missing}` : body.error ?? "Unable to complete inspection");
      }
      setNotice("Inspection completed and signed."); await openInspection(detail.inspection.id); await loadInspections(assetId);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to complete inspection"); }
    finally { setBusy(""); }
  }

  async function createAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("asset"); setError("");
    const formData = new FormData(event.currentTarget);
    const values = Object.fromEntries(["name", "assetType", "manufacturer", "model", "serialNumber", "installedOn", "notes"].map((key) => [key, formData.get(key) ?? ""]));
    const photos = formData.getAll("assetPhotos").filter((value): value is File => value instanceof File && value.size > 0);
    const locationText = String(formData.get("assetPhotoLocation") ?? "").trim();
    try {
      const response = await fetch("/api/assets-risk/assets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...values, siteId, buildingId: buildingId || null, floorId: floorId || null, areaId: areaId || null }) }); const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to create asset");
      if (photos.length) {
        const upload = new FormData();
        photos.forEach((photo) => upload.append("files", photo));
        upload.append("captureTimestamp", new Date().toISOString());
        if (locationText) upload.append("locationText", locationText);
        if (navigator.geolocation) await new Promise<void>((resolve) => navigator.geolocation.getCurrentPosition((position) => { upload.append("gpsLat", String(position.coords.latitude)); upload.append("gpsLng", String(position.coords.longitude)); resolve(); }, () => resolve(), { enableHighAccuracy: false, timeout: 5000 }));
        const photoResponse = await fetch(`/api/assets-risk/assets/${body.assetId}/evidence`, { method: "POST", body: upload });
        const photoBody = await photoResponse.json();
        if (!photoResponse.ok) throw new Error(photoBody.error ?? "Asset created, but photo upload failed");
      }
      await loadContext(); setAssetId(body.assetId); setShowAssetForm(false); setNotice(`Asset created${photos.length ? ` with ${photos.length} photo${photos.length === 1 ? "" : "s"}` : ""}. Select a checklist to begin.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to create asset"); }
    finally { setBusy(""); }
  }

  async function createInline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inlineKind) return;
    setBusy(`create-${inlineKind}`); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      let endpoint = "";
      let payload: Record<string, unknown> = values;
      if (inlineKind === "customer") endpoint = "/api/clients";
      if (inlineKind === "site") { endpoint = "/api/assets-risk/sites"; payload = { ...values, organizationId }; }
      if (inlineKind === "building") { endpoint = "/api/inspection-capture/buildings"; payload = { ...values, siteId }; }
      if (inlineKind === "floor") { endpoint = "/api/inspection-capture/floors"; payload = { ...values, buildingId }; }
      if (inlineKind === "area") { endpoint = "/api/inspection-capture/areas"; payload = { ...values, siteId, buildingId: buildingId || null, floorId: floorId || null }; }
      if (inlineKind === "customer") payload = { name: values.name, relationshipType: "end_user" };
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Unable to create ${inlineKind}`);
      await loadContext();
      if (inlineKind === "customer") chooseOrganization(body.customer.id);
      if (inlineKind === "site") { setSiteId(body.siteId); setBuildingId(""); setFloorId(""); setAreaId(""); setAssetId(""); }
      if (inlineKind === "building") { setBuildingId(body.building.id); setFloorId(""); setAreaId(""); setAssetId(""); }
      if (inlineKind === "floor") { setFloorId(body.floor.id); setAreaId(""); setAssetId(""); }
      if (inlineKind === "area") { setAreaId(body.area.id); setAssetId(""); }
      setInlineKind(null); setNotice(`${inlineKind[0].toUpperCase()}${inlineKind.slice(1)} created and selected.`);
    } catch (err) { setError(err instanceof Error ? err.message : `Unable to create ${inlineKind}`); }
    finally { setBusy(""); }
  }

  if (loading) return <div className="staff-loading-state min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin" /><span className="text-sm">Loading inspection workspace…</span></div>;

  return (
    <div className="mx-auto max-w-5xl overflow-x-hidden space-y-5 px-3 pb-12 sm:px-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Site execution</div><h1 className="text-2xl font-bold">New inspection</h1><p className="text-sm text-muted-foreground">Online capture · progress is saved after every response.</p></div>
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-2 text-xs text-muted-foreground"><Wifi className="h-4 w-4 text-emerald-600" /> Online-first</div>
      </div>
      {error && <div className="whitespace-pre-line rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><AlertTriangle className="mr-2 inline h-4 w-4" />{error}</div>}
      {notice && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"><Check className="mr-2 inline h-4 w-4" />{notice}</div>}

      {!detail ? <>
        <section className="rounded-xl border border-border/60 bg-surface p-4 shadow-sm md:p-6">
          <div className="mb-4 flex items-center gap-2"><MapPin className="h-5 w-5 text-brand-orange" /><h2 className="font-semibold">1. Select site context</h2></div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <SelectorWithAdd label="Customer" value={organizationId} onChange={chooseOrganization} disabled={false} onAdd={() => setInlineKind("customer")}><option value="">Customer</option>{context.organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectorWithAdd>
            <SelectorWithAdd label="Site" value={siteId} onChange={chooseSite} disabled={!organizationId} onAdd={() => setInlineKind("site")}><option value="">Site</option>{sites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectorWithAdd>
            <SelectorWithAdd label="Building" value={buildingId} onChange={chooseBuilding} disabled={!siteId} onAdd={() => setInlineKind("building")}><option value="">Building</option>{buildings.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectorWithAdd>
            <SelectorWithAdd label="Floor" value={floorId} onChange={chooseFloor} disabled={!buildingId} onAdd={() => setInlineKind("floor")}><option value="">Floor</option>{floors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectorWithAdd>
            <SelectorWithAdd label="Area / zone" value={areaId} onChange={chooseArea} disabled={!siteId} onAdd={() => setInlineKind("area")}><option value="">Area / zone</option>{areas.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.area_type}</option>)}</SelectorWithAdd>
            <div><div className="mb-1 flex items-center justify-between gap-2"><label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Asset / panel / device</label><button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-orange disabled:opacity-40" disabled={!siteId} onClick={() => setShowAssetForm((value) => !value)}><Plus className="h-3.5 w-3.5" /> Add new</button></div><select className={inputClass} value={assetId} onChange={(e) => setAssetId(e.target.value)} disabled={!siteId}><option value="">Asset / panel / device</option>{assets.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.asset_type}</option>)}</select></div>
          </div>
          {inlineKind && <InlineCreateForm kind={inlineKind} busy={busy === `create-${inlineKind}`} onSubmit={createInline} onCancel={() => setInlineKind(null)} />}
          {showAssetForm && siteId && <form onSubmit={createAsset} className="mt-4 grid gap-3 rounded-lg border border-dashed border-brand-orange/50 p-4 md:grid-cols-2"><input className={inputClass} name="name" required placeholder="Asset name" /><input className={inputClass} name="assetType" required placeholder="Asset type (e.g. conventional panel)" /><input className={inputClass} name="manufacturer" placeholder="Manufacturer" /><input className={inputClass} name="model" placeholder="Model" /><input className={inputClass} name="serialNumber" placeholder="Serial number" /><input className={inputClass} name="installedOn" type="date" /><textarea className="min-h-20 rounded-md border border-border bg-background p-3 text-sm md:col-span-2" name="notes" placeholder="Existing technical notes" /><div className="rounded-lg border border-dashed border-border p-3 md:col-span-2"><div className="flex items-center gap-2 text-sm font-medium"><Camera className="h-4 w-4 text-brand-orange" /> Asset photos</div><p className="mt-1 text-xs text-muted-foreground">Add one or more photos of the panel/device, label, or internal condition.</p><input className={`${inputClass} mt-3`} name="assetPhotos" type="file" accept="image/*" capture="environment" multiple /><input className={`${inputClass} mt-3`} name="assetPhotoLocation" placeholder="Photo location (optional, e.g. GF electrical room)" /></div><button className={`${buttonClass} bg-brand-orange text-primary-foreground md:col-span-2`} disabled={busy === "asset"}>{busy === "asset" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save asset</button></form>}
        </section>
        {assetId && <section className="rounded-xl border border-border/60 bg-surface p-4 shadow-sm md:p-6"><div className="mb-4 flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-brand-orange" /><h2 className="font-semibold">2. Choose checklist blocks</h2></div><div className="grid gap-3 md:grid-cols-2">{templates.map((template) => <div key={template.id} className="rounded-lg border border-border bg-background p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="font-semibold">{template.name}</div><div className="mt-1 text-xs text-muted-foreground">v{template.version} · {template.item_count} items · {template.category}</div></div><button className={`${buttonClass} w-full bg-brand-orange text-primary-foreground sm:w-auto`} onClick={() => startInspection(template.id)} disabled={Boolean(busy)}><Plus className="h-4 w-4" /> Start</button></div></div>)}</div>{!templates.length && <p className="text-sm text-muted-foreground">No active checklist applies to this asset type.</p>}</section>}
        {assetId && inspections.length > 0 && <section className="rounded-xl border border-border/60 bg-surface p-4 shadow-sm md:p-6"><div className="mb-4 flex items-center gap-2"><RotateCcw className="h-5 w-5 text-brand-orange" /><h2 className="font-semibold">Resume or switch checklist blocks</h2></div><div className="space-y-2">{inspections.map((inspection) => <button key={inspection.id} onClick={() => openInspection(inspection.id)} className="flex min-h-14 w-full items-center justify-between rounded-lg border border-border bg-background px-4 text-left hover:border-brand-orange"><span><span className="block font-medium">{inspection.template_name}</span><span className="text-xs text-muted-foreground">{inspection.status} · {new Date(inspection.updated_at).toLocaleString()}</span></span><span className="text-xs font-semibold uppercase text-muted-foreground">{inspection.outcome}</span></button>)}</div></section>}
      </> : <InspectionEditor detail={detail} busy={busy} onBack={() => setDetail(null)} onSaveResponse={saveResponse} onUpload={uploadEvidence} onComplete={completeInspection} />}
      <p className="text-xs text-muted-foreground">Offline queueing is not enabled yet. If this is required for plant rooms or basements, it needs a separate local-first sync decision.</p>
    </div>
  );
}

type SignaturePadHandle = { export: () => Record<string, unknown> | null };

function SignaturePad({ onReady }: { onReady: (handle: SignaturePadHandle) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null); const strokes = useRef<{ x: number; y: number }[][]>([]); const current = useRef<{ x: number; y: number }[]>([]); const drawing = useRef(false);
  function redraw() { const canvas = ref.current; const context = canvas?.getContext("2d"); if (!canvas || !context) return; context.clearRect(0, 0, canvas.width, canvas.height); context.strokeStyle = "#111827"; context.lineWidth = 3; context.lineCap = "round"; for (const stroke of [...strokes.current, current.current]) { if (!stroke.length) continue; context.beginPath(); context.moveTo(stroke[0].x, stroke[0].y); stroke.slice(1).forEach((point) => context.lineTo(point.x, point.y)); context.stroke(); } }
  function point(event: PointerEvent<HTMLCanvasElement>) { const canvas = ref.current; if (!canvas) return null; const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) }; }
  function down(event: PointerEvent<HTMLCanvasElement>) { const value = point(event); if (!value) return; drawing.current = true; current.current = [value]; event.currentTarget.setPointerCapture(event.pointerId); redraw(); }
  function move(event: PointerEvent<HTMLCanvasElement>) { if (!drawing.current) return; const value = point(event); if (!value) return; current.current.push(value); redraw(); }
  function up(event: PointerEvent<HTMLCanvasElement>) { if (!drawing.current) return; drawing.current = false; if (current.current.length) strokes.current.push(current.current); current.current = []; redraw(); try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* no-op */ } }
  function clear() { strokes.current = []; current.current = []; redraw(); }
  useEffect(() => { onReady({ export: () => strokes.current.length ? { format: "canvas-png", imageDataUrl: ref.current?.toDataURL("image/png"), strokes: strokes.current } : null }); }, [onReady]);
  return <div><div className="overflow-hidden rounded-lg border border-border bg-white"><canvas ref={ref} width={800} height={260} className="h-48 w-full touch-none sm:h-40" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} /></div><button type="button" onClick={clear} className="mt-3 min-h-11 px-1 text-xs text-muted-foreground underline">Clear signature</button></div>;
}

function InspectionEditor({ detail, busy, onBack, onSaveResponse, onUpload, onComplete }: { detail: InspectionDetail; busy: string; onBack: () => void; onSaveResponse: (item: InspectionItem, changes: Record<string, unknown>) => Promise<void>; onUpload: (item: InspectionItem, event: ChangeEvent<HTMLInputElement>) => Promise<void>; onComplete: (signature: SignaturePadHandle) => Promise<void> }) {
  const signature = useRef<SignaturePadHandle | null>(null); const [signatureReady, setSignatureReady] = useState(false);
  return <div className="space-y-4"><button type="button" onClick={onBack} className={`${buttonClass} border border-border bg-surface`}><ChevronLeft className="h-4 w-4" /> Back to checklist blocks</button><section className="rounded-xl border border-border/60 bg-surface p-4 shadow-sm md:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{detail.inspection.template_category}</div><h2 className="text-xl font-bold">{detail.inspection.template_name}</h2><p className="text-sm text-muted-foreground">{detail.inspection.asset_name} · {detail.inspection.site_name}</p></div><span className="rounded-full bg-background px-3 py-1 text-xs font-semibold uppercase">{detail.inspection.status}</span></div></section><div className="space-y-3">{detail.items.map((item) => <ResponseCard key={item.id} item={item} evidence={detail.evidence.filter((file) => file.inspection_item_response_id === item.response_id)} busy={busy} onSave={onSaveResponse} onUpload={onUpload} />)}</div>{detail.inspection.status === "in_progress" && <section className="rounded-xl border border-border/60 bg-surface p-4 shadow-sm md:p-6"><div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-brand-orange" /><h3 className="font-semibold">Technician sign-off</h3></div><p className="mb-3 text-sm text-muted-foreground">Sign after all checklist items and required photos are complete.</p><SignaturePad onReady={(handle) => { signature.current = handle; setSignatureReady(true); }} /><button className={`${buttonClass} mt-4 w-full bg-brand-orange text-primary-foreground`} disabled={!signatureReady || Boolean(busy)} onClick={() => signature.current && onComplete(signature.current)}>{busy === "complete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Complete inspection</button></section>}{detail.inspection.status === "completed" && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><Check className="mr-2 inline h-4 w-4" />Completed · {detail.inspection.outcome} · {detail.inspection.risk_level} risk</div>}</div>;
}

function ResponseCard({ item, evidence, busy, onSave, onUpload }: { item: InspectionItem; evidence: Evidence[]; busy: string; onSave: (item: InspectionItem, changes: Record<string, unknown>) => Promise<void>; onUpload: (item: InspectionItem, event: ChangeEvent<HTMLInputElement>) => Promise<void> }) {
  const [comment, setComment] = useState(item.comment ?? ""); const [numeric, setNumeric] = useState(item.numeric_value?.toString() ?? ""); const [location, setLocation] = useState("");
  useEffect(() => { setComment(item.comment ?? ""); setNumeric(item.numeric_value?.toString() ?? ""); }, [item.comment, item.numeric_value]);
  const saveComment = () => onSave(item, { comment });
  const complianceBadge = item.ai_compliance_result === "plausible_match" ? "AI: plausible match" : item.ai_compliance_result === "mismatch" ? "AI: mismatch" : item.ai_compliance_result === "unclear" ? "AI: unclear" : null;
  return <article className="rounded-xl border border-border/60 bg-surface p-4 shadow-sm"><div className="flex gap-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-orange/10 text-sm font-bold text-brand-orange">{item.position}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold leading-6">{item.item_text}</h3>{item.sans_clause && <p className="text-xs text-muted-foreground">SANS 10139 · clause {item.sans_clause}</p>}</div><div className="flex flex-wrap gap-2">{item.required && <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-orange">Required</span>}{complianceBadge && <span title={item.ai_compliance_rationale ?? undefined} className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${item.ai_compliance_result === "mismatch" ? "bg-red-100 text-red-700" : item.ai_compliance_result === "plausible_match" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{complianceBadge}</span>}</div></div><div className="mt-4">{["pass_fail_na", "pass_fail_defective"].includes(item.response_type) && <div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><ResponseButton active={item.outcome === "ok"} label="OK" onClick={() => onSave(item, { outcome: "ok" })} /><ResponseButton active={item.outcome === "defective"} label="Defective" danger onClick={() => onSave(item, { outcome: "defective" })} />{item.response_type === "pass_fail_na" ? <ResponseButton active={item.outcome === "na"} label="N/A" onClick={() => onSave(item, { outcome: "na" })} /> : <span />}</div>}{item.response_type === "freeform" && <textarea className="min-h-28 w-full rounded-md border border-border bg-background p-3 text-sm" value={comment} onChange={(e) => setComment(e.target.value)} onBlur={saveComment} placeholder="Technician observation" />}{item.response_type === "numeric" && <div className="flex flex-col gap-2 sm:flex-row"><input className={inputClass} type="number" value={numeric} onChange={(e) => setNumeric(e.target.value)} onBlur={() => onSave(item, { numericValue: numeric, comment })} placeholder="Reading" /><button className={`${buttonClass} w-full border border-border bg-background sm:w-auto`} onClick={saveComment}><Save className="h-4 w-4" /> Save</button></div>} {item.response_type !== "freeform" && <textarea className="mt-3 min-h-24 w-full rounded-md border border-border bg-background p-3 text-sm" value={comment} onChange={(e) => setComment(e.target.value)} onBlur={saveComment} placeholder="Comment / observation (required for N/A reason)" />}{item.outcome === "na" && <p className="mt-2 text-xs text-brand-orange">Add a reason in the comment before completing.</p>}</div><div className="mt-4 rounded-lg border border-dashed border-border p-3"><div className="flex items-center gap-2 text-sm font-medium"><Camera className="h-4 w-4 text-brand-orange" />{item.photo_required ? "Required photo" : "Optional evidence photo"}{evidence.length > 0 && <span className="text-xs text-emerald-700">· {evidence.length} attached</span>}</div><input id={`location-${item.id}`} className={`${inputClass} mt-3`} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location text (e.g. GF electrical room)" /><label className={`${buttonClass} mt-3 w-full cursor-pointer border border-border bg-background`}><Camera className="h-4 w-4" /> Capture / choose photo<input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(event) => onUpload(item, event)} /></label></div></div></div></article>;
}

function ResponseButton({ active, label, danger = false, onClick }: { active: boolean; label: string; danger?: boolean; onClick: () => void }) { return <button type="button" onClick={onClick} className={`${buttonClass} w-full ${active ? danger ? "bg-red-600 text-white" : "bg-emerald-600 text-white" : "border border-border bg-background"}`}>{active && <Check className="h-4 w-4" />}{label}</button>; }

function SelectorWithAdd({ label, value, onChange, disabled, onAdd, children }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean; onAdd: () => void; children: ReactNode }) {
  return <div><div className="mb-1 flex items-center justify-between gap-2"><label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</label><button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-orange disabled:opacity-40" disabled={disabled} onClick={onAdd}><Plus className="h-3.5 w-3.5" /> Add new</button></div><select className={inputClass} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>{children}</select></div>;
}

function InlineCreateForm({ kind, busy, onSubmit, onCancel }: { kind: InlineKind; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void }) {
  const labels: Record<InlineKind, string> = { customer: "Customer", site: "Site", building: "Building", floor: "Floor", area: "Area / zone" };
  return <form onSubmit={onSubmit} className="mt-4 grid gap-3 rounded-lg border border-dashed border-brand-orange/50 bg-background p-4 md:grid-cols-3"><div className="flex items-center justify-between gap-3 md:col-span-3"><div><div className="text-sm font-semibold">Add {labels[kind]}</div><div className="text-xs text-muted-foreground">Saved for reuse in future inspections.</div></div><button type="button" onClick={onCancel} className="text-xs text-muted-foreground underline">Cancel</button></div><input className={inputClass} name="name" required placeholder={`${labels[kind]} name`} />{kind === "site" && <input className={inputClass} name="address" placeholder="Address" />}{kind === "building" && <input className={inputClass} name="description" placeholder="Description (optional)" />}{kind === "floor" && <input className={inputClass} name="levelNumber" type="number" placeholder="Level number" />}{kind === "area" && <><select className={inputClass} name="areaType" defaultValue="zone"><option value="zone">Zone</option><option value="area">Area</option><option value="room">Room</option></select><input className={inputClass} name="description" placeholder="Description (optional)" /></>}<button className={`${buttonClass} bg-brand-orange text-primary-foreground`} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add {labels[kind]}</button></form>;
}
