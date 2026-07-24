import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  FileSearch,
  FileSignature,
  FileText,
  ListChecks,
  Mail,
  PackageSearch,
  Search,
  Send,
  ShieldCheck,
  Workflow,
} from "lucide-react";

export const Route = createFileRoute("/staff/steve")({
  component: SteveAi,
});

type ApprovalRequest = {
  id: string;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  status: string;
  title: string;
  summary: string | null;
  created_at: string;
  decided_at: string | null;
  requested_by_name: string | null;
  assigned_to_name: string | null;
};

const modes = [
  { label: "Ask Steve", detail: "Ask operational questions across CRM, work, quotes, and RAG.", icon: Bot },
  { label: "Search client history", detail: "Find account, site, quote, report, and evidence context.", icon: Search },
  { label: "Generate quote draft", detail: "Prepare quote structure and line suggestions for approval.", icon: FileSignature },
  { label: "Build quote template", detail: "Create reusable quotation templates for the Quotes tab.", icon: FileSignature },
  { label: "Extract PO", detail: "Read uploaded POs and propose quote/client/project matches.", icon: PackageSearch },
  { label: "Summarise project", detail: "Brief Vusi or Kiril on status, blockers, and next action.", icon: FileSearch },
  { label: "Draft report", detail: "Turn structured field data into report sections.", icon: FileText },
  { label: "Check missing documents", detail: "Find missing POs, signed job cards, reports, and invoices.", icon: ListChecks },
  { label: "Prepare client update", detail: "Draft email or WhatsApp text for human approval.", icon: Mail },
  { label: "Send to n8n", detail: "Trigger approved workflow actions and reminders.", icon: Workflow },
] as const;

const permissions = [
  ["Search records", "Allowed"],
  ["Summarise records", "Allowed"],
  ["Draft quotes / reports", "Allowed"],
  ["Create quote templates", "Allowed for Kiril and super admin"],
  ["Create tasks / follow-ups", "Allowed with audit trail"],
  ["Send quote, WhatsApp, or email", "Approval required"],
  ["Create sales order or subcontractor PO", "Approval required"],
  ["Mark invoice paid", "Confirmed finance action only"],
  ["Delete records", "Not allowed"],
];

function SteveAi() {
  const [approvalCount, setApprovalCount] = useState(0);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [busyId, setBusyId] = useState("");

  async function loadApprovals() {
    const response = await fetch("/api/steve/approvals");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Approvals failed to load");
    const rows = (body.approvals ?? []) as ApprovalRequest[];
    setApprovals(rows);
    setApprovalCount(rows.filter((item) => item.status === "pending").length);
  }

  useEffect(() => {
    loadApprovals().catch(() => {
      setApprovalCount(0);
      setApprovals([]);
    });
  }, []);

  async function decideApproval(id: string, status: "approved" | "rejected") {
    setBusyId(id);
    try {
      const response = await fetch(`/api/steve/approvals/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Approval failed");
      await loadApprovals();
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Operating assistant
          </div>
          <h1 className="text-2xl font-bold">Steve AI</h1>
          <p className="text-sm text-muted-foreground">
            Steve prepares, recommends, drafts, validates, reminds, summarises, and escalates across
            the STI Operating OS.
          </p>
        </div>
        <Link
          to="/staff/chat"
          className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
        >
          <Send className="h-4 w-4" /> Open chat
        </Link>
      </div>

      <div className="rounded-lg border border-brand-orange/30 bg-brand-orange/5 p-4 text-sm">
        <span className="font-semibold">{approvalCount}</span> Steve action(s) are waiting for
        approval before sending, syncing, or changing operational records.
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {modes.map((mode) => (
          <Link
            key={mode.label}
            to="/staff/chat"
            className="rounded-lg border border-border/60 bg-white p-5 hover:border-brand-orange/50 hover:bg-surface"
          >
            <mode.icon className="h-5 w-5 text-brand-blue" />
            <div className="mt-4 text-sm font-semibold">{mode.label}</div>
            <p className="mt-2 text-sm text-muted-foreground">{mode.detail}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-surface p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-brand-blue" />
            Permission boundaries
          </div>
          <div className="mt-4 divide-y divide-border/40">
            {permissions.map(([action, boundary]) => (
              <div key={action} className="flex items-center justify-between gap-4 py-3 text-sm">
                <span>{action}</span>
                <span className="font-medium text-brand-blue">{boundary}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-surface p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Mail className="h-4 w-4 text-brand-blue" />
            Pending approvals
          </div>
          <div className="mt-4 divide-y divide-border/40">
            {approvals
              .filter((item) => item.status === "pending")
              .slice(0, 8)
              .map((item) => (
                <div key={item.id} className="py-3 text-sm">
                  <div className="font-medium">{item.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.action_type.replaceAll("_", " ")}
                    {item.summary ? ` · ${item.summary}` : ""}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => void decideApproval(item.id, "approved")}
                      className="rounded-md bg-brand-orange px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => void decideApproval(item.id, "rejected")}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-white disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            {approvals.filter((item) => item.status === "pending").length === 0 && (
              <div className="py-8 text-sm text-muted-foreground">No approvals waiting.</div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-surface p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            Connected context
          </div>
          <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            {[
              "CRM contacts",
              "Clients",
              "Quotes",
              "Projects",
              "Tasks",
              "Billing",
              "WhatsApp",
              "Microsoft email/docs",
              "RAG documents",
              "n8n workflows",
              "Hermes",
              "PostgreSQL / pgvector",
            ].map((source) => (
              <div key={source} className="rounded-md border border-border/60 bg-white px-3 py-2">
                {source}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
