import { createFileRoute } from "@tanstack/react-router";
import { FileAudio, Loader2, Mic, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../components/ui/button";

export const Route = createFileRoute("/staff/voice")({
  component: Voice,
});

function Voice() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/integrations/yeastar/calls");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load calls");
      setCalls(body.calls ?? []);
      setContacts(body.contacts ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load calls");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  const tagCall = async (callId: string, payload: { contactId?: string; personal?: boolean }) => {
    const response = await fetch(`/api/integrations/yeastar/calls/${callId}/tag`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Unable to tag call");
    await load();
  };

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-brand-orange">Knowledge Capture</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Voice calls</h1>
          <p className="mt-2 text-muted-foreground">
            Yeastar CDRs and Gemini call transcripts imported for staff review.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
          {error}
        </div>
      )}
      {loading ? (
        <div className="flex items-center gap-2 rounded-lg border p-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading calls…
        </div>
      ) : calls.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          No imported calls yet.
        </div>
      ) : (
        <div className="space-y-4">
          {calls.map((call) => (
            <article key={call.id} className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-brand-orange/10 p-2 text-brand-orange">
                    <Mic className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold">
                      {call.call_from ?? "Unknown"} → {call.call_to ?? "Unknown"}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(call.call_time)} · {call.call_type ?? "Call"} ·{" "}
                      {call.disposition ?? "No disposition"}
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                  {call.transcription_status}
                </span>
              </div>
              {call.transcript ? (
                <div className="mt-4 whitespace-pre-wrap rounded-lg bg-muted/40 p-4 text-sm leading-6">
                  {call.transcript}
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  Transcript not available yet
                  {call.transcription_error ? `: ${call.transcription_error}` : "."}
                </p>
              )}
              {call.recording_file && (
                <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <FileAudio className="h-3.5 w-3.5" /> {call.recording_file}
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4 text-sm">
                <span className="text-muted-foreground">{call.tag_status ?? "untagged"}</span>
                {call.contact_first_name && (
                  <span className="text-muted-foreground">
                    · {call.contact_first_name} {call.contact_last_name ?? ""}
                    {call.organization_name ? ` (${call.organization_name})` : ""}
                  </span>
                )}
                {call.staff_name && (
                  <span className="text-muted-foreground">· {call.staff_name}</span>
                )}
                {call.tag_status === "untagged" && call.can_tag && (
                  <>
                    <select
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                      value={selectedContacts[call.id] ?? ""}
                      onChange={(event) =>
                        setSelectedContacts((current) => ({
                          ...current,
                          [call.id]: event.target.value,
                        }))
                      }
                    >
                      <option value="">Select customer…</option>
                      {contacts.map((contact) => (
                        <option key={contact.id} value={contact.id}>
                          {contact.first_name ?? ""} {contact.last_name ?? ""}
                          {contact.organization_name ? ` · ${contact.organization_name}` : ""}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      disabled={!selectedContacts[call.id]}
                      onClick={() =>
                        void tagCall(call.id, { contactId: selectedContacts[call.id] }).catch(
                          (err) =>
                            setError(err instanceof Error ? err.message : "Unable to tag call"),
                        )
                      }
                    >
                      Link customer
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void tagCall(call.id, { personal: true }).catch((err) =>
                          setError(err instanceof Error ? err.message : "Unable to tag call"),
                        )
                      }
                    >
                      Personal
                    </Button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

type Call = {
  id: string;
  call_time: string | null;
  call_type: string | null;
  call_from: string | null;
  call_to: string | null;
  disposition: string | null;
  transcription_status: string;
  transcript: string | null;
  transcription_error: string | null;
  recording_file: string | null;
  staff_user_id: string | null;
  staff_name: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  organization_name: string | null;
  tag_status: "untagged" | "matched" | "personal";
  can_tag: boolean;
};

type Contact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Unknown time";
}
