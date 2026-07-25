import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, Bot, Download, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/staff/reports")({
  component: Reports,
});

type ReportData = {
  pipeline: { name: string; deals: number; value_cents: number }[];
  statuses: { status: string; deals: number; value_cents: number }[];
  sources: { source: string; deals: number }[];
  months: { month: string; deals: number; value_cents: number }[];
  owners: { name: string | null; deals: number; value_cents: number }[];
  kpis: {
    revenue: { quoted_value_cents: number; invoiced_value_cents: number; collected_value_cents: number };
    opportunities: { count: number; value_cents: number };
    quotations: { issued: number; issued_value_cents: number; won: number; decided: number; win_rate: number | null };
    serviceDelivery: { open: number; completed: number; total: number; csat: number | null; csatStatus: string };
  };
};

type ManagementReport = {
  period: "day" | "week" | "month";
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  generatedBy: string;
  revenue: { quoted_value_cents?: number; invoiced_value_cents?: number; collected_value_cents?: number };
  opportunities: { count?: number; value_cents?: number };
  quotations: { issued?: number; issued_value_cents?: number; win_rate?: number | null };
  serviceDelivery: { created?: number; completed?: number; open?: number };
  delivery: { status: string; channels: string[] };
};

function money(cents: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);
}

function Reports() {
  const [data, setData] = useState<ReportData | null>(null);
  const [managementReport, setManagementReport] = useState<ManagementReport | null>(null);
  const [reportPeriod, setReportPeriod] = useState<ManagementReport["period"]>("month");
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/reports/summary")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Reports failed to load");
        setData(body);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Reports failed to load"));
  }, []);

  async function generateManagementReport() {
    setReportLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/reports/management?period=${reportPeriod}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Management report failed");
      setManagementReport(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Management report failed");
    } finally {
      setReportLoading(false);
    }
  }

  function exportManagementReportCsv() {
    if (!managementReport) return;
    const rows = [
      ["metric", "value"],
      ["period", managementReport.period],
      ["period_start", managementReport.periodStart],
      ["period_end", managementReport.periodEnd],
      ["quoted_value_cents", managementReport.revenue.quoted_value_cents ?? 0],
      ["invoiced_value_cents", managementReport.revenue.invoiced_value_cents ?? 0],
      ["collected_value_cents", managementReport.revenue.collected_value_cents ?? 0],
      ["opportunities", managementReport.opportunities.count ?? 0],
      ["opportunity_value_cents", managementReport.opportunities.value_cents ?? 0],
      ["quotes_issued", managementReport.quotations.issued ?? 0],
      ["quotes_issued_value_cents", managementReport.quotations.issued_value_cents ?? 0],
      ["quote_win_rate", managementReport.quotations.win_rate ?? ""],
      ["work_created", managementReport.serviceDelivery.created ?? 0],
      ["work_completed", managementReport.serviceDelivery.completed ?? 0],
      ["work_open", managementReport.serviceDelivery.open ?? 0],
    ];
    const csv = rows
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `sti-risk-management-${managementReport.period}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const maxMonth = Math.max(1, ...(data?.months ?? []).map((month) => month.deals));
  const totalDeals = data?.statuses.reduce((sum, status) => sum + status.deals, 0) ?? 0;
  const openValue =
    data?.statuses
      .filter((status) => status.status === "open")
      .reduce((sum, status) => sum + status.value_cents, 0) ?? 0;

  function exportCsv() {
    if (!data) return;
    const rows = [
      ["section", "name", "deals", "value_cents"],
      ...data.pipeline.map((row) => ["pipeline", row.name, row.deals, row.value_cents]),
      ...data.statuses.map((row) => ["status", row.status, row.deals, row.value_cents]),
      ...data.owners.map((row) => ["owner", row.name ?? "Unassigned", row.deals, row.value_cents]),
      ...data.months.map((row) => ["month", row.month, row.deals, row.value_cents]),
      ...data.sources.map((row) => ["source", row.source, row.deals, ""]),
    ];
    const csv = rows
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `sti-risk-reports-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6 print-page">
      <style>{`@media print { .no-print { display:none !important } .print-page { max-width:none !important; padding:0 !important } .management-report { border-top:0 !important } }`}</style>
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Insights</div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Live pipeline, source, owner, and import performance from the CRM database.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/staff/chat"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            <Bot className="h-4 w-4" /> Ask Steve
          </Link>
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border/60 bg-surface p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Imported deals
          </div>
          <div className="mt-2 text-2xl font-bold">{totalDeals}</div>
        </div>
        <div className="rounded-lg border border-border/60 bg-surface p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Open value</div>
          <div className="mt-2 text-2xl font-bold">{money(openValue)}</div>
        </div>
        <div className="rounded-lg border border-border/60 bg-surface p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Sources</div>
          <div className="mt-2 text-2xl font-bold">{data?.sources.length ?? 0}</div>
        </div>
      </div>

      <section className="space-y-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Management KPIs</div>
          <h2 className="text-lg font-bold">Commercial and service delivery</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            href="/staff/billing"
            label="Collected"
            value={money(data?.kpis.revenue.collected_value_cents ?? 0)}
            detail={`Invoiced ${money(data?.kpis.revenue.invoiced_value_cents ?? 0)}`}
          />
          <MetricCard
            href="/staff/crm"
            label="Open opportunities"
            value={data?.kpis.opportunities.count ?? 0}
            detail={money(data?.kpis.opportunities.value_cents ?? 0)}
          />
          <MetricCard
            href="/staff/quotes"
            label="Quote win rate"
            value={
              data?.kpis.quotations.win_rate == null
                ? "—"
                : `${Math.round(data.kpis.quotations.win_rate * 100)}%`
            }
            detail={`${data?.kpis.quotations.issued ?? 0} issued · ${money(data?.kpis.quotations.issued_value_cents ?? 0)}`}
          />
          <MetricCard
            href="/staff/work"
            label="Service delivery"
            value={data?.kpis.serviceDelivery.completed ?? 0}
            detail={`${data?.kpis.serviceDelivery.open ?? 0} open · CSAT not captured`}
          />
        </div>
      </section>

      <section className="rounded-lg border border-border/60 bg-surface p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">B3</div>
            <h2 className="text-lg font-bold">Management report generator</h2>
            <p className="text-sm text-muted-foreground">
              Generate a channel-neutral daily, weekly, or monthly snapshot from live records.
            </p>
          </div>
          <div className="flex gap-2">
            <select
              value={reportPeriod}
              onChange={(event) => setReportPeriod(event.target.value as ManagementReport["period"])}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
            </select>
            <button
              type="button"
              onClick={() => void generateManagementReport()}
              disabled={reportLoading}
              className="rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {reportLoading ? "Generating…" : "Generate report"}
            </button>
            {managementReport && (
              <>
                <button
                  type="button"
                  onClick={exportManagementReportCsv}
                  className="rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-2"
                >
                  Excel CSV
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-2 print:hidden"
                >
                  Print / PDF
                </button>
              </>
            )}
          </div>
        </div>
        {managementReport && (
          <div className="management-report mt-5 space-y-3 border-t border-border/60 pt-4">
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {managementReport.periodStart.slice(0, 10)} → {managementReport.periodEnd.slice(0, 10)}
              </span>
              <span>Generated by {managementReport.generatedBy}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ReportStat label="Collected" value={money(managementReport.revenue.collected_value_cents ?? 0)} />
              <ReportStat label="Opportunities" value={`${managementReport.opportunities.count ?? 0}`} />
              <ReportStat
                label="Quote win rate"
                value={
                  managementReport.quotations.win_rate == null
                    ? "—"
                    : `${Math.round(managementReport.quotations.win_rate * 100)}%`
                }
              />
              <ReportStat label="Completed work" value={`${managementReport.serviceDelivery.completed ?? 0}`} />
            </div>
            <p className="text-xs text-muted-foreground">
              Delivery is not configured yet; this report is available in the staff workspace for review.
            </p>
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Deals created by month</h2>
            <div className="flex items-center gap-1 text-xs text-emerald-400">
              <TrendingUp className="h-3.5 w-3.5" /> Live
            </div>
          </div>
          <div className="mt-6 flex h-56 items-end justify-between gap-3">
            {(data?.months ?? []).map((month) => (
              <div key={month.month} className="flex flex-1 flex-col items-center gap-2">
                <div
                  className="w-full rounded-t bg-gradient-to-t from-brand-orange to-brand-orange/40"
                  style={{ height: `${Math.max(8, (month.deals / maxMonth) * 100)}%` }}
                />
                <div className="text-center text-xs text-muted-foreground">{month.month}</div>
              </div>
            ))}
            {data && data.months.length === 0 && (
              <div className="grid h-full w-full place-items-center text-sm text-muted-foreground">
                No deal history yet.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-surface p-5">
          <h2 className="text-sm font-semibold">Pipeline by stage</h2>
          <div className="mt-6 space-y-4">
            {(data?.pipeline ?? []).map((stage) => (
              <div key={stage.name}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium">{stage.name}</span>
                  <span className="text-muted-foreground">
                    {stage.deals} deals · {money(stage.value_cents)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full bg-brand-orange"
                    style={{
                      width: `${Math.max(4, (stage.deals / Math.max(1, totalDeals)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
            {data && data.pipeline.length === 0 && (
              <div className="text-sm text-muted-foreground">No pipeline data yet.</div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-surface p-5">
          <h2 className="text-sm font-semibold">Deal status</h2>
          <div className="mt-4 divide-y divide-border/40">
            {(data?.statuses ?? []).map((status) => (
              <div key={status.status} className="flex items-center justify-between py-3 text-sm">
                <span className="capitalize">{status.status}</span>
                <span className="font-semibold text-brand-orange">
                  {status.deals} · {money(status.value_cents)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-surface p-5">
          <h2 className="text-sm font-semibold">Owners</h2>
          <div className="mt-4 divide-y divide-border/40">
            {(data?.owners ?? []).map((owner) => (
              <div
                key={owner.name ?? "Unassigned"}
                className="flex items-center justify-between py-3 text-sm"
              >
                <span>{owner.name ?? "Unassigned"}</span>
                <span className="font-semibold text-brand-orange">
                  {owner.deals} · {money(owner.value_cents)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  href,
  label,
  value,
  detail,
}: {
  href: "/staff/billing" | "/staff/crm" | "/staff/quotes" | "/staff/work";
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <Link
      to={href}
      className="group rounded-lg border border-border/60 bg-surface p-5 transition hover:border-brand-orange/50 hover:bg-surface-2"
      aria-label={`Open ${label} records`}
    >
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      <div className="mt-3 text-xs font-semibold text-brand-orange opacity-0 transition group-hover:opacity-100">
        View records →
      </div>
    </Link>
  );
}

function ReportStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}
