# STI Risk OS — Completion Backlog

Repository: `github.com/geek247-amzo/sti-risk-os`

This is the canonical hand-off and execution backlog. Every ticket follows:

> discovery → confirmed code/database shape → scoped ticket → implementation → tests → deployment verification → documented close-out

## Current status

Complete and live: F1, F2, C2, D-4, A1, A2, A3, and B1.

Active: B2 — KPI drill-down UI.

Queued: B3 — automated management reporting; B4 — PDF/Excel export.

Unblocked but not started: C1 and D-1/D-2/D-3.

Blocked: Stream E pending Yeastar API/auth and PABX details.

Deferred: F3 final verification, until the remaining streams close.

The repository is currently clean, synced at `9811c0e`, and production has been verified healthy (`/health` 200; `/ready` 200 with database ready). The Kiril/Vusi confirmation message remains the open coordination item.

## Working product defaults

These defaults are documented working assumptions grounded in prior stakeholder discussions. They are not silent guesses and remain subject to formal correction.

- D1 — Maintenance quotes use the standard payment/e-signature gate by default, with a per-client bypass for strategic/pre-arranged clients using the existing relationship-type pattern.
- D2 — KPI/reporting ownership uses the existing Kiril/Vusi/Melissa role structure and client relationship tags. A richer stakeholder map can extend the design later.
- D3 — Item 10 uses the Survey/Inspection structured-findings pattern: Fault Found, Recommendation, Immediate Fix, and Deferred Work. Technicians select remediation options; coordinators attach pricing before client visibility.

Agents may build against these explicit defaults, but must record the assumption and stop if discovery contradicts it. Stream E has no equivalent default for undocumented API behavior.

## Discovery findings

- D4 — `site_visits`, `evidence_files`, `service_reports`, and `work_items` exist and are linked. Media uses `file_path` and the Docker uploads volume. `capture_phase` supports before/during/after. No object-storage abstraction exists.
- D5 — No Yeastar API, CDR, recording, webhook, or CloudMonkey integration exists. Deeper API/auth discovery is required before implementation.
- D6 — Inspection templates, technician capture, signatures, required photos, GPS, AI compliance checks, structured findings, report assembly, and staff UI exist. At discovery time PDF export and public delivery were missing; both are now closed by F1 and F2.

## Stream A — Progressive report assembly

Status: **complete**.

- A1 — **complete**, commit `e696af8`. Added phase-grouped work-item/finding assembly to existing `service_reports`, with a reusable embedding structure and coordinator-only pricing metadata. No new schema.
- A2 — **complete**, commit `001d0c2`. Added staff-facing consulting-report rendering for work-item context, phased evidence, and structured findings. This is distinct from F2 public sign-off delivery and is not claimed as a public client flow.
- A3 — **complete**, included in the A1 implementation. New consulting reports write `service_report` embedding documents. Known gap: historical reports are not automatically backfilled; a separate backfill ticket is required if legacy RAG search is needed.

## Stream B — KPI and management reporting

Status: **in progress**.

- B1 — **complete**, commit `9811c0e`. Live KPI aggregates cover collected/invoiced revenue, open opportunities, issued quote value, quote win rate, and open/completed service delivery. CSAT is explicitly reported as unavailable because no CSAT schema was found.
- B2 — **active**. Make KPI tiles interactive and link to the underlying records/tasks.
- B3 — **queued**. Daily/weekly/monthly management reporting; confirm delivery channel before implementing email or WhatsApp output.
- B4 — **queued**. PDF/Excel export for KPI dashboards and management reports.

Sequence: B1 → B2 → B3 → B4.

## Stream C — Financial visibility

- C1 — **unblocked, not started**. Discover existing subcontractor balances/rates, then implement thresholds, escalation notes, partial-payment requests, and execution-dependency warnings.
- C2 — **complete**, commits `973a220` and `c1d4507`. Migration 039 added the invoice/client PO/sales order/work-item crosswalk and the payment-release view. It was deployed and live-verified. The initial PostgreSQL UUID aggregation issue was fixed before completion.

## Stream D — Operational tracking

- D-1 — **unblocked, not started**. Daily time tracking across Categories A–F with Friday roll-up.
- D-2 — **unblocked, not started**. Partner development pipeline and 15-engagement target.
- D-3 — **unblocked, not started**. Near-completion testimonial/referral trigger.
- D-4 — **complete**, commits `434fcca` and `83a8ff2`. Capability checklist UI reuses the existing tasks infrastructure with `source = 'capability_checklist'`; no new schema.

## Stream E — Yeastar VoIP

Hard blocked pending actual Yeastar API/auth documentation and CloudMonkey PABX configuration details.

Planned sequence: E1 configuration → E2 recordings/CDR → E3 Gemini 2.5 Flash transcription → E4 customer matching/tagging rules → E5/E6 staff call and tagging views → E7 customer call history → E8 transcript RAG indexing.

Do not guess push/pull behavior, authentication, number matching, personal-call retention, or tagging permissions.

## Stream F — Inspection closeout and verification

- F1 — **complete**, commit `15fd893`. Browser print/save PDF export with print-specific styling.
- F2 — **complete**, commit `dd49dab`. Public `/sign/$token` includes full findings, remediation, comments, outcomes, risk levels, SANS clauses, and secure token-scoped evidence URLs. Existing sign-off is reused.
- F3 — **deferred**. Final repository, migration, deployment, and live verification after Streams A–E close.

## Agent split

| Agent | Assignment | Status |
|---|---|---|
| Agent 1 | B2 → B4 | Active B-stream owner |
| Agent 2 | C1 and D-1/D-2/D-3 | Unblocked, not started |
| Agent 3 | Yeastar discovery → E1–E8 | Blocked pending API/PABX details |

F3 remains outside the split and runs continuously at stream close, then as the final pass.

## Close-out requirements

- Run `npm run lint` and `npm run build`.
- Add tests for new business logic where a test harness exists; explicitly record coverage gaps where it does not.
- For money or client approval flows, record manual verification steps.
- State what changed, what was deliberately not changed, and the discovery findings.
- Document schema changes inline in migrations; do not introduce new schema where an existing pattern is sufficient.
- Use one scoped commit or tightly scoped commit series per ticket.
- Push to GitHub only after the branch is clean and synced.
- Deploy and verify the live container, health/readiness, database migration state, and protected routes before marking a ticket complete.
- If discovery contradicts this backlog, stop and document the discrepancy rather than silently changing scope.

## Coordination message

> Hi Kiril/Vusi — three product decisions are on the critical path for STI Risk OS. To keep progress moving, we've proceeded on working defaults grounded in our prior discussions — flag if any of these should change:
>
> 1. D1 — Maintenance quote gate: applying the standard payment gate, with a bypass for strategic/pre-arranged clients via the existing relationship-type tag.
> 2. D2 — Stakeholder mapping: building the KPI/reporting layer against the existing role structure (Kiril/Vusi/Melissa + client relationship tags) — a more detailed mapping can extend this later.
> 3. D3 — Item 10: note types follow the Survey/Inspection structured-findings pattern; technicians see remediation options only, coordinators attach pricing before anything is client-visible.
>
> Report assembly (item 10) and the KPI dashboard's data layer are already live on these defaults. Please confirm or correct before the reporting layer goes further.
