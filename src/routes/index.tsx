import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Search,
  ShieldCheck,
  TrendingUp,
  Flame,
  Zap,
  Box,
  ShieldAlert,
  Factory,
  Car,
  Building2,
  HardHat,
  Wrench,
  ClipboardCheck,
  Gauge,
  ChevronRight,
  Activity,
  Cpu,
  Wind,
} from "lucide-react";
import sFire from "@/assets/svc-fire-detection.jpg";
import sSensing from "@/assets/svc-sensing.jpg";
import sSupp from "@/assets/svc-suppression.jpg";
import sTrans from "@/assets/svc-transformer.jpg";
import sSurv from "@/assets/svc-surveillance.jpg";
import sBackup from "@/assets/svc-backup.jpg";
import sRenew from "@/assets/svc-renewable.jpg";
import sTwin from "@/assets/svc-digitaltwin.jpg";
import sEff from "@/assets/svc-efficiency.jpg";
import caseGen from "@/assets/case-generator.jpg";
import caseTrans from "@/assets/case-transformer.jpg";
import caseSrv from "@/assets/case-server.jpg";
import caseTwin from "@/assets/case-digitaltwin.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "STI Risk — Industrial Risk Intelligence for Safer, Smarter Operations" },
      {
        name: "description",
        content:
          "Specialised monitoring, renewable energy, fire suppression, transformer health and digital twin solutions for industrial and commercial operations.",
      },
      { property: "og:title", content: "STI Risk — Safer, Smarter Operations" },
      {
        property: "og:description",
        content: "Industrial risk intelligence across detection, protection and improvement.",
      },
      { property: "og:url", content: "/" },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: Home,
});

const lifecycle = [
  { img: sFire, label: "Fire Detection & IoT", icon: Flame },
  { img: sSensing, label: "Distributed Sensing", icon: Activity },
  { img: sSupp, label: "Fire Suppression", icon: ShieldAlert },
  { img: sTrans, label: "Transformer Health Monitoring", icon: Cpu },
  { img: sSurv, label: "Surveillance & Cyber Security", icon: ShieldCheck },
  { img: sBackup, label: "Industrial Transformers & Back-up", icon: Zap },
  { img: sRenew, label: "Financed Renewable Energy", icon: Wind },
  { img: sTwin, label: "Digital Twins & Reality Capture", icon: Box },
  { img: sEff, label: "Energy Efficiency", icon: Gauge },
];

const industries = [
  {
    icon: HardHat,
    label: "Mining",
    desc: "Protecting assets and people in demanding environments.",
  },
  {
    icon: Factory,
    label: "Manufacturing",
    desc: "Improving uptime and process safety across production lines.",
  },
  {
    icon: Zap,
    label: "Energy",
    desc: "Securing power assets and ensuring reliable energy delivery.",
  },
  {
    icon: Car,
    label: "Automotive",
    desc: "Enabling precision, safety and operational continuity.",
  },
  {
    icon: Building2,
    label: "Commercial Facilities",
    desc: "Delivering safer, smarter buildings and operations.",
  },
];

const cases = [
  {
    img: caseGen,
    title: "Generator Fire Suppression",
    desc: "High-risk generator hall protected with clean agent suppression system.",
    stat: "100%",
    statLabel: "Fire events suppressed",
  },
  {
    img: caseTrans,
    title: "Transformer Room Protection",
    desc: "Integrated detection and suppression for critical transformer assets.",
    stat: "0",
    statLabel: "Transformer fire incidents",
  },
  {
    img: caseSrv,
    title: "Server Room Suppression",
    desc: "Clean agent solution safeguards mission-critical IT infrastructure.",
    stat: "100%",
    statLabel: "System uptime maintained",
  },
  {
    img: caseTwin,
    title: "Digital Twin Asset Management",
    desc: "Reality capture and digital twin for asset visibility and life-cycle planning.",
    stat: "30%",
    statLabel: "Reduction in inspection time",
  },
];

const why = [
  {
    stat: "25+",
    label: "Years Experience",
    desc: "Deep industry knowledge and proven delivery.",
    icon: ShieldCheck,
  },
  {
    stat: "12+",
    label: "Industries Served",
    desc: "Solutions proven across diverse sectors.",
    icon: Building2,
  },
  {
    stat: "100%",
    label: "Compliance Focused",
    desc: "Aligned with SANS, NFPA, ISO and local standards.",
    icon: ClipboardCheck,
  },
  {
    stat: "99.9%",
    label: "Uptime Focused",
    desc: "Minimise downtime. Maximise productivity.",
    icon: Gauge,
  },
  {
    stat: null,
    label: "Safety First",
    desc: "Protecting people, assets and the environment.",
    icon: HardHat,
  },
  {
    stat: null,
    label: "Efficiency Driven",
    desc: "Smarter energy use and lower total cost of ownership.",
    icon: TrendingUp,
  },
];

