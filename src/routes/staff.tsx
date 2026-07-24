import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import {
  Bot,
  Building2,
  CircleDollarSign,
  ClipboardCheck,
  Command,
  FolderKanban,
  HardHat,
  Search,
  LogOut,
  FileSignature,
  FileStack,
  FileText,
  ShieldCheck,
  QrCode,
  Loader2,
  X,
  Menu,
  PackageCheck,
  Printer,
  Settings,
  ShieldAlert,
  UsersRound,
  Workflow,
  Wrench,
} from "lucide-react";
import { StaffGuide, StaffHelpMenu, type GuideId } from "@/components/staff/StaffGuide";

export const Route = createFileRoute("/staff")({
  component: StaffLayout,
});

const nav = [
  { to: "/staff", label: "Command Centre", icon: Command, exact: true, group: "Operate" },
  {
    to: "/staff/vusi",
    label: "Vusi Workspace",
    icon: ClipboardCheck,
    exact: true,
    group: "Operate",
  },
  {
    to: "/staff/capability",
    label: "Capability Checklist",
    icon: Wrench,
    exact: true,
    group: "Operate",
  },
  { to: "/staff/clients", label: "Clients", icon: Building2, exact: true, group: "Operate" },
  { to: "/staff/work", label: "Work", icon: FolderKanban, exact: false, group: "Operate" },
  { to: "/staff/quotes", label: "Quotes", icon: FileSignature, exact: false, group: "Operate" },
  {
    to: "/staff/po-orders",
    label: "POs & Orders",
    icon: PackageCheck,
    exact: true,
    group: "Operate",
  },
  { to: "/staff/field-work", label: "Field Work", icon: HardHat, exact: true, group: "Operate" },
  {
    to: "/staff/inspections",
    label: "Inspections",
    icon: ClipboardCheck,
    exact: true,
    group: "Operate",
  },
  {
    to: "/staff/inspection-reports",
    label: "Survey Reports",
    icon: FileStack,
    exact: true,
    group: "Operate",
  },
  {
    to: "/staff/compliance",
    label: "Compliance",
    icon: ShieldCheck,
    exact: true,
    group: "Operate",
  },
  { to: "/staff/project-qr", label: "Project QR", icon: QrCode, exact: true, group: "Operate" },
  {
    to: "/staff/project-sticker",
    label: "Print Sticker",
    icon: Printer,
    exact: true,
    group: "Operate",
  },
  {
    to: "/staff/consulting-reports",
    label: "Consulting Reports",
    icon: FileText,
    exact: true,
    group: "Operate",
  },
  { to: "/staff/reports", label: "Reports", icon: FileStack, exact: true, group: "Operate" },
  {
    to: "/staff/assets-risk",
    label: "Assets & Risk",
    icon: ShieldAlert,
    exact: true,
    group: "Operate",
  },
  { to: "/staff/billing", label: "Finance", icon: CircleDollarSign, exact: true, group: "Operate" },
  {
    to: "/staff/subcontractors",
    label: "Subcontractors",
    icon: UsersRound,
    exact: true,
    group: "Operate",
  },
  { to: "/staff/automations", label: "Automations", icon: Workflow, exact: true, group: "Operate" },
  { to: "/staff/steve", label: "Steve AI", icon: Bot, exact: false, group: "Operate" },
  { to: "/staff/settings", label: "Settings", icon: Settings, exact: true, group: "System" },
  { to: "/staff/crm", label: "Legacy CRM", icon: Wrench, exact: true, group: "Legacy" },
  { to: "/staff/growth", label: "Growth", icon: Wrench, exact: false, group: "Legacy" },
  { to: "/staff/email", label: "Email", icon: Wrench, exact: true, group: "Legacy" },
  { to: "/staff/docs", label: "Docs", icon: Wrench, exact: true, group: "Legacy" },
] as const;

type SearchResult = {
  entity_type: string;
  entity_id: string;
  content: string;
  metadata: Record<string, unknown> | null;
};

function resultLabel(result: SearchResult) {
  return result.entity_type.replaceAll("_", " ");
}

function resultLink(result: SearchResult) {
  if (result.entity_type === "deal") {
    return { to: "/staff/crm/deals/$dealId" as const, params: { dealId: result.entity_id } };
  }
  if (result.entity_type === "contact") return { to: "/staff/clients" as const };
  if (result.entity_type === "task") return { to: "/staff/work" as const };
  if (result.entity_type === "invoice") return { to: "/staff/billing" as const };
  if (result.entity_type === "quote") {
    return { to: "/staff/quotes/$quoteId" as const, params: { quoteId: result.entity_id } };
  }
  return null;
}

