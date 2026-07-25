import { createFileRoute } from "@tanstack/react-router";
import {
  BookOpen,
  CircleHelp,
  ExternalLink,
  PlayCircle,
  Route as RouteIcon,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { StaffGuide, guides, type GuideId } from "@/components/staff/StaffGuide";

export const Route = createFileRoute("/staff/help")({
  component: StaffHelpCenter,
});

const referenceTopics = [
  {
    title: "Reports and KPI drill-down",
    description:
      "Generate daily, weekly, or monthly snapshots, then follow KPI tiles to the records behind each number. Export CSV or print the generated report.",
    href: "/staff/reports",
  },
  {
    title: "Inspections and survey reports",
    description:
      "Capture structured findings, evidence, remediation, risk levels, and sign-off-ready reports. Public inspection links keep evidence behind token-scoped URLs.",
    href: "/staff/inspections",
  },
  {
    title: "Tasks and approvals",
    description:
      "Use Work for follow-ups, capability actions, and operational queues. External messages and sensitive financial actions remain approval-gated.",
    href: "/staff/work",
  },
  {
    title: "Steve AI",
    description:
      "Ask Steve to search and summarise indexed operating context. Review and approve any external or consequential action before it is sent.",
    href: "/staff/steve",
  },
];

function StaffHelpCenter() {
  const [activeGuide, setActiveGuide] = useState<GuideId | null>(null);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-brand-blue">
            <CircleHelp className="h-4 w-4" /> Staff help
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Help Center</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Browse the operating guides or start a spotlight walkthrough. This page is a reference
            point for the shipped platform and will grow with each release.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-white px-3 py-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-brand-blue" /> Guides never change your work
        </div>
      </div>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <RouteIcon className="h-5 w-5 text-brand-blue" />
          <h2 className="text-lg font-semibold">Guided walkthroughs</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {Object.entries(guides).map(([id, guide]) => (
            <article
              key={id}
              className="flex flex-col rounded-lg border border-border/60 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-md bg-blue-50 text-brand-blue">
                  <guide.icon className="h-5 w-5" />
                </span>
                <span className="text-xs text-muted-foreground">{guide.steps.length} steps</span>
              </div>
              <h3 className="mt-4 font-semibold">{guide.label}</h3>
              <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">
                {guide.description}
              </p>
              <button
                type="button"
                className="mt-5 inline-flex items-center justify-center gap-2 rounded-md bg-brand-blue px-3 py-2 text-sm font-medium text-white hover:opacity-90"
                onClick={() => setActiveGuide(id as GuideId)}
              >
                <PlayCircle className="h-4 w-4" /> Start walkthrough
              </button>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-brand-blue" />
          <h2 className="text-lg font-semibold">Reference topics</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {referenceTopics.map((topic) => (
            <a
              key={topic.title}
              href={topic.href}
              className="group rounded-lg border border-border/60 bg-white p-5 shadow-sm hover:border-brand-blue/40 hover:bg-surface-2"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold group-hover:text-brand-blue">{topic.title}</h3>
                <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{topic.description}</p>
            </a>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-dashed border-border bg-surface-2 p-5">
        <h2 className="font-semibold">Need more help?</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          If a workflow is unclear or a page behaves unexpectedly, capture the page URL and describe
          the steps that led there. Bug-report capture will be added in Stream G4.
        </p>
      </section>

      <StaffGuide request={activeGuide} onClose={() => setActiveGuide(null)} />
    </div>
  );
}
