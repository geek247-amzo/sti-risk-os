import { createFileRoute, Link } from "@tanstack/react-router";
import { Bot, Mail, MessageSquare, PackageSearch, RefreshCw, Workflow } from "lucide-react";

export const Route = createFileRoute("/staff/automations")({
  component: Automations,
});

function Automations() {
  const workflows = [
    { label: "WhatsApp automations", icon: MessageSquare },
    { label: "Email automations", icon: Mail },
    { label: "PO extraction", icon: PackageSearch },
    { label: "Report reminders", icon: RefreshCw },
    { label: "Client follow-ups", icon: Workflow },
    { label: "Sage sync jobs", icon: Workflow },
    { label: "Microsoft Graph automations", icon: Mail },
    { label: "Steve to n8n actions", icon: Bot },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            n8n orchestration
          </div>
          <h1 className="text-2xl font-bold">Automations</h1>
          <p className="text-sm text-muted-foreground">
            Operational workflows for WhatsApp, email, PO extraction, reports, reminders, Sage, and
            Steve approvals.
          </p>
        </div>
        <Link
          to="/staff/settings"
          className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
        >
          <Workflow className="h-4 w-4" /> Integration status
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {workflows.map((workflow) => (
          <div key={workflow.label} className="rounded-lg border border-border/60 bg-white p-5">
            <workflow.icon className="h-5 w-5 text-brand-blue" />
            <div className="mt-4 text-sm font-semibold">{workflow.label}</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Connect this workflow to approval gates before it sends client or contractor
              communications.
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
