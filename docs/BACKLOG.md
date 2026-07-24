# STI Risk OS — Completion Backlog

Repository: `github.com/geek247-amzo/sti-risk-os`

This is the canonical hand-off and execution backlog. Every ticket follows:

> discovery → confirmed code/database shape → scoped ticket → implementation → tests → deployment verification → documented close-out

## Current status

Complete and live: F1, F2, C2, D-4, A1, A2, A3, B1, C1, D-1, D-2, and D-3.

Active: B2 — KPI drill-down UI.

Queued: B3 — automated management reporting; B4 — PDF/Excel export.

Unblocked and not started: none in Stream D. C1, D-1, D-2, and D-3 are complete.

Blocked: Stream E pending Yeastar API/auth and PABX details.

Deferred: F3 final verification, until the remaining streams close.

The repository is currently clean and production has been verified healthy (`/health` 200; `/ready` 200 with database ready). The only open coordination item is secure placement of the Yeastar credentials.

## Working product defaults

These are the finalized product decisions from the prior stakeholder discussions.

- D1 — **final**: maintenance quotes use the standard payment/e-signature gate, with a per-client bypass for strategic/pre-arranged clients using the existing relationship-type pattern.
- D2 — **final**: KPI/reporting ownership uses the existing Kiril/Vusi/Melissa role structure and client relationship tags. A richer stakeholder map can extend the design later.
- D3 — **final**: Item 10 uses the Survey/Inspection structured-findings pattern: Fault Found, Recommendation, Immediate Fix, and Deferred Work. Technicians select remediation options; coordinators attach pricing before client visibility.

Agents must preserve these decisions unless a later change request explicitly supersedes them. Stream E has no equivalent default for undocumented API behavior.

## Discovery findings

- D4 — `site_visits`, `evidence_files`, `service_reports`, and `work_items` exist and are linked. Media uses `file_path` and the Docker uploads volume. `capture_phase` supports before/during/after. No object-storage abstraction exists.
- D5 — No Yeastar API, CDR, recording, webhook, or CloudMonkey integration exists in the STI Risk repo. The supplied host is reachable; `/integration/api` serves the PBX UI and the actual API prefix is `/api/v1.0`. CDR/recording/extension endpoint families are visible, and unauthenticated calls return `TOKEN EXPIRED`. TLS serves a generic UCCPBX certificate that does not match the raw IP; pin its known SHA-256 certificate fingerprint rather than disabling verification. Authentication remains blocked until credentials are stored securely.

Observed current UCCPBX certificate SHA-256 fingerprint: `1cd9ecf2f9e01e3fa0d17105b2998b80ec04f5193b60180da5e390d55fe10586`. Confirm it again before production pinning if the PBX certificate changes.
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

- C1 — **complete**, commit `fb1e3dd`. Existing subcontractor rate cards, POs, work-item links, statuses, due dates, and pending amounts now drive configurable balance/overdue alerts in the billing surface. The shipped policy is notification-only and internal to Vusi; it does not notify subcontractors or gate work assignment. Escalation tasks, partial-payment requests, and any execution gate remain separate follow-on decisions.
- C2 — **complete**, commits `973a220` and `c1d4507`. Migration 039 added the invoice/client PO/sales order/work-item crosswalk and the payment-release view. It was deployed and live-verified. The initial PostgreSQL UUID aggregation issue was fixed before completion.

## Stream D — Operational tracking

- D-1 — **complete**, commit `e340a98`. Reused the existing seeded `staff_time_entries` table and KPI aggregation. Added authenticated time-entry creation and a Vusi workspace logger for Revenue Development, Partner Development, Project Delivery, Quotations, Strategy & Management, and Travel with weekly roll-up. No new schema.
- D-2 — **complete**, commit `e60e52d`. Extended the existing partner-prospects growth view with the 15-engagement target, communication-based engagement count, category summary, pipeline count, and existing follow-up task actions. No new schema.
- D-3 — **complete**, current commit. Completed inspections linked to projects automatically create an idempotent, project-scoped testimonial/referral follow-up task due in seven days. Completed projects also expose a protected staff trigger for workflows that bypass inspection completion. No new schema; existing task board, embeddings, and audit trail are reused. Discovery found no existing project-status mutation route, so the inspection completion boundary plus explicit staff fallback are the real integration points. Notification is internal task workflow only; no client message is sent automatically.
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
| Agent 2 | C1 / D | C1 and Stream D complete |
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

## Coordination

D1–D3 are final and no longer require a stakeholder confirmation message. Any later objection is a normal change request against shipped functionality, not a blocker.

Yeastar credentials must be stored in the server secret environment before authenticated E1 discovery resumes. The raw credential values must never appear in this file, chat, logs, or commits.
