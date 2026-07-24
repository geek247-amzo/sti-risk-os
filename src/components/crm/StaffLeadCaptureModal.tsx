import { type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Plus, Upload, X } from "lucide-react";

type LeadMode = "manual" | "image";

type Props = {
  mode: LeadMode;
  setMode: (mode: LeadMode) => void;
  submitting: boolean;
  message: string;
  onClose: () => void;
  onManualSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onImageSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function StaffLeadCaptureModal({
  mode,
  setMode,
  submitting,
  message,
  onClose,
  onManualSubmit,
  onImageSubmit,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-background shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-background/95 p-5 backdrop-blur">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-brand-orange">CRM Intake</div>
            <h2 className="text-xl font-bold">Add lead</h2>
            <p className="text-sm text-muted-foreground">
              Capture a lead directly into CRM or upload an image for n8n AI extraction.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="grid h-9 w-9 place-items-center rounded-md border border-border hover:bg-surface-2 disabled:opacity-60"
            aria-label="Close add lead"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5">
          <div className="mb-5 grid gap-2 rounded-lg bg-surface p-1 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode("manual")}
              className={`rounded-md px-3 py-2 text-sm font-semibold ${
                mode === "manual" ? "bg-brand-orange text-primary-foreground" : "hover:bg-surface-2"
              }`}
            >
              Manual capture
            </button>
            <button
              type="button"
              onClick={() => setMode("image")}
              className={`rounded-md px-3 py-2 text-sm font-semibold ${
                mode === "image" ? "bg-brand-orange text-primary-foreground" : "hover:bg-surface-2"
              }`}
            >
              Image via n8n AI
            </button>
          </div>

          {message && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {message}
            </div>
          )}

          {mode === "manual" ? (
            <form onSubmit={onManualSubmit} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name" name="firstName" required />
                <Field label="Last name" name="lastName" />
                <Field
                  label="Organization"
                  name="organizationName"
                  required
                  className="sm:col-span-2"
                />
                <Field label="Email" name="email" type="email" />
                <Field label="Phone" name="phone" />
                <Field label="Role" name="roleTitle" />
                <label className="space-y-1.5 text-sm">
                  <span className="text-muted-foreground">Service interest</span>
                  <select
                    name="serviceInterest"
                    className="h-10 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
                  >
                    <option>Fire detection</option>
                    <option>Fire suppression</option>
                    <option>Risk audit</option>
                    <option>Digital twin</option>
                    <option>Service and inspection</option>
                    <option>Industrial risk consultation</option>
                  </select>
                </label>
                <Field
                  label="Estimated value (ZAR)"
                  name="estimatedValue"
                  type="number"
                  className="sm:col-span-2"
                />
                <label className="space-y-1.5 text-sm sm:col-span-2">
                  <span className="text-muted-foreground">Notes</span>
                  <textarea
                    name="message"
                    rows={4}
                    required
                    className="w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-brand-orange"
                  />
                </label>
              </div>
              <ModalActions submitting={submitting} submitLabel="Capture lead" onClose={onClose} />
            </form>
          ) : (
            <form onSubmit={onImageSubmit} className="space-y-5">
              <label className="flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-surface p-6 text-center hover:bg-surface-2">
                <Upload className="h-8 w-8 text-brand-orange" />
                <span className="text-sm font-semibold">
                  Upload business card, form, or lead image
                </span>
                <span className="max-w-md text-xs text-muted-foreground">
                  The image is sent to the configured n8n workflow. n8n should return contact
                  fields, then the server creates the organization, contact, deal, task, and audit
                  trail.
                </span>
                <input name="image" type="file" accept="image/*" required className="text-sm" />
              </label>
              <div className="rounded-md border border-brand-blue/30 bg-brand-blue/10 p-3 text-xs text-brand-blue">
                Expected n8n output: organization, name or first name, email or phone, role, service
                interest, and notes. Email or phone is required before the lead can be created.
              </div>
              <ModalActions submitting={submitting} submitLabel="Process image" onClose={onClose} />
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = false,
  className = "",
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={`space-y-1.5 text-sm ${className}`}>
      <span className="text-muted-foreground">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        className="h-10 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
      />
    </label>
  );
}

function ModalActions({
  submitting,
  submitLabel,
  onClose,
}: {
  submitting: boolean;
  submitLabel: string;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
      <button
        type="button"
        onClick={onClose}
        disabled={submitting}
        className="rounded-md border border-border px-4 py-2 text-sm hover:bg-surface-2 disabled:opacity-60"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {submitting ? (
          <CheckCircle2 className="h-4 w-4 animate-pulse" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        {submitting ? "Working..." : submitLabel}
      </button>
    </div>
  );
}
