import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Search,
  ShieldCheck,
  TrendingUp,
  Flame,
  Bell,
  Zap,
  Box,
  ShieldAlert,
  Factory,
  Car,
  Building2,
  HardHat,
  ClipboardCheck,
  Gauge,
  ChevronRight,
  Activity,
  Cpu,
  Wind,
  MessageSquare,
  Pencil,
  Wrench,
} from "lucide-react";
import heroImg from "@/assets/hero-services.jpg";
import sFire from "@/assets/svc-fire-detection.jpg";
import sSensing from "@/assets/svc-sensing.jpg";
import sSupp from "@/assets/svc-suppression.jpg";
import sTrans from "@/assets/svc-transformer.jpg";
import sSurv from "@/assets/svc-surveillance.jpg";
import sBackup from "@/assets/svc-backup.jpg";
import sRenew from "@/assets/svc-renewable.jpg";
import sTwin from "@/assets/svc-digitaltwin.jpg";
import sEff from "@/assets/svc-efficiency.jpg";

export const Route = createFileRoute("/services")({
  head: () => ({
    meta: [
      { title: "Services — STI Risk" },
      {
        name: "description",
        content:
          "Integrated services for industrial risk, protection and performance: fire detection, suppression, monitoring, energy and digital twin.",
      },
      { property: "og:title", content: "STI Risk Services" },
      {
        property: "og:description",
        content: "Detect, protect and improve across industrial operations.",
      },
      { property: "og:url", content: "/services" },
    ],
    links: [{ rel: "canonical", href: "/services" }],
  }),
  component: ServicesPage,
});

const ringIcons = [
  { label: "Fire Protection", sub: "High", icon: Flame, color: "text-brand-orange" },
  { label: "Security", sub: "Active", icon: ShieldCheck, color: "text-brand-blue" },
  { label: "Energy", sub: "Optimised", icon: Zap, color: "text-brand-orange" },
  { label: "Digital Twin", sub: "Updated", icon: Box, color: "text-brand-orange" },
];

const portfolio = [
  {
    img: sFire,
    icon: Flame,
    title: "Fire Detection & IoT Solutions",
    desc: "Advanced fire detection systems with IoT connectivity for real-time alerting.",
  },
  {
    img: sSensing,
    icon: Activity,
    title: "Distributed Sensing Technology",
    desc: "Continuous monitoring across assets for early risk identification.",
  },
  {
    img: sTrans,
    icon: Cpu,
    title: "Transformer Health Monitoring",
    desc: "Real-time condition monitoring to predict issues and extend asset life.",
  },
  {
    img: sSupp,
    icon: ShieldAlert,
    title: "Fire Suppression Technology",
    desc: "Reliable suppression systems designed to protect assets and operations.",
  },
  {
    img: sSurv,
    icon: ShieldCheck,
    title: "Surveillance, Control & Cyber Security",
    desc: "Integrated security and cyber defence for industrial environments.",
  },
  {
    img: sBackup,
    icon: Zap,
    title: "Industrial Transformers & Back-up",
    desc: "Robust transformer and back-up solutions for uninterrupted operations.",
  },
  {
    img: sRenew,
    icon: Wind,
    title: "Financed Renewable Energy",
    desc: "Sustainable energy solutions structured with flexible financing.",
  },
  {
    img: sTwin,
    icon: Box,
    title: "Digital Twins & Reality Capture",
    desc: "High-fidelity digital twins and reality capture for better decision-making.",
  },
  {
    img: sEff,
    icon: Gauge,
    title: "Energy Efficiency",
    desc: "Data-driven strategies to reduce energy use and operational costs.",
  },
];

