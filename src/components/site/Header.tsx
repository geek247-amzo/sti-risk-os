import { Link } from "@tanstack/react-router";
import { Calendar, Menu, X } from "lucide-react";
import { useState } from "react";

const nav = [
  { to: "/", label: "Home" },
  { to: "/about", label: "About" },
  { to: "/services", label: "Services" },
  { to: "/case-studies", label: "Case Studies" },
  { to: "/partner-referral", label: "Partner & Referral" },
  { to: "/contact", label: "Contact" },
] as const;

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border/50 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-3" onClick={closeMobileMenu}>
          <img
            src="/sti-logo-icon.png"
            alt="STI Risk logo"
            className="h-11 w-11 rounded-sm object-contain"
            width={96}
            height={96}
          />
          <div className="leading-tight">
            <div className="text-base font-bold tracking-wide">
              STI <span className="text-brand-orange">RISK</span>
            </div>
            <div className="text-[8px] tracking-[0.2em] text-muted-foreground">
              DETECTION · PROTECTION · IMPROVEMENT
            </div>
          </div>
        </Link>
        <nav className="hidden items-center gap-7 lg:flex">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="text-sm text-foreground/85 transition-colors hover:text-brand-orange [&.active]:text-brand-orange [&.active]:underline [&.active]:decoration-brand-orange [&.active]:decoration-2 [&.active]:underline-offset-8"
              activeOptions={{ exact: n.to === "/" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link
            to="/staff/login"
            className="hidden text-xs uppercase tracking-[0.15em] text-muted-foreground hover:text-brand-orange md:inline"
          >
            Login
          </Link>
          <Link
            to="/contact"
            className="hidden items-center gap-2 rounded-md bg-brand-orange px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-brand-orange/20 transition hover:brightness-110 sm:inline-flex"
          >
            Book a Risk Assessment <Calendar className="h-4 w-4" />
          </Link>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface text-foreground transition hover:border-brand-orange hover:text-brand-orange lg:hidden"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-site-menu"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {mobileMenuOpen && (
        <div
          id="mobile-site-menu"
          className="border-t border-border/50 bg-background/95 px-6 py-5 shadow-xl shadow-black/10 backdrop-blur lg:hidden"
        >
          <nav className="mx-auto flex max-w-7xl flex-col gap-1" aria-label="Mobile navigation">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="rounded-md px-3 py-3 text-sm font-medium text-foreground/85 transition hover:bg-surface hover:text-brand-orange [&.active]:bg-surface [&.active]:text-brand-orange"
                activeOptions={{ exact: n.to === "/" }}
                onClick={closeMobileMenu}
              >
                {n.label}
              </Link>
            ))}
            <div className="mt-4 grid gap-3 border-t border-border/50 pt-4 sm:grid-cols-2">
              <Link
                to="/staff/login"
                className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-4 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-brand-orange hover:text-brand-orange"
                onClick={closeMobileMenu}
              >
                Login
              </Link>
              <Link
                to="/contact"
                className="inline-flex items-center justify-center gap-2 rounded-md bg-brand-orange px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-brand-orange/20 transition hover:brightness-110"
                onClick={closeMobileMenu}
              >
                Book a Risk Assessment <Calendar className="h-4 w-4" />
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
