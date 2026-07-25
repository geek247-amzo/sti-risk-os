import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bot, Check, ChevronLeft, ChevronRight, CircleHelp, Route, X } from "lucide-react";

export type GuideId = "overview" | "workflow" | "steve";

export type GuideStep = {
  target?: string;
  eyebrow: string;
  title: string;
  body: string;
};

export const guides: Record<GuideId, { label: string; description: string; icon: typeof Route; steps: GuideStep[] }> = {
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
      { target: '[data-guide="nav-quotes"]', eyebrow: "01 · Quote", title: "Build and approve the quote", body: "Create the three required sections, complete technical review, then send or sign with the client." },
      { target: '[data-guide="nav-po-orders"]', eyebrow: "02 · PO", title: "Capture the client PO", body: "Match the PO to its quote. A complete match automatically creates the sales-order draft." },
      { target: '[data-guide="nav-field-work"]', eyebrow: "03 · Field work", title: "Issue and track site work", body: "Issue subcontractor work, review the job link and follow field submissions from the site." },
      { target: '[data-guide="nav-reports"]', eyebrow: "04 · Report", title: "Review evidence and sign-off", body: "Review completed work and client sign-off before invoicing or subcontractor payment can proceed." },
    ],
  },
  steve: {
    label: "Working with Steve AI",
    description: "Search, drafts, actions and approvals",
    icon: Bot,
    steps: [
      { eyebrow: "Steve AI", title: "An assistant grounded in your records", body: "Steve works with indexed operational context and keeps an audit trail of actions taken through the portal." },
      { target: '[data-guide="steve-nav"]', eyebrow: "01 · Open", title: "Use the dedicated workspace", body: "Open Steve AI for longer questions, record summaries, recommendations and internal draft creation." },
      { target: '[data-guide="search"]', eyebrow: "02 · Search", title: "Use search for a direct lookup", body: "For a known client, quote or task, global search is usually the fastest route. Ask Steve when you need synthesis or a recommendation." },
      { target: '[data-guide="help"]', eyebrow: "03 · Control", title: "Approval remains visible", body: "External messages and financial actions remain approval-gated. Return to Help whenever you need to replay this guide." },
    ],
  },
};

const STORAGE_KEY = "sti-risk-staff-guide-completed";

export function StaffHelpMenu({ onStart }: { onStart: (id: GuideId) => void }) {
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
            <div className="mt-0.5 text-xs text-muted-foreground">Choose a walkthrough. Your work will not be changed.</div>
          </div>
          <Link
            to="/staff/help"
            className="mb-1 block rounded-md border border-border/60 px-3 py-2 text-xs font-medium text-brand-blue hover:bg-surface-2"
            onClick={() => setOpen(false)}
          >
            Open Help Center
          </Link>
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
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{guide.description}</span>
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

  useEffect(() => {
    if (request) {
      setGuideId(request);
      setStepIndex(0);
      return;
    }
    if (window.localStorage.getItem(STORAGE_KEY) !== "true") {
      setGuideId("overview");
      setStepIndex(0);
    }
  }, [request]);

  const step = guideId ? guides[guideId].steps[stepIndex] : null;

  useEffect(() => {
    if (!step?.target) {
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
  }, [step]);

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
    window.localStorage.setItem(STORAGE_KEY, "true");
    setGuideId(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label={guides[guideId].label}>
      <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-[1px]" />
      {targetRect && (
        <div
          className="pointer-events-none fixed rounded-md border-2 border-amber-400 bg-white/5 shadow-[0_0_0_5px_rgba(245,158,11,0.18)] transition-all"
          style={{ left: targetRect.left - 6, top: targetRect.top - 6, width: targetRect.width + 12, height: targetRect.height + 12 }}
        />
      )}
      <section
        className={`staff-guide-card fixed overflow-hidden rounded-md border border-white/15 bg-white shadow-2xl ${targetRect ? "" : "left-1/2 top-1/2 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2"}`}
        style={cardStyle}
      >
        <div className="h-1 bg-slate-100">
          <div className="h-full bg-amber-500 transition-all" style={{ width: `${((stepIndex + 1) / total) * 100}%` }} />
        </div>
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="text-[11px] font-semibold uppercase text-amber-700">{step.eyebrow}</div>
            <button type="button" className="-mr-2 -mt-2 grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={finish} aria-label="Skip guide">
              <X className="h-4 w-4" />
            </button>
          </div>
          <h2 className="mt-2 text-xl font-semibold text-slate-900">{step.title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{step.body}</p>
          <div className="mt-6 flex items-center justify-between gap-3">
            <button type="button" className="text-sm font-medium text-slate-500 hover:text-slate-800" onClick={finish}>Skip tour</button>
            <div className="flex items-center gap-2">
              {stepIndex > 0 && (
                <button type="button" className="staff-guide-secondary" onClick={() => setStepIndex((value) => value - 1)} aria-label="Previous step"><ChevronLeft className="h-4 w-4" /></button>
              )}
              <button type="button" className="staff-guide-primary" onClick={() => stepIndex === total - 1 ? finish() : setStepIndex((value) => value + 1)}>
                {stepIndex === total - 1 ? <><Check className="h-4 w-4" /> Done</> : <>Next <ChevronRight className="h-4 w-4" /></>}
              </button>
            </div>
          </div>
          <div className="mt-4 text-right text-[11px] text-slate-400">{stepIndex + 1} of {total}</div>
        </div>
      </section>
    </div>
  );
}