const steps = [
  {
    n: 1,
    icon: ClipboardCheck,
    title: "Assess",
    desc: "We evaluate your risks, assets and operational environment.",
  },
  {
    n: 2,
    icon: Pencil,
    title: "Design",
    desc: "We engineer tailored solutions aligned to your objectives and budget.",
  },
  {
    n: 3,
    icon: HardHat,
    title: "Deploy",
    desc: "We implement with precision and minimal disruption to your operations.",
  },
  {
    n: 4,
    icon: TrendingUp,
    title: "Optimise",
    desc: "We monitor, maintain and optimise for long-term performance.",
  },
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

function ServicesPage() {
  return (
    <>
      <section>
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-6 py-12 lg:grid-cols-2">
          <div>
            <h1 className="text-4xl font-bold leading-tight md:text-5xl">
              Integrated Services for
              <br />
              <span className="text-brand-orange">
                Industrial Risk, Protection
                <br />
                and Performance
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-muted-foreground">
              STI Risk delivers end-to-end industrial solutions that integrate fire detection,
              monitoring, suppression, security, energy, transformer resilience and digital twin
              capabilities to protect people, assets and operations—today and into the future.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-5 py-3 text-sm font-semibold text-primary-foreground hover:brightness-110"
              >
                Request a Service Consultation <ChevronRight className="h-4 w-4" />
              </Link>
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-5 py-3 text-sm font-semibold hover:bg-surface-2"
              >
                Talk to an Expert <MessageSquare className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="relative">
            <div className="relative overflow-hidden rounded-xl border border-border/60">
              <img
                src={heroImg}
                alt="Industrial services hero"
                className="h-full w-full object-cover"
                width={1280}
                height={800}
              />
            </div>
            <div className="absolute -right-2 top-0 hidden flex-col gap-3 md:flex">
              {ringIcons.map((r) => {
                const I = r.icon;
                return (
                  <div
                    key={r.label}
                    className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/80 px-3 py-2 backdrop-blur"
                  >
                    <I className={`h-5 w-5 ${r.color}`} />
                    <div className="text-[11px]">
                      <div className="font-semibold">{r.label}</div>
                      <div className={r.color}>{r.sub}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mx-auto grid max-w-7xl gap-4 px-6 pb-12 md:grid-cols-3">
          {[
            {
              icon: Search,
              color: "text-brand-blue",
              title: "DETECT",
              desc: "Early detection and intelligent monitoring that turn data into actionable risk insight.",
              items: [
                "Fire Detection & IoT",
                "Distributed Sensing",
                "Transformer Health Monitoring",
              ],
            },
            {
              icon: ShieldCheck,
              color: "text-brand-orange",
              title: "PROTECT",
              desc: "Advanced protection systems that safeguard people, assets and critical operations.",
              items: [
                "Fire Suppression",
                "Surveillance & Cyber Security",
                "Industrial Transformers & Back-up",
              ],
            },
            {
              icon: TrendingUp,
              color: "text-brand-blue",
              title: "IMPROVE",
              desc: "Smarter operations and sustainable solutions that enhance performance and reduce cost.",
              items: [
                "Financed Renewable Energy",
                "Digital Twins & Reality Capture",
                "Energy Efficiency",
              ],
            },
          ].map((c) => {
            const I = c.icon;
            return (
              <div key={c.title} className="rounded-xl border border-border/60 bg-surface p-6">
                <div className="mb-3 flex items-center gap-3">
                  <I className={`h-8 w-8 ${c.color}`} />
                  <h3 className={`text-xl font-bold tracking-wide ${c.color}`}>{c.title}</h3>
                </div>
                <p className="text-sm text-muted-foreground">{c.desc}</p>
                <ul className="mt-4 space-y-1.5 text-sm">
                  {c.items.map((i) => (
                    <li key={i} className="flex items-center gap-2">
                      <ShieldCheck className={`h-3.5 w-3.5 ${c.color}`} /> {i}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* PORTFOLIO */}
      <section className="border-t border-border/60 bg-background/50">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <h2 className="mb-6 text-2xl font-bold">
            Explore Our <span className="text-brand-orange">Service Portfolio</span>
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {portfolio.map((p) => {
              const I = p.icon;
              return (
                <div
                  key={p.title}
                  className="flex gap-3 overflow-hidden rounded-xl border border-border/60 bg-surface"
                >
                  <div className="aspect-square w-32 shrink-0 overflow-hidden">
                    <img
                      src={p.img}
                      alt={p.title}
                      loading="lazy"
                      className="h-full w-full object-cover"
                      width={300}
                      height={300}
                    />
                  </div>
                  <div className="flex-1 p-3">
                    <div className="flex items-start gap-2">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-brand-orange/15 text-brand-orange">
                        <I className="h-4 w-4" />
                      </div>
                      <div className="font-semibold leading-tight">{p.title}</div>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{p.desc}</p>
                    <Link
                      to="/contact"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-brand-orange hover:underline"
                    >
                      Learn More <ChevronRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* HOW WE SUPPORT */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <h2 className="mb-6 text-2xl font-bold">
            How We <span className="text-brand-orange">Support Operations</span>
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, idx) => {
              const I = s.icon;
              return (
                <div
                  key={s.n}
                  className="relative rounded-xl border border-border/60 bg-surface p-5"
                >
                  <div className="mb-3 flex items-center gap-3">
                    <div className="grid h-8 w-8 place-items-center rounded-full bg-brand-orange text-sm font-bold text-primary-foreground">
                      {s.n}
                    </div>
                    <I className="h-7 w-7 text-brand-orange" />
                  </div>
                  <div className="font-semibold">{s.title}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{s.desc}</p>
                  {idx < steps.length - 1 && (
                    <ChevronRight className="absolute -right-3 top-1/2 hidden h-6 w-6 -translate-y-1/2 text-brand-orange lg:block" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* INDUSTRIES */}
      <section className="border-t border-border/60 bg-background/50">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <h2 className="mb-6 text-2xl font-bold">
            Solutions Aligned to <span className="text-brand-orange">Your Industry</span>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {industries.map((i) => {
              const I = i.icon;
              return (
                <div
                  key={i.label}
                  className="rounded-xl border border-border/60 bg-surface p-4 text-center"
                >
                  <I className="mx-auto h-10 w-10 text-brand-orange" />
                  <div className="mt-2 font-semibold">{i.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{i.desc}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* WHY */}
      <section className="border-t border-border/60">
        <div className="mx-auto grid max-w-7xl gap-6 px-6 py-12 md:grid-cols-2 lg:grid-cols-4">
          {[
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
              label: "Compliance Focused",
              desc: "Aligned with SANS, NFPA, ISO and local standards.",
              icon: ClipboardCheck,
            },
            {
              label: "Safety-First Delivery",
              desc: "Protecting people, assets and the environment in everything we do.",
              icon: HardHat,
            },
          ].map((w) => {
            const I = w.icon;
            return (
              <div
                key={w.label}
                className="flex items-start gap-3 rounded-xl border border-border/60 bg-surface p-4"
              >
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
      </section>

      {/* CTA */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="flex flex-col items-center justify-between gap-6 rounded-xl border border-brand-orange/40 bg-surface p-6 md:flex-row">
            <div>
              <h3 className="text-xl font-bold md:text-2xl">
                Need the <span className="text-brand-orange">right solution</span> for your
                facility?
              </h3>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Let our experts help you design, integrate and support the right mix of services for
                stronger protection and performance.
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
