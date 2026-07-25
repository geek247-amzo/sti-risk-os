# STI Risk OS — Completion Backlog

Repository: `github.com/geek247-amzo/sti-risk-os`

This is the canonical hand-off and execution backlog. Every ticket follows:

> discovery → confirmed code/database shape → scoped ticket → implementation → tests → deployment verification → documented close-out

## Current status

Complete and live: F1, F2, C2, D-4, A1, A2, A3, B1, C1, D-1, D-2, and D-3.

Complete and live: B2 — KPI drill-down UI.

Active: B3 delivery automation is deferred; email is the confirmed channel. Generated report snapshots remain live. B4 is complete for the export layer.

Unblocked and not started: none in Stream D. C1, D-1, D-2, and D-3 are complete.

Staged: E2 recording/CDR ingestion implementation, waiting on Yeastar secret rotation and portal retention confirmation. E1 remains online and live.

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
- D5 — No Yeastar integration existed in the STI Risk repo at discovery. The supplied host serves a Yeastar P-Series Software Edition PBX. Confirmed API base is the PBX root with `/openapi/v1.0` endpoints, not the UI's `/integration/api` path: `POST /openapi/v1.0/get_token` accepts the client ID and secret as JSON `username`/`password`, returns a 30-minute access token and 24-hour refresh token, and authenticated read-only calls to `system/information` and `cdr/getoption` succeed. CDR and recording APIs are available through the OpenAPI surface; use query-string `access_token` authentication and the documented `User-Agent` header. TLS serves a generic UCCPBX certificate that does not match the raw IP; pin its known SHA-256 certificate fingerprint rather than disabling verification. Credentials are stored only in the server secret environment and are not in this repository.

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
- B2 — **complete**, commit `f104fa4`. KPI tiles now link directly to the underlying billing, CRM, quotations, and work-record surfaces. No new schema or reporting endpoint was needed; the existing KPI data layer and staff routes are reused.
- B3 — **snapshots live; email delivery decision confirmed**, commit `0b50a11`. Added protected daily/weekly/monthly management report generation over existing CRM, billing, quotation, and work-item data. Email is the selected future delivery channel; automatic sending is not enabled in the current go-live scope.
- B4 — **complete and live**, commit `abbefe0`. Generated management snapshots support Excel-compatible CSV export and browser Print / Save PDF using the existing print workflow. No export library or schema was added. Production verification: `/health` 200, `/ready` 200 with DB ready, protected management API 401 without authentication, container healthy.

Sequence: B1 → B2 → B3 → B4.

## Stream C — Financial visibility

- C1 — **complete**, commit `fb1e3dd`. Existing subcontractor rate cards, POs, work-item links, statuses, due dates, and pending amounts now drive configurable balance/overdue alerts in the billing surface. The shipped policy is notification-only and internal to Vusi; it does not notify subcontractors or gate work assignment. Escalation tasks, partial-payment requests, and any execution gate remain separate follow-on decisions.
- C2 — **complete**, commits `973a220` and `c1d4507`. Migration 039 added the invoice/client PO/sales order/work-item crosswalk and the payment-release view. It was deployed and live-verified. The initial PostgreSQL UUID aggregation issue was fixed before completion.

## Stream D — Operational tracking

- D-1 — **complete**, commit `e340a98`. Reused the existing seeded `staff_time_entries` table and KPI aggregation. Added authenticated time-entry creation and a Vusi workspace logger for Revenue Development, Partner Development, Project Delivery, Quotations, Strategy & Management, and Travel with weekly roll-up. No new schema.
- D-2 — **complete**, commit `e60e52d`. Extended the existing partner-prospects growth view with the 15-engagement target, communication-based engagement count, category summary, pipeline count, and existing follow-up task actions. No new schema.
- D-3 — **complete**, commit `3ac15b3`. Completed inspections linked to projects automatically create an idempotent, project-scoped testimonial/referral follow-up task due in seven days. Completed projects also expose a protected staff trigger for workflows that bypass inspection completion. No new schema; existing task board, embeddings, and audit trail are reused. Discovery found no existing project-status mutation route, so the inspection completion boundary plus explicit staff fallback are the real integration points. Notification is internal task workflow only; no client message is sent automatically.
- D-4 — **complete**, commits `434fcca` and `83a8ff2`. Capability checklist UI reuses the existing tasks infrastructure with `source = 'capability_checklist'`; no new schema.

## Stream E — Yeastar VoIP

E1 discovery is complete. The PBX is reachable and authenticated with the server-injected credentials. No recording/CDR ingestion has been implemented yet.

Confirmed sequence: E1 authentication → E2 recordings/CDR → E3 Gemini 2.5 Flash transcription → E4 customer matching/tagging rules → E5/E6 staff call and tagging views → E7 customer call history → E8 transcript RAG indexing.

