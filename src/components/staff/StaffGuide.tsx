import { useEffect, useMemo, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Banknote,
  BarChart3,
  Bot,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  FileStack,
  Handshake,
  Megaphone,
  Route,
  Wrench,
  X,
} from "lucide-react";

export type GuideId =
  | "overview"
  | "workflow"
  | "steve"
  | "kpi"
  | "finance"
  | "capability"
  | "partners"
  | "time"
  | "referrals"
  | "inspections"
  | "reports"
  | "transaction";

export type GuideStep = {
  target?: string;
  route?: string;
  advanceOnClick?: boolean;
  eyebrow: string;
  title: string;
  body: string;
};

export const guides: Record<
  GuideId,
  { label: string; description: string; icon: typeof Route; steps: GuideStep[] }
> = {
  overview: {
    label: "Staff portal overview",
    description: "Navigation, search and the operating workspace",
    icon: Route,
    steps: [
      {
        eyebrow: "Welcome to STI Risk",
        title: "Your operating workspace",
        body: "This short guide shows you where work lives and how to find it. You can skip now and restart any guide from Help.",
      },
      {
        target: '[data-guide="navigation"]',
        eyebrow: "01 · Navigate",
        title: "Work follows the operating chain",
        body: "Use the left navigation to move from clients and quotes through POs, field work, reports and finance.",
      },
      {
        target: '[data-guide="search"]',
        eyebrow: "02 · Find",
        title: "Search across operations",
        body: "Search for a client, quote, job, contact or task. Results open the relevant operational record.",
      },
      {
        target: '[data-guide="command-centre"]',
        eyebrow: "03 · Prioritise",
        title: "Start with the Command Centre",
        body: "Use this view to scan pipeline, active work, open quotes and finance before moving into a detailed queue.",
      },
      {
        target: '[data-guide="steve-nav"]',
        eyebrow: "04 · Assist",
        title: "Ask Steve for context",
        body: "Steve can search and summarise operations, and can create safe internal drafts. Outbound and financial actions still require approval.",
      },
    ],
  },
  workflow: {
    label: "Quote-to-report workflow",
    description: "The core operational hand-off, end to end",
    icon: Route,
    steps: [
      {
        eyebrow: "Operating workflow",
        title: "Quote to evidence",
        body: "The portal keeps each hand-off connected. These are the main queues staff use to move work forward.",
      },
      {
        target: '[data-guide="nav-quotes"]',
        eyebrow: "01 · Quote",
        title: "Build and approve the quote",
        body: "Create the three required sections, complete technical review, then send or sign with the client.",
      },
      {
        target: '[data-guide="nav-po-orders"]',
        eyebrow: "02 · PO",
        title: "Capture the client PO",
        body: "Match the PO to its quote. A complete match automatically creates the sales-order draft.",
      },
      {
        target: '[data-guide="nav-field-work"]',
        eyebrow: "03 · Field work",
        title: "Issue and track site work",
        body: "Issue subcontractor work, review the job link and follow field submissions from the site.",
      },
      {
        target: '[data-guide="nav-reports"]',
        eyebrow: "04 · Report",
        title: "Review evidence and sign-off",
        body: "Review completed work and client sign-off before invoicing or subcontractor payment can proceed.",
      },
    ],
  },
  steve: {
    label: "Working with Steve AI",
    description: "Search, drafts, actions and approvals",
    icon: Bot,
    steps: [
      {
        eyebrow: "Steve AI",
        title: "An assistant grounded in your records",
        body: "Steve works with indexed operational context and keeps an audit trail of actions taken through the portal.",
      },
      {
        target: '[data-guide="steve-nav"]',
        eyebrow: "01 · Open",
        title: "Use the dedicated workspace",
        body: "Open Steve AI for longer questions, record summaries, recommendations and internal draft creation.",
      },
      {
        target: '[data-guide="search"]',
        eyebrow: "02 · Search",
        title: "Use search for a direct lookup",
        body: "For a known client, quote or task, global search is usually the fastest route. Ask Steve when you need synthesis or a recommendation.",
      },
      {
        target: '[data-guide="help"]',
        eyebrow: "03 · Control",
        title: "Approval remains visible",
        body: "External messages and financial actions remain approval-gated. Return to Help whenever you need to replay this guide.",
      },
    ],
  },
  kpi: {
    label: "KPI dashboard and drill-down",
    description: "Read the operating numbers and trace them to records",
    icon: BarChart3,
    steps: [
      {
        eyebrow: "Reporting",
        title: "Start with the numbers",
        body: "Use Reports to review pipeline, quotations, revenue, and service-delivery measures over the current operating data.",
      },
      {
        target: '[data-guide="nav-reports"]',
        eyebrow: "01 · Reports",
        title: "Open the KPI dashboard",
        body: "The Reports page groups the core measures into tiles and supporting breakdowns.",
      },
      {
        eyebrow: "02 · Drill down",
        title: "Follow the source records",
        body: "Select a KPI tile or drill-down link to inspect the underlying quotes, deals, invoices, payments, or work items behind the number.",
      },
    ],
  },
  finance: {
    label: "Finance and cash-flow alerts",
    description: "Track balances, payment release, and internal alerts",
    icon: Banknote,
    steps: [
      {
        eyebrow: "Finance",
        title: "Keep payment visibility connected",
        body: "Finance brings invoices, client POs, sales orders, work items, and subcontractor payment context into one operating view.",
      },
      {
        target: '[data-guide="nav-billing"]',
        eyebrow: "01 · Billing",
        title: "Review payment status",
        body: "Use Finance to inspect invoices, collections, outstanding balances, and payment-release context.",
      },
      {
        target: '[data-guide="nav-subcontractors"]',
        eyebrow: "02 · Subcontractors",
        title: "Watch internal alerts",
        body: "Cash-flow alerts are internal notifications for Vusi. They do not automatically message subcontractors or block work assignment.",
      },
    ],
  },
  capability: {
    label: "Capability checklist",
    description: "Turn capability objectives into trackable work",
    icon: Wrench,
    steps: [
      {
        eyebrow: "Capability",
        title: "Keep development visible",
        body: "The checklist turns seeded capability objectives into tasks that can be added, completed, reopened, or cancelled.",
      },
      {
        target: '[data-guide="nav-capability"]',
        eyebrow: "01 · Open",
        title: "Open Capability Checklist",
        body: "Review objectives and their current task status from the dedicated staff workspace.",
      },
      {
        target: '[data-guide="nav-work"]',
        eyebrow: "02 · Follow up",
        title: "Work remains in Tasks",
        body: "Capability actions reuse the existing tasks infrastructure, so follow-up and completion history stay in the normal work queue.",
      },
    ],
  },
  partners: {
    label: "Partner development pipeline",
    description: "Track relationship development and follow-ups",
    icon: Handshake,
    steps: [
      {
        eyebrow: "Partner development",
        title: "Build the relationship pipeline",
        body: "Use the existing CRM relationship data and follow-up actions to keep sprinkler, insurance, competitor, and other partner opportunities visible.",
      },
      {
        target: '[data-guide="nav-growth"]',
        eyebrow: "01 · Growth",
        title: "Open the growth workspace",
        body: "Review partner and relationship activity alongside the other growth work already in the CRM.",
      },
      {
        target: '[data-guide="nav-work"]',
        eyebrow: "02 · Follow up",
        title: "Turn next steps into actions",
        body: "Create or update follow-up tasks rather than maintaining a second action list outside the platform.",
      },
    ],
  },
  time: {
    label: "Daily time tracking",
    description: "Log activity against the Category A–F structure",
    icon: CalendarClock,
    steps: [
      {
        eyebrow: "Time tracking",
        title: "Make the week visible",
        body: "Log activity against Revenue Development, Partner Development, Project Delivery, Quotations, Strategy & Management, or Travel.",
      },
      {
        target: '[data-guide="nav-vusi"]',
        eyebrow: "01 · Log",
        title: "Use the Vusi Workspace",
        body: "Add a time entry with its category, date, duration, and context from the existing workspace.",
      },
      {
        eyebrow: "02 · Review",
        title: "Use the weekly roll-up",
        body: "The weekly summary helps compare where time went without creating a separate reporting system.",
      },
    ],
  },
  referrals: {
    label: "Testimonials and referrals",
    description: "Capture the next action when work is nearing completion",
    icon: Megaphone,
    steps: [
      {
        eyebrow: "Client advocacy",
        title: "Ask at the right moment",
        body: "Near-completion work can create an internal follow-up task for a testimonial or referral, keeping the prompt attached to the project context.",
      },
      {
        target: '[data-guide="nav-work"]',
        eyebrow: "01 · Review",
        title: "Work the follow-up queue",
        body: "Open the task in Work, review its source context, and record the outcome or next action.",
      },
      {
        eyebrow: "02 · Keep it human",
        title: "No automatic client message",
        body: "The trigger creates an internal task only. Staff decide what to send and when, using the existing approval-aware workflow.",
      },
    ],
  },
  inspections: {
    label: "Inspections and survey reports",
    description: "Capture evidence, findings, remediation, and sign-off",
    icon: ClipboardCheck,
    steps: [
      {
        eyebrow: "Inspections",
        title: "Capture structured field evidence",
        body: "Use templates, required photos, GPS/location evidence, signatures, findings, risk levels, and SANS clauses to keep the inspection record complete.",
      },
      {
        target: '[data-guide="nav-inspections"]',
        eyebrow: "01 · Capture",
        title: "Run the inspection",
        body: "Start from the inspection workspace and complete the required field capture before reviewing the assembled report.",
      },
      {
        target: '[data-guide="nav-inspection-reports"]',
        eyebrow: "02 · Review",
        title: "Prepare the report",
        body: "Use Survey Reports to review findings, remediation, evidence, and the client sign-off path.",
      },
    ],
  },
  reports: {
    label: "Management reports and exports",
    description: "Generate snapshots and take them into the next conversation",
    icon: FileStack,
    steps: [
      {
        eyebrow: "Management reporting",
        title: "Generate a current snapshot",
        body: "Choose daily, weekly, or monthly and generate a report from live CRM, billing, quotation, and work-item records.",
      },
      {
        target: '[data-guide="nav-reports"]',
        eyebrow: "01 · Generate",
        title: "Open Reports",
        body: "The report page shows the selected period, revenue, opportunities, quotations, win rate, and service-delivery measures.",
      },
      {
        eyebrow: "02 · Export",
        title: "Share the result",
        body: "Use Excel-compatible CSV for analysis or Print / Save PDF for a meeting pack. Email delivery is planned but is not automatic in the current go-live scope.",
      },
    ],
  },
  transaction: {
    label: "Guided transaction walkthrough",
    description: "Walk the real quote-to-work path with tutorial records marked separately",
    icon: Route,
    steps: [
      {
        eyebrow: "Tutorial mode",
        title: "A real workflow with safe records",
        body: "This walkthrough follows the real STI Risk screens. Records created while Tutorial mode is active are marked separately and excluded from operating metrics.",
      },
      {
        route: "/staff",
        target: '[data-guide="nav-quotes"]',
        advanceOnClick: true,
        eyebrow: "01 · Start",
        title: "Open Quotes",
        body: "Click the real Quotes navigation item to begin the transaction.",
      },
      {
        route: "/staff/quotes",
        target: '[data-guide="transaction-new-quote"]',
        advanceOnClick: true,
        eyebrow: "02 · Quote",
        title: "Create the quote",
        body: "Click New Quote, complete the form, and submit it through the normal quote code path.",
      },
      {
        route: "/staff/quotes/new",
        target: '[data-guide="transaction-create-quote"]',
        advanceOnClick: true,
        eyebrow: "03 · Save",
        title: "Submit the real form",
        body: "Complete the required fields, then click Create Quote. Tutorial mode is attached automatically.",
      },
      {
        route: "/staff/quotes",
        target: '[data-guide="nav-po-orders"]',
        advanceOnClick: true,
        eyebrow: "04 · PO",
        title: "Move to PO capture",
        body: "After saving the tutorial quote, click POs & Orders to continue through the normal hand-off.",
      },
      {
        route: "/staff/po-orders",
        target: '[data-guide="nav-field-work"]',
        advanceOnClick: true,
        eyebrow: "05 · Work",
        title: "Move to field work",
        body: "Use the real Field Work queue for the next operational hand-off.",
      },
      {
        route: "/staff/field-work",
        target: '[data-guide="nav-inspections"]',
        advanceOnClick: true,
        eyebrow: "06 · Inspect",
        title: "Move to inspection capture",
        body: "Continue to Inspections to review the field evidence path.",
      },
      {
        route: "/staff/inspections",
        target: '[data-guide="nav-inspection-reports"]',
        advanceOnClick: true,
        eyebrow: "07 · Report",
        title: "Move to report review",
        body: "Use Survey Reports for the assembled findings and sign-off hand-off.",
      },
      {
        route: "/staff/inspection-reports",
        target: '[data-guide="nav-billing"]',
        advanceOnClick: true,
        eyebrow: "08 · Billing",
        title: "Finish at Finance",
        body: "The route ends at Finance, where the real invoice and payment workflow lives.",
      },
      {
        eyebrow: "09 · Finish",
        title: "Transaction walkthrough complete",
        body: "The route has followed the real quote → PO → field work → inspection → report → billing chain. Select Done to remove tutorial records, or close the guide earlier to clean them up safely.",
      },
    ],
  },
};

