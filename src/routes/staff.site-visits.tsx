import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, ClipboardList, Loader2 } from "lucide-react";

export const Route = createFileRoute("/staff/site-visits")({ component: SiteVisits });

type Visit = {
  id: string;
  organization_name: string;
  site_name: string;
  started_at: string;
  status: string;
  note_count: number;
  urgent_note_count: number;
  immediate_danger_count: number;
};
type Note = {
  id: string;
  note_type: string;
  body: string;
  is_urgent: boolean;
  is_immediate_danger: boolean;
  needs_specialist_review: boolean;
  created_at: string;
  created_by_name: string | null;
};

function SiteVisits() {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [selectedVisitId, setSelectedVisitId] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteType, setNoteType] = useState("typed");
  const [body, setBody] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [danger, setDanger] = useState(false);
  const [specialist, setSpecialist] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadVisits() {
    const response = await fetch("/api/site-visits");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Unable to load site visits");
    setVisits(result.siteVisits ?? []);
    if (!selectedVisitId && result.siteVisits?.[0]) setSelectedVisitId(result.siteVisits[0].id);
  }
  async function loadNotes(visitId: string) {
    if (!visitId) return setNotes([]);
    const response = await fetch(`/api/site-visits/${visitId}/notes`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Unable to load notes");
    setNotes(result.notes ?? []);
  }
  useEffect(() => {
    loadVisits().catch((e) =>
      setError(e instanceof Error ? e.message : "Unable to load site visits"),
    );
  }, []);
  useEffect(() => {
    loadNotes(selectedVisitId).catch((e) =>
      setError(e instanceof Error ? e.message : "Unable to load notes"),
    );
  }, [selectedVisitId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedVisitId) return setError("Select a site visit first.");
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/site-visits/${selectedVisitId}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          noteType,
          body,
          isUrgent: urgent,
          isImmediateDanger: danger,
          needsSpecialistReview: specialist,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to save note");
      setBody("");
      setUrgent(false);
      setDanger(false);
      setSpecialist(false);
      setNotice(
        danger
          ? "Immediate-danger flag recorded and surfaced on the visit."
          : "Quick note recorded.",
      );
      await Promise.all([loadVisits(), loadNotes(selectedVisitId)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save note");
    } finally {
      setBusy(false);
    }
  }

  const selectedVisit = visits.find((visit) => visit.id === selectedVisitId);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Site Assessment · Phase 6
        </div>
        <h1 className="text-2xl font-bold">Site visits and quick notes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Capture typed or voice-origin notes, questions, recommendations, missing information, and
          safety flags while keeping immediate danger visibly separate.
        </p>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </div>
      )}
      <section className="rounded-xl border border-border/60 bg-white p-5 shadow-sm">
        <label className="grid gap-2 text-sm font-medium">
          Site visit
          <select
            className="h-11 rounded-md border border-border bg-background px-3 font-normal"
            value={selectedVisitId}
            onChange={(e) => setSelectedVisitId(e.target.value)}
          >
            <option value="">Select site visit</option>
            {visits.map((visit) => (
              <option key={visit.id} value={visit.id}>
                {visit.organization_name} · {visit.site_name} ·{" "}
                {new Date(visit.started_at).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
        {selectedVisit &&
          (selectedVisit.immediate_danger_count > 0 || selectedVisit.urgent_note_count > 0) && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">
              <AlertTriangle className="h-4 w-4" />{" "}
              {selectedVisit.immediate_danger_count > 0
                ? `${selectedVisit.immediate_danger_count} immediate-danger flag(s)`
                : `${selectedVisit.urgent_note_count} urgent note(s)`}{" "}
              recorded for this visit.
            </div>
          )}
      </section>
      <form
        onSubmit={(e) => void submit(e)}
        className="grid gap-4 rounded-xl border border-border/60 bg-white p-5 shadow-sm"
      >
        <h2 className="font-bold">Add quick note</h2>
        <select
          className="h-11 rounded-md border border-border bg-background px-3 text-sm"
          value={noteType}
          onChange={(e) => setNoteType(e.target.value)}
        >
          <option value="typed">Typed note</option>
          <option value="voice">Voice note</option>
          <option value="question">Question</option>
          <option value="recommendation">Recommendation</option>
          <option value="missing_information">Missing information</option>
        </select>
        <textarea
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What was observed or needs follow-up?"
          className="min-h-28 rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />{" "}
            Mark urgent
          </label>
          <label className="flex items-center gap-2 font-semibold text-red-700">
            <input type="checkbox" checked={danger} onChange={(e) => setDanger(e.target.checked)} />{" "}
            Immediate danger
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={specialist}
              onChange={(e) => setSpecialist(e.target.checked)}
            />{" "}
            Specialist review
          </label>
        </div>
        <button
          disabled={busy || !selectedVisitId}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand-orange px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save quick note
        </button>
      </form>
      <section className="rounded-xl border border-border/60 bg-white p-5 shadow-sm">
        <h2 className="font-bold">Visit notes</h2>
        <div className="mt-3 space-y-3">
          {notes.map((note) => (
            <article
              key={note.id}
              className={`rounded-lg border p-4 ${note.is_immediate_danger ? "border-red-300 bg-red-50" : "border-border bg-background"}`}
            >
              <div className="flex flex-wrap gap-2 text-xs font-bold uppercase">
                <span>{note.note_type.replaceAll("_", " ")}</span>
                {note.is_immediate_danger && <span className="text-red-700">Immediate danger</span>}
                {note.needs_specialist_review && (
                  <span className="text-orange-700">Specialist review</span>
                )}
              </div>
              <p className="mt-2 text-sm whitespace-pre-wrap">{note.body}</p>
              <div className="mt-2 text-xs text-muted-foreground">
                {new Date(note.created_at).toLocaleString()} · {note.created_by_name ?? "Staff"}
              </div>
            </article>
          ))}
          {!notes.length && (
            <p className="text-sm text-muted-foreground">No notes recorded for this visit.</p>
          )}
        </div>
      </section>
      <p className="text-xs text-muted-foreground">
        <ClipboardList className="mr-1 inline h-3 w-3" />
        No notification pipeline is triggered by this ticket; flags remain visible on the visit for
        staff follow-up.
      </p>
    </div>
  );
}
