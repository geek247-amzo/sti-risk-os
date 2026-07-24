import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Bot, Check, Circle, Loader2, Plus, Save, X } from "lucide-react";

export const Route = createFileRoute("/staff/capability")({ component: CapabilityChecklist });

type Objective = { objective_key: string; title: string; success_measure: string };
type ChecklistItem = {
  id: string;
  title: string;
  description: string | null;
  status: "open" | "blocked" | "done" | "cancelled";
  priority: string;
  due_at: string | null;
  owner_name: string | null;
};

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold";

function CapabilityChecklist() {
  const [objective, setObjective] = useState<Objective | null>(null);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/capability-checklist");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Capability checklist failed to load");
    setObjective(body.objective ?? null);
    setItems(body.items ?? []);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Checklist failed to load"));
  }, []);

  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/capability-checklist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to add checklist item");
      setTitle(""); setDescription(""); setNotice("Capability checklist item added."); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to add checklist item"); }
    finally { setBusy(false); }
  }

  async function updateItem(item: ChecklistItem, changes: Partial<ChecklistItem>) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/tasks/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(changes),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to update checklist item");
      setEditing(null); setNotice("Capability checklist updated."); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to update checklist item"); }
    finally { setBusy(false); }
  }

  const activeItems = items.filter((item) => item.status !== "cancelled");
  const complete = activeItems.filter((item) => item.status === "done").length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Capability development</div>
          <h1 className="text-2xl font-bold">Capability checklist</h1>
          <p className="text-sm text-muted-foreground">Track the team, vehicle costing, and internal technician business case behind service capability.</p>
        </div>
        <Link to="/staff/steve" className={`${button} bg-brand-orange text-primary-foreground`}><Bot className="h-4 w-4" /> Ask Steve</Link>
      </div>

      {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><AlertTriangle className="mr-2 inline h-4 w-4" />{error}</div>}
      {notice && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"><Check className="mr-2 inline h-4 w-4" />{notice}</div>}

      <section className="rounded-xl border border-border/60 bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><div className="text-xs uppercase tracking-wider text-muted-foreground">Seeded KPI objective</div><h2 className="mt-1 text-xl font-bold">{objective?.title ?? "Build STI Risk service and installation capability"}</h2><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{objective?.success_measure ?? "Team structure, cost model, vehicle model, and first internal technician structure established."}</p></div>
          <div className="text-right"><div className="text-2xl font-bold">{complete}/{activeItems.length}</div><div className="text-xs uppercase tracking-wider text-muted-foreground">complete</div></div>
        </div>
      </section>

      <form onSubmit={createItem} className="rounded-xl border border-border/60 bg-surface p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2"><Plus className="h-4 w-4 text-brand-orange" /><h2 className="font-semibold">Add checklist item</h2></div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]"><input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Confirm technician vehicle cost model" className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange" /><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Definition of done or supporting notes" className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange" /><button disabled={busy} className={`${button} bg-brand-orange text-primary-foreground disabled:opacity-60`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add</button></div>
      </form>

      <section className="space-y-3">
        {activeItems.map((item) => <ChecklistCard key={item.id} item={item} editing={editing === item.id} busy={busy} onEdit={() => setEditing(item.id)} onCancel={() => setEditing(null)} onUpdate={(changes) => updateItem(item, changes)} />)}
        {!activeItems.length && <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No checklist items yet. Add the first capability milestone above.</div>}
      </section>
    </div>
  );
}

function ChecklistCard({ item, editing, busy, onEdit, onCancel, onUpdate }: { item: ChecklistItem; editing: boolean; busy: boolean; onEdit: () => void; onCancel: () => void; onUpdate: (changes: Partial<ChecklistItem>) => void }) {
  const [draftTitle, setDraftTitle] = useState(item.title);
  const [draftDescription, setDraftDescription] = useState(item.description ?? "");
  return <article className="rounded-xl border border-border/60 bg-surface p-4 shadow-sm"><div className="flex items-start gap-3"><button type="button" title={item.status === "done" ? "Reopen item" : "Mark complete"} onClick={() => onUpdate({ status: item.status === "done" ? "open" : "done" })} className="mt-1 text-brand-orange">{item.status === "done" ? <Check className="h-5 w-5" /> : <Circle className="h-5 w-5" />}</button><div className="min-w-0 flex-1">{editing ? <div className="space-y-2"><input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" /><textarea value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} className="min-h-20 w-full rounded-md border border-border bg-background p-3 text-sm" /></div> : <><div className={`font-semibold ${item.status === "done" ? "text-muted-foreground line-through" : ""}`}>{item.title}</div>{item.description && <div className="mt-1 text-sm text-muted-foreground">{item.description}</div>}</>}<div className="mt-2 text-xs text-muted-foreground">{item.owner_name ?? "Unassigned"}{item.due_at ? ` · due ${new Date(item.due_at).toLocaleDateString()}` : ""} · {item.status}</div></div><div className="flex gap-2">{editing ? <><button type="button" disabled={busy} onClick={() => onUpdate({ title: draftTitle, description: draftDescription })} className="rounded-md border border-border p-2 text-emerald-600" title="Save"><Save className="h-4 w-4" /></button><button type="button" onClick={onCancel} className="rounded-md border border-border p-2 text-muted-foreground" title="Cancel"><X className="h-4 w-4" /></button></> : <button type="button" onClick={onEdit} className="rounded-md border border-border px-3 py-2 text-xs font-semibold">Edit</button>}</div></div></article>;
}