const STORAGE_KEY = "sti-risk-staff-guide-completed";

export function StaffHelpMenu({
  onStart,
  onReportBug,
}: {
  onStart: (id: GuideId) => void;
  onReportBug: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  return (
    <div className="relative" data-guide="help" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="staff-header-button gap-2 px-3"
        aria-label="Open help and guided tours"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <CircleHelp className="h-4 w-4" />
        <span className="hidden text-sm font-medium sm:inline">Help</span>
      </button>
      {open && (
        <div className="staff-panel absolute right-0 top-12 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-md border bg-white p-2 shadow-xl">
          <div className="px-3 pb-2 pt-2">
            <div className="text-sm font-semibold text-foreground">Guided help</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Choose a walkthrough. Your work will not be changed.
            </div>
          </div>
          <Link
            to="/staff/help"
            className="mb-1 block rounded-md border border-border/60 px-3 py-2 text-xs font-medium text-brand-blue hover:bg-surface-2"
            onClick={() => setOpen(false)}
          >
            Open Help Center
          </Link>
          <button
            type="button"
            className="mb-1 flex w-full items-center gap-2 rounded-md border border-dashed border-brand-orange/50 px-3 py-2 text-left text-xs font-medium text-brand-orange hover:bg-orange-50"
            onClick={() => {
              setOpen(false);
              onReportBug();
            }}
          >
            Report a bug
          </button>
          {Object.entries(guides).map(([id, guide]) => (
            <button
              key={id}
              type="button"
              className="flex w-full items-start gap-3 rounded-md px-3 py-3 text-left hover:bg-surface-2"
              onClick={() => {
                setOpen(false);
                onStart(id as GuideId);
              }}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border bg-white text-brand-blue">
                <guide.icon className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm font-medium text-foreground">{guide.label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  {guide.description}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function StaffGuide({ request, onClose }: { request: GuideId | null; onClose: () => void }) {
  const [guideId, setGuideId] = useState<GuideId | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    if (request) {
      setGuideId(request);
      setStepIndex(0);
      if (request === "transaction") {
        document.cookie = "sti_tutorial=1; Path=/; SameSite=Lax";
        window.localStorage.setItem("sti-risk-transaction-guide", "active");
      }
      return;
    }
    if (window.localStorage.getItem(STORAGE_KEY) !== "true") {
      setGuideId("overview");
      setStepIndex(0);
    }
  }, [request]);

  const step = guideId ? guides[guideId].steps[stepIndex] : null;

  useEffect(() => {
    if (!step?.target || (step.route && !pathname.startsWith(step.route))) {
      setTargetRect(null);
      return;
    }
    const update = () => {
      const target = document.querySelector(step.target!);
      setTargetRect(target?.getBoundingClientRect() ?? null);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [pathname, step]);

  useEffect(() => {
    if (!step?.advanceOnClick || !step.target || (step.route && !pathname.startsWith(step.route)))
      return;
    const target = document.querySelector(step.target);
    if (!target) return;
    const advance = () => setStepIndex((value) => value + 1);
    target.addEventListener("click", advance, true);
    return () => target.removeEventListener("click", advance, true);
  }, [pathname, step]);

  const cardStyle = useMemo(() => {
    if (!targetRect || typeof window === "undefined") return undefined;
    const width = Math.min(380, window.innerWidth - 32);
    const left = Math.min(Math.max(16, targetRect.right + 18), window.innerWidth - width - 16);
    const preferBelow = targetRect.bottom + 280 < window.innerHeight;
    const top = preferBelow
      ? targetRect.bottom + 18
      : Math.max(16, Math.min(targetRect.top, window.innerHeight - 300));
    return { left, top, width };
  }, [targetRect]);

  if (!guideId || !step) return null;
  const total = guides[guideId].steps.length;
  const finish = () => {
    if (guideId === "transaction") {
      void fetch("/api/tutorial/cleanup", { method: "POST" });
      document.cookie = "sti_tutorial=; Path=/; Max-Age=0; SameSite=Lax";
      window.localStorage.removeItem("sti-risk-transaction-guide");
    }
    window.localStorage.setItem(STORAGE_KEY, "true");
    setGuideId(null);
    onClose();
  };

  return (
    <div
      className={`fixed inset-0 z-[100] ${step.advanceOnClick ? "pointer-events-none" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={guides[guideId].label}
    >
      <div className="pointer-events-none absolute inset-0 bg-slate-950/55 backdrop-blur-[1px]" />
      {targetRect && (
        <div
          className="pointer-events-none fixed rounded-md border-2 border-amber-400 bg-white/5 shadow-[0_0_0_5px_rgba(245,158,11,0.18)] transition-all"
          style={{
            left: targetRect.left - 6,
            top: targetRect.top - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
          }}
        />
      )}
      <section
        className={`pointer-events-auto staff-guide-card fixed overflow-hidden rounded-md border border-white/15 bg-white shadow-2xl ${targetRect ? "" : "left-1/2 top-1/2 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2"}`}
        style={cardStyle}
      >
        <div className="h-1 bg-slate-100">
          <div
            className="h-full bg-amber-500 transition-all"
            style={{ width: `${((stepIndex + 1) / total) * 100}%` }}
          />
        </div>
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="text-[11px] font-semibold uppercase text-amber-700">{step.eyebrow}</div>
            <button
              type="button"
              className="-mr-2 -mt-2 grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              onClick={finish}
              aria-label="Skip guide"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <h2 className="mt-2 text-xl font-semibold text-slate-900">{step.title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{step.body}</p>
          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              className="text-sm font-medium text-slate-500 hover:text-slate-800"
              onClick={finish}
            >
              Skip tour
            </button>
            <div className="flex items-center gap-2">
              {stepIndex > 0 && (
                <button
                  type="button"
                  className="staff-guide-secondary"
                  onClick={() => setStepIndex((value) => value - 1)}
                  aria-label="Previous step"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                className="staff-guide-primary"
                onClick={() =>
                  stepIndex === total - 1 ? finish() : setStepIndex((value) => value + 1)
                }
              >
                {stepIndex === total - 1 ? (
                  <>
                    <Check className="h-4 w-4" /> Done
                  </>
                ) : (
                  <>
                    Next <ChevronRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </div>
          <div className="mt-4 text-right text-[11px] text-slate-400">
            {stepIndex + 1} of {total}
          </div>
        </div>
      </section>
    </div>
  );
}
