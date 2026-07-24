import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Building2, ChevronRight, Gauge, ShieldCheck, TrendingUp } from "lucide-react";

import caseTwin from "@/assets/case-digitaltwin.jpg";
import caseGen from "@/assets/case-generator.jpg";
import caseSrv from "@/assets/case-server.jpg";
import caseTrans from "@/assets/case-transformer.jpg";

export const Route = createFileRoute("/case-studies")({
  head: () => ({
    meta: [
      { title: "Case Studies — STI Risk" },
      {
        name: "description",
        content:
          "Selected STI Risk project outcomes across generator protection, transformer rooms, server rooms, and digital twin asset management.",
      },
      { property: "og:title", content: "STI Risk Case Studies" },
      {
        property: "og:description",
        content: "Selected industrial protection and improvement outcomes from STI Risk projects.",
      },
      { property: "og:url", content: "/case-studies" },
    ],
    links: [{ rel: "canonical", href: "/case-studies" }],
  }),
  component: CaseStudies,
});

const cases = [
  {
    img: caseGen,
    title: "Generator Fire Suppression",
    sector: "Critical Power",
    desc: "High-risk generator hall protected with clean agent suppression and practical response planning.",
    stat: "100%",
    statLabel: "Fire events suppressed",
  },
  {
    img: caseTrans,
    title: "Transformer Room Protection",
    sector: "Energy Assets",
    desc: "Integrated detection and suppression for transformer assets where downtime would disrupt operations.",
    stat: "0",
    statLabel: "Transformer fire incidents",
  },
  {
    img: caseSrv,
    title: "Server Room Suppression",
    sector: "IT Infrastructure",
    desc: "Clean agent protection for mission-critical server infrastructure with uptime as the core constraint.",
    stat: "100%",
    statLabel: "System uptime maintained",
  },
  {
    img: caseTwin,
    title: "Digital Twin Asset Management",
    sector: "Asset Visibility",
    desc: "Reality capture and digital twin workflows improved inspection speed and life-cycle planning.",
    stat: "30%",
    statLabel: "Reduction in inspection time",
  },
];

const patterns = [
  "Risk assessment before design",
  "Protection matched to asset criticality",
  "Operational continuity prioritized during deployment",
  "Evidence and audit trail retained for review",
];

function CaseStudies() {
  return (
    <>
      <section className="border-b border-border/60">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-blue">
              Case Studies
            </div>
            <h1 className="mt-3 text-4xl font-bold leading-tight md:text-5xl">
              Practical outcomes across{" "}
              <span className="text-brand-orange">critical industrial environments</span>
            </h1>
            <p className="mt-5 text-base leading-7 text-muted-foreground">
              Selected examples show how STI Risk applies detection, protection, and improvement
              work to facilities where asset loss, downtime, or poor visibility carries material
              operational risk.
            </p>
          </div>
        </div>
      </section>

      <section className="border-b border-border/60 bg-background/50">
        <div className="mx-auto grid max-w-7xl gap-5 px-6 py-12 md:grid-cols-2">
          {cases.map((item) => (
            <article
              key={item.title}
              className="overflow-hidden rounded-md border border-border/60 bg-surface"
            >
              <img
                src={item.img}
                alt={item.title}
                className="aspect-[16/9] w-full object-cover"
                width={900}
                height={520}
                loading="lazy"
              />
              <div className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-blue">
                    {item.sector}
                  </div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-brand-orange">
                    <TrendingUp className="h-4 w-4" />
                    {item.stat} {item.statLabel}
                  </div>
                </div>
                <h2 className="mt-3 text-xl font-semibold">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.desc}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="mx-auto grid max-w-7xl gap-8 px-6 py-12 lg:grid-cols-[0.8fr_1fr]">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-blue">
              Delivery Patterns
            </div>
            <h2 className="mt-2 text-3xl font-bold">What these projects have in common</h2>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              The work is shaped around real site constraints: uptime, asset criticality,
              compliance, maintenance access, and the need for decisions that operators can defend.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {patterns.map((pattern) => (
              <div
                key={pattern}
                className="flex items-center gap-3 rounded-md border border-border/60 bg-surface px-4 py-3 text-sm font-medium"
              >
                <ShieldCheck className="h-4 w-4 shrink-0 text-brand-orange" />
                {pattern}
              </div>
            ))}
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-6 pb-12">
          <div className="rounded-md border border-border/60 bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-brand-orange/15 text-brand-orange">
                  <Gauge className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold">Need a site-specific risk assessment?</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Share the facility, asset, or operational constraint that needs review.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link
                  to="/contact"
                  className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
                >
                  Start an Enquiry <ChevronRight className="h-4 w-4" />
                </Link>
                <Link
                  to="/services"
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-white px-4 py-2 text-sm font-semibold hover:bg-surface-2"
                >
                  View Services <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 border-t border-border/60 pt-4 text-sm text-muted-foreground">
              <Building2 className="h-4 w-4" />
              Built for mining, manufacturing, energy, automotive, and commercial facilities.
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
