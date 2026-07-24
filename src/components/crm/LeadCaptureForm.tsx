import { useState, type FormEvent } from "react";
import { Send, CheckCircle2, AlertTriangle } from "lucide-react";

type Props = {
  source: "contact_form" | "partner_referral";
  heading: string;
  intro: string;
  referral?: boolean;
};

type State = "idle" | "submitting" | "success" | "error";

export function LeadCaptureForm({ source, heading, intro, referral = false }: Props) {
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setState("submitting");
    setMessage("");

    const form = new FormData(formElement);
    const payload = Object.fromEntries(form.entries());
    const email = typeof payload.email === "string" ? payload.email.trim() : "";
    const phone = typeof payload.phone === "string" ? payload.phone.trim() : "";

    if (!email && !phone) {
      setState("error");
      setMessage("Enter an email address or phone number so STI Risk can follow up.");
      return;
    }

    try {
      const response = await fetch("/api/lead-capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, source }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to submit form");
      formElement.reset();
      setState("success");
      setMessage("Lead captured. STI Risk will follow up after staff review.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Unable to submit form");
    }
  }

  return (
    <section className="mx-auto grid max-w-6xl gap-8 px-6 py-16 lg:grid-cols-[0.9fr_1.1fr]">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-brand-orange">CRM Intake</div>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">{heading}</h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">{intro}</p>
        <div className="mt-8 space-y-3 text-sm text-muted-foreground">
          <p>Johannesburg, South Africa</p>
          <p>info@stirisk.co.za</p>
          <p>066 065 0602</p>
        </div>
      </div>

      <form onSubmit={submit} className="rounded-lg border border-border/60 bg-surface p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">First name</span>
            <input
              name="firstName"
              required
              className="h-10 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">Last name</span>
            <input
              name="lastName"
              className="h-10 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
            />
          </label>
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="text-muted-foreground">Organization</span>
            <input
              name="organizationName"
              required
              className="h-10 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">Email</span>
            <input
              name="email"
              type="email"
              className="h-10 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">Phone</span>
            <input
              name="phone"
              className="h-10 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">Role</span>
            <input
              name="roleTitle"
              className="h-10 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
            />
          </label>
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
            </select>
          </label>
          {referral && (
            <label className="space-y-1.5 text-sm sm:col-span-2">
              <span className="text-muted-foreground">Referral partner</span>
              <input
                name="referralPartner"
                className="h-10 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
              />
            </label>
          )}
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="text-muted-foreground">Estimated value (ZAR)</span>
            <input
              name="estimatedValue"
              type="number"
              min="0"
              step="1000"
              className="h-10 w-full rounded-md border border-border bg-background px-3 outline-none focus:border-brand-orange"
            />
          </label>
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="text-muted-foreground">Message</span>
            <textarea
              name="message"
              required
              rows={5}
              className="w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-brand-orange"
            />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            disabled={state === "submitting"}
            type="submit"
            className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Send className="h-4 w-4" />
            {state === "submitting" ? "Submitting" : "Submit"}
          </button>
          {message && (
            <span
              aria-live="polite"
              className={`inline-flex items-center gap-2 text-sm ${state === "error" ? "text-destructive" : "text-emerald-400"}`}
            >
              {state === "error" ? (
                <AlertTriangle className="h-4 w-4" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {message}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
