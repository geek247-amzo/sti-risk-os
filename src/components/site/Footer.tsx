import { Link } from "@tanstack/react-router";
import { Mail, MapPin, Phone, Linkedin } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-border/60 bg-background">
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-10 md:grid-cols-4">
        <div className="flex items-start gap-3">
          <img
            src="/sti-logo-icon.png"
            alt="STI Risk logo"
            className="h-11 w-11 rounded-sm object-contain"
            width={96}
            height={96}
          />
          <div className="leading-tight">
            <div className="text-base font-bold">
              STI <span className="text-brand-orange">RISK</span>
            </div>
            <div className="text-[8px] tracking-[0.2em] text-muted-foreground">
              DETECTION · PROTECTION · IMPROVEMENT
            </div>
          </div>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-brand-orange" /> Johannesburg, South Africa
          </div>
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-brand-orange" /> info@stirisk.co.za
          </div>
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-brand-orange" /> 066 065 0602
          </div>
        </div>
        <div>
          <div className="mb-3 text-sm font-semibold">Quick Links</div>
          <div className="grid grid-cols-2 gap-y-1 text-sm text-muted-foreground">
            <Link to="/" className="hover:text-brand-orange">
              Home
            </Link>
            <Link to="/case-studies" className="hover:text-brand-orange">
              Case Studies
            </Link>
            <Link to="/about" className="hover:text-brand-orange">
              About
            </Link>
            <Link to="/partner-referral" className="hover:text-brand-orange">
              Partner & Referral
            </Link>
            <Link to="/services" className="hover:text-brand-orange">
              Services
            </Link>
            <Link to="/contact" className="hover:text-brand-orange">
              Contact
            </Link>
          </div>
        </div>
        <div>
          <div className="mb-3 text-sm font-semibold">Follow Us</div>
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Linkedin className="h-4 w-4" /> LinkedIn
          </div>
        </div>
      </div>
      <div className="border-t border-border/60">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-6 py-4 text-xs text-muted-foreground md:flex-row">
          <div>© 2025 STI Risk (Pty) Ltd. All rights reserved.</div>
          <div>
            Industrial Risk Solutions for a{" "}
            <span className="text-brand-orange">Safer, Smarter Tomorrow.</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
