import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  Building2,
  ChevronRight,
  ClipboardCheck,
  Cpu,
  Gauge,
  HardHat,
  ShieldCheck,
  TrendingUp,
  Zap,
} from "lucide-react";

import heroImg from "@/assets/hero-services.jpg";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — STI Risk" },
      {
        name: "description",
        content:
          "STI Risk helps industrial and commercial operators detect, protect, and improve critical operations across South Africa.",
      },
      { property: "og:title", content: "About STI Risk" },
      {
        property: "og:description",
        content:
          "Industrial risk specialists delivering monitoring, protection, energy, transformer, and digital twin solutions.",
      },
      { property: "og:url", content: "/about" },
    ],
    links: [{ rel: "canonical", href: "/about" }],
  }),
  component: About,
});

const principles = [
  {
    icon: Activity,
    title: "Detect earlier",
    copy: "Monitoring, sensing, inspection, and intelligence workflows surface risk before it becomes an incident.",
  },
  {
    icon: ShieldCheck,
    title: "Protect critical assets",
    copy: "Fire detection, suppression, surveillance, cyber security, and backup systems are designed around operational continuity.",
  },
  {
    icon: TrendingUp,
    title: "Improve performance",
    copy: "Energy efficiency, renewable financing, and digital twins help teams reduce cost while improving asset visibility.",
  },
];

const capabilities = [
  "Fire Detection & IoT",
  "Distributed Sensing",
  "Fire Suppression",
  "Transformer Health Monitoring",
  "Surveillance & Cyber Security",
  "Industrial Transformers & Back-up",
  "Financed Renewable Energy",
  "Digital Twins & Reality Capture",
  "Energy Efficiency",
];

const operatingModel = [
  {
    icon: ClipboardCheck,
    title: "Assess",
    copy: "Baseline the site, assets, hazards, standards, and operational constraints.",
  },
  {
    icon: Cpu,
    title: "Engineer",
    copy: "Design practical systems that match uptime, safety, compliance, and budget requirements.",
  },
  {
    icon: HardHat,
    title: "Deploy",
    copy: "Coordinate delivery with minimal disruption to active industrial operations.",
  },
  {
    icon: Gauge,
    title: "Optimise",
    copy: "Use data, maintenance insight, and review cycles to improve long-term performance.",
  },
];

function About() {
  return (
    <>
      <section className="border-b border-border/60">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-6 py-12 lg:grid-cols-[1fr_0.9fr]">
          <div>
            <h1 className="max-w-3xl text-4xl font-bold leading-tight md:text-5xl">
              Industrial risk specialists for{" "}
              <span className="text-brand-orange">safer, smarter operations</span>
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
              STI Risk works with industrial and commercial teams that need practical protection
              across high-value assets, complex sites, and business-critical operations.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-5 py-3 text-sm font-semibold text-primary-foreground hover:brightness-110"
              >
                Book a Risk Assessment <ChevronRight className="h-4 w-4" />
              </Link>
              <Link
                to="/services"
                className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-5 py-3 text-sm font-semibold hover:bg-surface-2"
              >
                Explore Services <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="overflow-hidden rounded-md border border-border/60">
            <img
              src={heroImg}
              alt="Industrial risk monitoring and protection work"
              className="aspect-[4/3] w-full object-cover"
              width={1280}
              height={800}
            />
          </div>
        </div>
      </section>

      <section className="border-b border-border/60 bg-background/50">
        <div className="mx-auto grid max-w-7xl gap-4 px-6 py-12 md:grid-cols-3">
          {principles.map((item) => {
            const Icon = item.icon;
            return (
              <article
                key={item.title}
                className="rounded-md border border-border/60 bg-surface p-5"
              >
                <Icon className="h-8 w-8 text-brand-orange" />
                <h2 className="mt-4 text-lg font-semibold">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.copy}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="border-b border-border/60">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-12 lg:grid-cols-[0.85fr_1fr]">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-blue">
              Capabilities
            </div>
            <h2 className="mt-2 text-3xl font-bold">
              One operating view across risk and resilience
            </h2>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              The company brings detection, protection, monitoring, energy, and digital asset
              visibility into one practical delivery model for industrial decision-makers.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {capabilities.map((capability) => (
              <div
                key={capability}
                className="flex items-center gap-3 rounded-md border border-border/60 bg-surface px-4 py-3 text-sm font-medium"
              >
                <ShieldCheck className="h-4 w-4 shrink-0 text-brand-orange" />
                {capability}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-blue">
                Delivery Model
              </div>
              <h2 className="mt-2 text-3xl font-bold">Built for active operations</h2>
            </div>
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Building2 className="h-4 w-4" />
              Mining, manufacturing, energy, automotive, and commercial facilities
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {operatingModel.map((item) => {
              const Icon = item.icon;
              return (
                <article
                  key={item.title}
                  className="rounded-md border border-border/60 bg-surface p-5"
                >
                  <Icon className="h-8 w-8 text-brand-orange" />
                  <h3 className="mt-4 font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.copy}</p>
                </article>
              );
            })}
          </div>
          <div className="mt-8 rounded-md border border-border/60 bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold">Ready to review site risk or asset resilience?</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Send the team a project, inspection, or operational continuity enquiry.
                </p>
              </div>
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
              >
                Contact STI Risk <Zap className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