function pageTitle(pathname: string) {
  if (pathname === "/staff") return "Command Centre";
  const current = nav.find((item) =>
    item.exact ? pathname === item.to : pathname.startsWith(item.to),
  );
  return current?.label ?? "Staff Portal";
}

function StaffLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [user, setUser] = useState<{ name: string; role: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeGuide, setActiveGuide] = useState<GuideId | null>(null);

  useEffect(() => {
    if (pathname === "/staff/login") return;
    let cancelled = false;
    setAuthChecked(false);
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return;
        setUser(data.user);
        setAuthChecked(true);
      })
      .catch(() => {
        if (cancelled) return;
        window.location.href = "/staff/login";
      });

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  if (pathname === "/staff/login") {
    return <Outlet />;
  }

  if (!authChecked || !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-6 text-foreground">
        <div className="text-sm text-muted-foreground">Checking staff access...</div>
      </div>
    );
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/staff/login";
  }

  async function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchError("");
      return;
    }

    setSearching(true);
    setSearchError("");
    try {
      const response = await fetch("/api/search/semantic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Search failed");
      setSearchResults(body.results ?? []);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  function clearSearch() {
    setSearchQuery("");
    setSearchResults([]);
    setSearchError("");
  }

  const groupedNav = nav.reduce<Record<string, (typeof nav)[number][]>>((groups, item) => {
    groups[item.group] = [...(groups[item.group] ?? []), item];
    return groups;
  }, {});

  return (
    <div className="staff-app flex h-screen overflow-hidden bg-background text-foreground">
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/50"
            aria-label="Close staff menu"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="staff-sidebar relative flex h-full w-72 max-w-[85vw] flex-col shadow-2xl">
            <div className="flex h-18 items-center justify-between gap-3 px-5 py-5">
              <div className="flex items-center gap-3">
                <img
                  src="/sti-logo-icon.png"
                  alt="STI Risk logo"
                  className="h-10 w-10 rounded-sm object-contain"
                  width={96}
                  height={96}
                />
                <div className="leading-tight">
                  <div className="text-lg font-bold tracking-wide text-white">
                    STI <span className="text-[#f59e0b]">RISK</span>
                  </div>
                  <div className="text-[9px] tracking-[0.22em] text-slate-400">STAFF PORTAL</div>
                </div>
              </div>
              <button
                type="button"
                className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white"
                aria-label="Close staff menu"
                onClick={() => setMobileNavOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 space-y-7 overflow-y-auto px-5 py-4" data-guide="navigation">
              {Object.entries(groupedNav).map(([group, items]) => (
                <div key={group}>
                  <div className="mb-3 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {group}
                  </div>
                  <div className="space-y-1">
                    {items.map((n) => {
                      const active = n.exact ? pathname === n.to : pathname.startsWith(n.to);
                      return (
                        <Link
                          key={n.to}
                          to={n.to}
                          className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors ${
                            active
                              ? "bg-[#556ee6]/15 text-white"
                              : "text-slate-400 hover:bg-white/5 hover:text-white"
                          }`}
                          onClick={() => setMobileNavOpen(false)}
                          data-guide={`nav-${n.to.split("/").filter(Boolean).at(-1) ?? "home"}`}
                        >
                          <n.icon className="h-4 w-4" />
                          {n.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>

            <div className="border-t border-white/10 p-4">
              <div className="mb-3 flex items-center gap-3 rounded-md bg-white/5 p-2.5">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-[#556ee6] text-sm font-semibold text-white">
                  {user?.name
                    ?.split(" ")
                    .map((part) => part[0])
                    .join("")
                    .slice(0, 2) ?? "ST"}
                </div>
                <div className="flex-1 leading-tight">
                  <div className="text-sm font-medium text-white">{user?.name ?? "Staff user"}</div>
                  <div className="text-xs capitalize text-slate-400">{user?.role ?? "staff"}</div>
                </div>
              </div>
              <button
                onClick={() => void logout()}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm text-slate-400 hover:bg-white/5 hover:text-white"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Sidebar */}
      <aside className="staff-sidebar hidden w-64 shrink-0 flex-col lg:flex">
        <div className="flex h-18 items-center gap-3 px-7 py-5">
          <img
            src="/sti-logo-icon.png"
            alt="STI Risk logo"
            className="h-10 w-10 rounded-sm object-contain"
            width={96}
            height={96}
          />
          <div className="leading-tight">
            <div className="text-lg font-bold tracking-wide text-white">
              STI <span className="text-[#f59e0b]">RISK</span>
            </div>
            <div className="text-[9px] tracking-[0.22em] text-slate-400">STAFF PORTAL</div>
          </div>
        </div>

        <nav className="flex-1 space-y-7 overflow-y-auto px-5 py-4" data-guide="navigation">
          {Object.entries(groupedNav).map(([group, items]) => (
            <div key={group}>
              <div className="mb-3 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {group}
              </div>
              <div className="space-y-1">
                {items.map((n) => {
                  const active = n.exact ? pathname === n.to : pathname.startsWith(n.to);
                  return (
                    <Link
                      key={n.to}
                      to={n.to}
                      className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors ${
                        active
                          ? "bg-[#556ee6]/15 text-white"
                          : "text-slate-400 hover:bg-white/5 hover:text-white"
                      }`}
                      data-guide={
                        n.to === "/staff/steve"
                          ? "steve-nav"
                          : `nav-${n.to.split("/").filter(Boolean).at(-1) ?? "home"}`
                      }
                    >
                      <n.icon className="h-4 w-4" />
                      {n.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-3 rounded-md bg-white/5 p-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-[#556ee6] text-sm font-semibold text-white">
              {user?.name
                ?.split(" ")
                .map((part) => part[0])
                .join("")
                .slice(0, 2) ?? "ST"}
            </div>
            <div className="flex-1 leading-tight">
              <div className="text-sm font-medium text-white">{user?.name ?? "Staff user"}</div>
              <div className="text-xs capitalize text-slate-400">{user?.role ?? "staff"}</div>
            </div>
            <button onClick={logout} className="text-slate-400 hover:text-white" title="Log out">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-18 items-center gap-4 border-b border-border/70 bg-white/95 px-4 shadow-sm backdrop-blur sm:px-6">
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-md text-slate-500 hover:bg-surface-2 hover:text-slate-700 lg:hidden"
            aria-label="Open staff menu"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <form onSubmit={runSearch} className="relative max-w-xl flex-1" data-guide="search">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search deals, contacts, jobs, sites…"
              className="h-10 w-full rounded-full border border-transparent bg-surface-2 pl-9 pr-20 text-sm placeholder:text-muted-foreground focus:border-brand-blue focus:bg-white focus:outline-none"
            />
            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {searching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              {(searchQuery || searchResults.length > 0 || searchError) && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-white hover:text-foreground"
                  title="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {(searchResults.length > 0 || searchError) && (
              <div className="staff-panel absolute left-0 right-0 top-12 max-h-96 overflow-y-auto rounded-md border border-border bg-white shadow-xl">
                {searchError && <div className="p-3 text-sm text-destructive">{searchError}</div>}
                {searchResults.map((result) => {
                  const link = resultLink(result);
                  const body = (
                    <div className="border-b border-border/60 p-3 text-left last:border-b-0 hover:bg-surface-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-brand-blue">
                        {resultLabel(result)}
                      </div>
                      <div className="mt-1 line-clamp-2 text-sm text-foreground">
                        {result.content}
                      </div>
                    </div>
                  );
                  return link ? (
                    <Link
                      key={`${result.entity_type}-${result.entity_id}`}
                      to={link.to}
                      params={"params" in link ? link.params : undefined}
                      onClick={clearSearch}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div key={`${result.entity_type}-${result.entity_id}`}>{body}</div>
                  );
                })}
              </div>
            )}
          </form>
          <div className="hidden items-center gap-2 text-sm text-muted-foreground xl:flex">
            <span>{pageTitle(pathname)}</span>
          </div>
          <StaffHelpMenu onStart={setActiveGuide} />
          <Link
            to="/"
            className="hidden text-xs text-muted-foreground hover:text-brand-blue md:inline"
          >
            Public site
          </Link>
        </header>

        <main className="staff-main h-[calc(100vh-4.5rem)] min-h-0 min-w-0 flex-1 overflow-y-scroll p-4 text-foreground sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
      <StaffGuide request={activeGuide} onClose={() => setActiveGuide(null)} />
    </div>
  );
}
