import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { AlertTriangle, LogIn } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

export const Route = createFileRoute("/staff/login")({
  head: () => ({ meta: [{ title: "Login - STI Risk" }] }),
  component: StaffLogin,
});

const errors: Record<string, string> = {
  domain: "Use a stirisk.co.za Microsoft account.",
  sso_state: "The sign-in session could not be verified.",
  sso_expired: "The sign-in session expired.",
  sso_token: "Microsoft sign-in did not return a valid session.",
  sso_config: "Microsoft SSO is not configured yet.",
};

type MicrosoftStatus = {
  configured: boolean;
  mode: string;
  message: string;
};

function StaffLogin() {
  const search = useRouterState({ select: (s) => s.location.search });
  const error = typeof search.error === "string" ? errors[search.error] : "";
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(false);
  const [microsoftStatus, setMicrosoftStatus] = useState<MicrosoftStatus | null>(null);

  useEffect(() => {
    fetch("/api/auth/microsoft/status")
      .then(async (response) => {
        const body = await response.json();
        if (response.ok) setMicrosoftStatus(body);
      })
      .catch(() => undefined);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setLoginError("");

    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Login failed");
      window.location.href = "/staff";
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="staff-app grid min-h-screen place-items-center bg-slate-100 px-6">
      <div className="staff-panel w-full max-w-sm rounded-md border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/60">
        <div className="flex flex-col items-center gap-3 text-center">
          <img
            src="/sti-logo-icon.png"
            alt="STI Risk logo"
            className="h-14 w-14 rounded-sm object-contain"
            width={96}
            height={96}
          />
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-brand-blue">
              Login
            </div>
            <div className="mt-1 text-sm font-bold text-slate-950">
              STI <span className="text-[#f59e0b]">RISK</span>
            </div>
          </div>
        </div>
        <h1 className="mt-7 text-center text-2xl font-semibold text-slate-950">Sign in</h1>
        <p className="mt-2 text-center text-sm leading-5 text-slate-600">
          Use Microsoft SSO for staff access. Password login is reserved for configured break-glass
          access.
        </p>

        {(error || loginError) && (
          <div className="mt-5 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error || loginError}
          </div>
        )}

        <a
          href="/api/auth/microsoft/start"
          aria-disabled={!microsoftStatus?.configured}
          onClick={(event) => {
            if (!microsoftStatus?.configured) event.preventDefault();
          }}
          className={`mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold shadow-sm ${
            microsoftStatus?.configured
              ? "bg-brand-blue text-white hover:brightness-105"
              : "cursor-not-allowed bg-slate-300 text-slate-600"
          }`}
        >
          <LogIn className="h-4 w-4" />
          Continue with Microsoft
        </a>
        {microsoftStatus && !microsoftStatus.configured && (
          <p className="mt-2 text-center text-xs leading-5 text-slate-500">
            Microsoft SSO is waiting for single-tenant Entra configuration.
          </p>
        )}

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-border/70" />
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Password login
          </span>
          <div className="h-px flex-1 bg-border/70" />
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block space-y-1.5 text-sm">
            <span className="text-slate-700">Email</span>
            <input
              name="email"
              type="email"
              required
              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-slate-950 placeholder:text-slate-400 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="text-slate-700">Password</span>
            <input
              name="password"
              type="password"
              required
              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-slate-950 placeholder:text-slate-400 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
            />
          </label>
          <button
            disabled={loading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-brand-blue bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <LogIn className="h-4 w-4" />
            {loading ? "Signing in" : "Sign in with password"}
          </button>
        </form>
      </div>
    </div>
  );
}