- E1 — **discovery complete**, commit `546f08e`. Server env vars are present, token exchange succeeds, access-token expiry is 30 minutes, refresh-token expiry is 24 hours, and low-risk authenticated calls succeed. No credentials are committed.
- E2 — **deferred for later go-live phase**. Discovery is complete: this PBX returned `INTERFACE NOT EXISTED` for `webhook/query` under both `openapi/v1.0` and `openapi/v2.0`, so ingestion must support scheduled pull/reconciliation first. The recording list is live and currently reports 20 recordings. Retention is governed by PBX auto-cleanup settings and still needs portal confirmation; credential rotation is also pending. No recording/CDR ingestion is enabled yet.

Do not guess push/pull behavior, authentication, number matching, personal-call retention, or tagging permissions.

## Stream F — Inspection closeout and verification

- F1 — **complete**, commit `15fd893`. Browser print/save PDF export with print-specific styling.
- F2 — **complete**, commit `dd49dab`. Public `/sign/$token` includes full findings, remediation, comments, outcomes, risk levels, SANS clauses, and secure token-scoped evidence URLs. Existing sign-off is reused.
- F3 — **deferred**. Final repository, migration, deployment, and live verification after Streams A–E close.

## Agent split

| Agent | Assignment | Status |
|---|---|---|
| Agent 1 | B3 delivery automation → B4 | Email delivery remains deferred in the current go-live scope |
| Agent 2 | C1 / D | C1 and Stream D complete |
| Agent 3 | E2 → E8 | E1 online; ingestion deferred until credential rotation and retention confirmation |

F3 remains outside the split and runs continuously at stream close, then as the final pass.

## Stream G — Onboarding, Help Center, Design Polish & Bug Reporting

*Status: **Scoped.** Discovery confirmed the existing implementation patterns and the remaining greenfield areas directly against the repository.*

**Confirmed existing state:**
- `src/components/staff/StaffGuide.tsx` contains the custom spotlight tour system with overview, workflow, and Steve guides, first-login localStorage gating, and Help-dropdown relaunch.
- Staff navigation automatically exposes `data-guide="nav-{slug}"` targets, but authored content currently covers only a small subset of shipped routes.
- No persistent browsable help center exists yet.
- The design system uses shadcn new-york, Tailwind v4, oklch CSS tokens, dark theme, brand orange/blue tokens, and Inter; polish must extend these tokens rather than replace them.
- No bug-report schema or screenshot capture dependency exists yet.
- Microsoft Graph is the only outbound email integration; there is no SMTP, Resend, or SendGrid path.
- `AGENTS.md` identifies Lovable.dev integration; do not force-push, rebase, or amend pushed commits.

**Open decision before G5:** choose the designated STI Risk service mailbox for Microsoft Graph `sendMail` to `bugs@cloudmonkey.co.za`. Do not add a second email provider without an explicit decision.

- **G1 — Help Center page:** Promote the existing tours into a persistent `/staff/help` browsable route with relaunchable spotlight guides and static reference content, reusing the existing guide data structure.
- **G2 — Content buildout:** Add authored guides for shipped KPI, cash-flow, capability, partner, testimonial/referral, time-tracking, inspection, reporting/export, and future Yeastar features. Revisit on future releases.
- **G3 — Design polish audit + pass:** Produce a short findings list covering empty/loading states, spacing, hover/focus, and token consistency before making bounded polish changes.
- **G4 — Bug report capture UI:** Add DOM screenshot capture, comment, URL, reporter, submit flow, and a `bug_reports` table with screenshot reference, status, and timestamps.
- **G5 — Bug report delivery:** Send reports to `bugs@cloudmonkey.co.za` through Microsoft Graph from the designated service mailbox, with screenshot attachment and report context. Depends on G4 and mailbox selection.

**Sequence:** G1 → G2 (ongoing); G3 independent; G4 → G5.

**Suggested assignment:** G1/G2 with the B-stream domain; G3 independent; G4/G5 as a separate implementation track.

**G1 status:** **complete and live**, commit `f386947`. `/staff/help` is deployed and redirects unauthenticated users to staff login; production `/health` and `/ready` return 200 and the container is healthy. No new schema.

**G2 status:** **complete and live**, commit `46651b4`. Authored walkthroughs now cover KPI drill-down, finance/cash-flow alerts, capability checklist, partner development, time tracking, testimonial/referral triggers, inspections, and management reports/exports. Yeastar call-handling content remains deferred until E2 ships. Build passed; `/health` and `/ready` return 200; `/staff/help` remains protected by the staff login redirect. No new schema.

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

Yeastar credentials are stored in the server secret environment. The raw credential values must never appear in this file, chat, logs, or commits; rotate the client secret after this chat-based handoff.
