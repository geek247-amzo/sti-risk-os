import html2canvas from "html2canvas";
import { Camera, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

export function BugReportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!open) {
      setComment("");
      setError("");
      setNotice("");
    }
  }, [open]);

  if (!open) return null;

  async function submit() {
    if (!comment.trim()) {
      setError("Please describe what went wrong.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const target = document.querySelector(".staff-app") as HTMLElement | null;
      if (!target) throw new Error("The current page could not be captured");
      const canvas = await html2canvas(target, {
        useCORS: true,
        backgroundColor: "#f8fafc",
        ignoreElements: (element) => element.hasAttribute("data-bug-report-dialog"),
      });
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("The screenshot could not be created");
      const form = new FormData();
      form.append("comment", comment.trim());
      form.append("pageUrl", window.location.href);
      form.append("screenshot", new File([blob], "bug-report.png", { type: "image/png" }));
      const response = await fetch("/api/bug-reports", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Bug report failed");
      setNotice("Bug report captured. Thank you.");
      setComment("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bug report failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/45 p-4"
      data-bug-report-dialog
    >
      <section
        className="w-full max-w-lg rounded-lg border border-border bg-white p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bug-report-title"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-orange">
              <Camera className="h-4 w-4" /> Bug report
            </div>
            <h2 id="bug-report-title" className="mt-2 text-xl font-semibold">
              What went wrong?
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              We’ll attach a screenshot of the current page and its URL. Browser-native popups are
              not included.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-surface-2"
            aria-label="Close bug report"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          className="mt-5 min-h-32 w-full rounded-md border border-input bg-background p-3 text-sm outline-none focus:border-brand-blue"
          placeholder="Describe the steps and what you expected to happen…"
          autoFocus
        />
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        {notice && <p className="mt-2 text-sm text-emerald-700">{notice}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || Boolean(notice)}
            onClick={submit}
            className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}{" "}
            Capture report
          </button>
        </div>
      </section>
    </div>
  );
}