function Home() {
  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-6 py-12 lg:grid-cols-2 lg:py-16">
          <div>
            <h1 className="text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl">
              Industrial Risk
              <br />
              Intelligence for
              <br />
              <span className="text-brand-orange">
                Safer, Smarter
                <br />
                Operations
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-muted-foreground">
              STI Risk delivers specialised monitoring, renewable energy, fire suppression,
              transformer health and digital twin solutions that reduce risk, increase uptime and
              drive operational excellence across industrial and commercial operations.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-5 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-brand-orange/20 hover:brightness-110"
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
          <div className="relative">
            <div className="relative mx-auto max-w-xl">
              <img
                src="/sti-hero.png"
                alt="STI Risk detection, protection and improvement services wheel"
                className="h-auto w-full object-contain"
                width={700}
                height={700}
                fetchPriority="high"
              />
            </div>
          </div>
        </div>

        {/* Detect / Protect / Improve */}
        <div className="mx-auto grid max-w-7xl gap-4 px-6 pb-12 md:grid-cols-3">
          {[
            {
              icon: Search,
              color: "text-brand-blue",
              title: "DETECT",
              items: [
                "Fire Detection & IoT",
                "Distributed Sensing",
                "Transformer Health Monitoring",
              ],
              tag: "Early detection and intelligent monitoring that turn data into actionable risk insight.",
            },
            {
              icon: ShieldCheck,
              color: "text-brand-orange",
              title: "PROTECT",
              items: [
                "Fire Suppression",
                "Surveillance & Cyber Security",
                "Industrial Transformers & Back-up",
              ],
              tag: "Advanced protection systems that safeguard people, assets and critical operations.",
            },
            {
              icon: TrendingUp,
              color: "text-brand-blue",
              title: "IMPROVE",
              items: [
                "Financed Renewable Energy",
                "Digital Twins & Reality Capture",
                "Energy Efficiency",
              ],
              tag: "Smarter operations and sustainable solutions that improve performance and reduce cost.",
            },
          ].map((c) => {
            const I = c.icon;
            return (
              <div key={c.title} className="rounded-xl border border-border/60 bg-surface p-6">
                <div className="mb-3 flex items-center gap-3">
                  <I className={`h-8 w-8 ${c.color}`} />
                  <h3 className={`text-xl font-bold tracking-wide ${c.color}`}>{c.title}</h3>
                </div>
                <ul className="space-y-1.5 text-sm">
                  {c.items.map((i) => (
                    <li key={i} className="flex items-center gap-2">
                      <ChevronRight className={`h-3.5 w-3.5 ${c.color}`} /> {i}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-sm text-muted-foreground">{c.tag}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* LIFECYCLE */}
      <section className="border-t border-border/60 bg-background/50">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <h2 className="mb-6 text-2xl font-bold">
            Solutions Across the <span className="text-brand-orange">Risk Lifecycle</span>
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-9">
            {lifecycle.map((l) => {
              const I = l.icon;
              return (
                <div
                  key={l.label}
                  className="overflow-hidden rounded-lg border border-border/60 bg-surface"
                >
                  <div className="aspect-square overflow-hidden">
                    <img
                      src={l.img}
                      alt={l.label}
                      loading="lazy"
                      className="h-full w-full object-cover"
                      width={300}
                      height={300}
                    />
                  </div>
                  <div className="flex items-start gap-2 p-2.5">
                    <I className="h-4 w-4 shrink-0 text-brand-orange" />
                    <span className="text-[11px] font-medium leading-tight">{l.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* INDUSTRIES */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <h2 className="mb-6 text-2xl font-bold">
            Trusted Across <span className="text-brand-orange">Key Industries</span>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {industries.map((i) => {
              const I = i.icon;
              return (
                <div
                  key={i.label}
                  className="flex items-start gap-3 rounded-xl border border-border/60 bg-surface p-4"
                >
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-orange/15 text-brand-orange">
                    <I className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="font-semibold">{i.label}</div>
                    <div className="text-xs text-muted-foreground">{i.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CASE STUDIES */}
      <section className="border-t border-border/60 bg-background/50">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <h2 className="mb-6 text-2xl font-bold">
            Selected <span className="text-brand-orange">Project Outcomes</span>
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {cases.map((c) => (
              <div
                key={c.title}
                className="overflow-hidden rounded-xl border border-border/60 bg-surface"
              >
                <div className="aspect-[16/10] overflow-hidden">
                  <img
                    src={c.img}
                    alt={c.title}
                    loading="lazy"
                    className="h-full w-full object-cover"
                    width={640}
                    height={400}
                  />
                </div>
                <div className="p-4">
                  <div className="font-semibold">{c.title}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{c.desc}</p>
                  <div className="mt-3 flex items-baseline gap-2">
                    <div className="text-2xl font-bold text-brand-orange">{c.stat}</div>
                    <div className="text-xs text-muted-foreground">{c.statLabel}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 text-center">
            <Link
              to="/case-studies"
              className="inline-flex items-center gap-1 text-sm text-brand-orange hover:underline"
            >
              View more case studies <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* WHY */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <h2 className="mb-6 text-2xl font-bold">
            Why <span className="text-brand-orange">STI Risk</span>
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-6">
            {why.map((w) => {
              const I = w.icon;
              return (
                <div key={w.label} className="flex items-start gap-3">
                  <I className="h-10 w-10 shrink-0 text-brand-orange" />
                  <div>
                    {w.stat && <div className="text-2xl font-bold text-brand-blue">{w.stat}</div>}
                    <div className="font-semibold">{w.label}</div>
                    <div className="text-xs text-muted-foreground">{w.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="flex flex-col items-center justify-between gap-6 rounded-xl border border-brand-orange/40 bg-surface p-6 md:flex-row">
            <div>
              <h3 className="text-xl font-bold md:text-2xl">
                Let's assess your facility <span className="text-brand-orange">risk profile</span>
              </h3>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Get expert insight and a tailored roadmap to reduce risk, enhance safety and improve
                operational performance.
              </p>
            </div>
            <Link
              to="/contact"
              className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-6 py-3 text-sm font-semibold text-primary-foreground hover:brightness-110"
            >
              Contact STI Risk <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
