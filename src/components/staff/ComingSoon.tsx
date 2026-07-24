import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, LockKeyhole } from "lucide-react";

type ComingSoonProps = {
  title: string;
  eyebrow: string;
  description: string;
  icon: LucideIcon;
};

export function ComingSoon({ title, eyebrow, description, icon: Icon }: ComingSoonProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Link
          to="/staff"
          className="inline-flex items-center gap-2 rounded-md border border-border bg-white px-3.5 py-2 text-sm font-semibold hover:bg-surface-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Dashboard
        </Link>
      </div>

      <section className="staff-panel rounded-md border border-border bg-white p-8">
        <div className="flex max-w-3xl items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-blue/15 text-brand-blue">
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-brand-blue">
              <LockKeyhole className="h-4 w-4" />
              Not enabled
            </div>
            <h2 className="mt-2 text-lg font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This module is not enabled for the current production MVP. Use the active staff
              workflows in the dashboard, CRM, growth, projects, tasks, billing, and settings areas.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
