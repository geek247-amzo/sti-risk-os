# STI Risk OS — Completion Backlog

Repository: `github.com/geek247-amzo/sti-risk-os`

This is the canonical hand-off and execution backlog. Every ticket follows:

> discovery → confirmed code/database shape → scoped ticket → implementation → tests → deployment verification → documented close-out

## Current status

Complete and live: F1, F2, C2, D-4, A1, A2, A3, B1, C1, D-1, D-2, and D-3.

Complete and live: B2 — KPI drill-down UI.

Active: B3 delivery automation is deferred; email is the confirmed channel. Generated report snapshots remain live. B4 is complete for the export layer.

Unblocked and not started: none in Stream D. C1, D-1, D-2, and D-3 are complete.

E2 recording/CDR ingestion is live. E1 remains online and live.

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
- E2 — **complete and live**, commits `4668973`, `77d2097`, and `165d097`. Discovery confirmed this PBX returned `INTERFACE NOT EXISTED` for `webhook/query` under both `openapi/v1.0` and `openapi/v2.0`, so ingestion uses scheduled pull/reconciliation. The production poller runs in the single homepage container on a configurable 20-minute default interval (bounded to 15–30 minutes), uses a configurable 120-minute idempotent backfill window, and stores CDR plus recording metadata in `yeastar_calls`. The initial retained-record backfill imported 48 calls from 51 CDRs and 20 recordings; the follow-up poll was idempotent. Certificate chain trust and SHA-256 pinning are enforced; TLS verification is not disabled.
- E3 — **transcription complete for all available recordings**, implementation commit `5f2015b`. Recordings are downloaded to the persistent uploads volume and sent to Gemini 2.5 Flash with retryable transcription status. The authenticated `/staff/voice` panel exposes imported CDRs, recording metadata, transcript text, and transcription status. Live verification now shows 19/19 retained recording files transcribed successfully; the remaining 29 imported rows are CDR-only calls with no recording attached, not stuck retries. E4 matching/tagging is now live; wider staff/customer call views remain E5–E7.
- E4 — **complete and live**, commits `9cddcc0` and `ee629bd`. Migration 043 adds Yeastar extension ownership mappings, per-number Personal rules, and call tag/customer ownership fields. The live poller syncs the PBX extension list into staff users, applies normalized South African number matching only when unambiguous, and leaves unmatched calls in the self-service queue. Staff can link their own calls to a customer or mark a number Personal; completed personal-call audio is deleted while metadata and the Personal label remain. Live verification confirmed five PBX extensions, staff ownership assignment, 15 existing unambiguous customer matches, 33 unmatched calls, authenticated `/staff/voice` data access, and a 403 when another staff member attempts to tag a call.

E4 intentionally does not add fuzzy matching, supervisor reassignment, customer-facing call visibility, or audio retention for Personal calls.

- E5 — **complete and live**, follow-up to E4. `/staff/voice` is now linked in the staff sidebar by E9 and non-admin staff users see only calls assigned to their own extension; admins retain internal oversight access.
- E6 — **complete and live**, follow-up to E4. The same Voice panel exposes each staff member’s unmatched-call tagging queue with customer linking and Personal actions. Tagging remains self-service and unauthorized reassignment returns 403.
- E7 — **complete and live**, current implementation adds matched Yeastar call history and transcripts to the authenticated staff CRM contact detail page. It is staff-only and does not expose call data through customer-facing routes. The Voice panel now also displays the normalized external number for each call, shows the mapped staff owner, and links matched calls directly to the customer profile for administrator/staff review.
- E8 — **complete and live**, commit `30a8097`. Completed non-Personal Yeastar transcripts are indexed into the existing `embedding_documents`/Steve RAG pipeline as `yeastar_call` sources; Personal calls are excluded and any prior Personal documents are removed. Live verification indexed 19 transcript documents. Vector generation remains handled by the existing embedding worker through the normal pending-document flow.
- E9 — **complete and live**, commit `44b5102`. Added Voice to the Operate staff navigation so `/staff/voice` is discoverable and receives the existing `data-guide="nav-voice"` target.

**Voice-to-profile and Steve context refinement:** The existing Yeastar matcher normalizes South African phone-number variants and maps PBX extensions to staff users before applying only unambiguous customer matches. `/staff/voice` now exposes the normalized external number, staff ownership, and a direct customer-profile link for matched calls. Steve's authenticated context now includes recent authorized non-Personal calls and transcripts: administrators receive the internal call set, while non-admin staff receive only calls assigned to their own staff identity. Personal call content remains excluded from this context and from RAG.

## Stream F — Inspection closeout and verification

- F1 — **complete**, commit `15fd893`. Browser print/save PDF export with print-specific styling.
- F2 — **complete**, commit `dd49dab`. Public `/sign/$token` includes full findings, remediation, comments, outcomes, risk levels, SANS clauses, and secure token-scoped evidence URLs. Existing sign-off is reused.
- F3 — **deferred**. Final repository, migration, deployment, and live verification after Streams A–E close.

## Agent split

| Agent | Assignment | Status |
|---|---|---|
| Agent 1 | B3 delivery automation → B4 | Email delivery remains deferred in the current go-live scope |
| Agent 2 | C1 / D | C1 and Stream D complete |
| Agent 3 | E2 → E8 | E1–E4 live; E5–E8 remain for the staff/customer call views and transcript RAG |

F3 remains outside the split and runs continuously at stream close, then as the final pass.

## Stream G — Onboarding, Help Center, Design Polish & Bug Reporting

*Status: **Scoped.** Discovery confirmed the existing implementation patterns and the remaining greenfield areas directly against the repository.*

**Confirmed existing state:**
- `src/components/staff/StaffGuide.tsx` contains the custom spotlight tour system with overview, workflow, and Steve guides, first-login localStorage gating, and Help-dropdown relaunch.
- Staff navigation automatically exposes `data-guide="nav-{slug}"` targets, but authored content currently covers only a small subset of shipped routes.
- Persistent browsable Help Center exists at `/staff/help`; its content was not previously part of the embedding pipeline.
- Steve's local `/api/steve/ask` path combines doctrine-driven answer text with full-text embedding matches. The normal staff chat delegates to the active n8n workflow, which calls back into the app's staff context and internal vector/text RAG endpoints.
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
- **G6 — Cross-page guided transaction walkthrough:** Extend the custom tour engine so a single walkthrough can wait for real target clicks, navigate across confirmed transaction routes, and resume after route changes. This is an engine capability change, not additional guide copy. Use the real transaction code paths with an explicit `is_tutorial` marker on every created quote, client PO, sales order, work item, and invoice. Exclude marked records from KPI/report aggregates and client-facing views, visibly label tutorial mode, and automatically archive/delete the tutorial chain on completion or abandonment.
- **G7 — Steve Help Center retrieval:** Embed authored guide and Help Center reference content as `help_guide` documents, confirm the n8n staff-agent workflow's callback path, and verify semantic retrieval uses the existing text/vector RAG layer without bypassing staff permissions. Do not grant Steve raw unrestricted database access.

**Sequence:** G1 → G2 (ongoing); G3 independent; G4 → G5; G6 is independent but should follow its route-map discovery.

**Suggested assignment:** G1/G2 with the B-stream domain; G3 independent; G4/G5 as a separate implementation track; G6 with the tour/navigation owner.

**G1 status:** **complete and live**, commit `f386947`. `/staff/help` is deployed and redirects unauthenticated users to staff login; production `/health` and `/ready` return 200 and the container is healthy. No new schema.

**G2 status:** **complete and live**, commit `46651b4`. Authored walkthroughs now cover KPI drill-down, finance/cash-flow alerts, capability checklist, partner development, time tracking, testimonial/referral triggers, inspections, and management reports/exports. Yeastar call-handling content remains a future content refresh now that the verified E3/E4 staff workflow exists. Build passed; `/health` and `/ready` return 200; `/staff/help` remains protected by the staff login redirect. No new schema.

**G3 audit findings and pass:** **complete and live**, commit `32df8ad`. The token system and hover coverage were consistent overall, but keyboard focus treatment was inconsistent, inspection loading was spinner-only, and finance empty states varied. Added shared token-aligned `focus-visible` treatment plus reusable loading/empty primitives, applied to inspection loading and the finance invoice empty state. Build passed; `/health` and `/ready` return 200; `/staff/help` remains protected; container healthy. No restyle, schema, or workflow changes.

**G4 status:** **complete and live**, implementation commit `a30e587`. Added the Help-menu bug-report dialog with DOM screenshot capture via `html2canvas`, comment and current URL capture, authenticated multipart submission, local screenshot storage, audit logging, and migration 040 creating `bug_reports`. Re-verified specifically against `github.com/geek247-amzo/sti-risk-os` at `e2bde11`: migration 040 is applied and `bug_reports` exists in the live DB; container is healthy; `/health` 200; `/ready` 200; `/staff/help` redirects unauthenticated users to login; and `POST /api/bug-reports` returns 401 without authentication. Manual browser verification remains the final operational check: open Help → Report a bug, submit a comment, and confirm the record and screenshot are stored. G5 delivery is deliberately not included.

**G6 discovery:** The current `StaffGuide` has localStorage first-login/relaunch state, page-local spotlight targets, and no route-resume or real-click advancement. TanStack Router route surfaces confirmed for the first route map are `/staff/quotes/new` → `/staff/quotes/$quoteId` → `/staff/po-orders` → `/staff/field-work` → `/staff/inspections` → `/staff/inspection-reports` → `/staff/billing`; the underlying APIs are `/api/quotes`, `/api/pos`, `/api/field/*`, `/api/inspections/*`, `/api/inspection-reports`, and `/api/billing/*`. The existing route tree already exposes navigation state through `useRouterState`, but no tour subscriber exists.

**Help scroll bug:** The header Help dropdown and `/staff/help` Help Center list were reported as non-scrollable when their content exceeded the viewport. Both surfaces now have bounded height and `overflow-y-auto`; verify the behavior in a real browser alongside the G6 walkthrough.

**G7 discovery/status:** The n8n database contains active workflow records for `STI Risk - Ask Steve Staff Agent` and `STI Risk - Gemini RAG Reindex`; the staff workflow is configured to call `STI_STAFF_AGENT_CONTEXT_URL` plus `STI_RAG_SEARCH_URL`, and the repo-side internal context/RAG endpoints perform full-text/vector retrieval. After restarting the n8n container, both live webhook probes still return `404 webhook not registered`; the n8n database has no corresponding `webhook_entity` rows, so this is an n8n runtime/workflow-registration issue outside the STI app build and is not fixed by an STI container restart. The staff workflow also needs to pass requester identity to the RAG callback before it can use the new staff-scoped filtering. The repo now seeds 14 Help Center guide/reference documents as `help_guide`; live DB verification shows all 14 are present but pending vectorization because the reindex webhook is unavailable. Permission filtering is now deployed in commit `c8cb63d`: missing requester identity is rejected, administrators can retrieve all call documents, and non-admins are limited to matched calls or their own calls. **Acceptance is role-aware retrieval, not identity-only retrieval:** staff questions must not expose company-wide financials, another staff member's calls, or other records outside that user's position; manager/admin visibility must be explicitly differentiated and denied results should be filtered or declined. G7 remains open until n8n registration/configuration, requester-identity propagation, vectorization, and end-to-end cross-role permission checks are verified.

**G7 incident fix:** The live staff-agent workflow was reaching the RAG endpoint without forwarding `userId`/staff identity, so the endpoint correctly returned `Requester identity is required for RAG search` and the chat surfaced a 500/unavailable response. The active n8n workflow was patched to pass the authenticated user identity and role into the RAG request, then n8n was restarted. A real authenticated admin payload now completes the webhook with HTTP 200 and a Steve response. Cross-role staff leakage tests and n8n-admin verification remain part of G7 close-out.

**G8 — Persistent Ask Steve widget:** **Implementation in progress.** The staff layout now has a floating Ask Steve control that opens a short authenticated entry panel and links to the existing `/staff/chat` route; it does not create a second chat or authentication path. Build and targeted lint pass locally. Deployment and live browser verification remain before close-out.

**G9 discovery correction:** The proposed binary-role finding was not accurate for this repository. The schema and `User` type already support `admin`, `staff`, `agent`, and `viewer`; `manager` is the only new tier required. Final role direction is: `admin@stirisk.co.za` and Kiril are admins with full access/approval authority; Vusi is manager; Mellissa and George are staff; Steve authenticates as an agent but **must not inherit admin authority**. Production currently has Kiril/admin, Vusi/staff, Mellissa/staff, George/staff, Steve/admin, and the super-admin/admin account, so Steve's current admin flag is an explicit correction target. Role checks are distributed across authentication, Steve admin allowlisting, CRM/work/task routes, finance, settings, and staff-agent actions. Existing `admin`-only checks must remain narrow unless the permission review explicitly promotes managers; existing `admin`/`staff` checks generally represent staff-portal access and should not be mechanically replaced. G9 implementation is therefore blocked on completing and documenting the per-check manager decision, safely correcting Steve's role, and assigning the finalized user tiers; no role checks have changed yet. G10 remains downstream of this audit and the finalized content-sensitivity categories.

**G10:** Approval-gated Steve content/template/project proposals remain unstarted pending G9. No autonomous writes are approved.

## G11/G12 — Creation-form integrity audit and Field Work fix

**G12 discovery result:** The creation-form audit covered projects, quotes, client POs, Field Work, inspections, inspection reports, clients, CRM contacts/deals, subcontractors, tasks, billing, and operational checklist forms. The confirmed downstream-linkage gap was isolated to Field Work: its creation form previously captured only title, work type, priority, scheduled date, and scope, while the `work_items` model and downstream reporting expected client/site/project/owner context. The other reviewed forms either already captured their required context or intentionally support an unmatched/draft state (for example, an incoming client PO can be unmatched until staff reconcile it). No unrelated creation forms were changed as part of this audit.

- **G11 — complete and deployed:** Field Work creation now requires a client and site, offers a client-filtered project selector, and supports internal staff ownership plus optional active-subcontractor assignment. The server validates that the selected site belongs to the client, the project belongs to the selected client/site, and assigned owners/subcontractors are valid before insertion. The form layout was expanded to a responsive multi-row layout. Migration 046 adds `work_items.subcontractor_id` with a foreign key and index; existing `owner_id` remains the internal staff owner. Existing unassigned records were not bulk-edited or deleted; their data status is preserved for a separate cleanup decision if needed.

G12 intentionally did not remove or alter Lemlist/Pipedrive. Pipedrive cleanup remains a separate low-risk historical-import decision, and Lemlist removal still requires choosing between preserving Growth as internal-only functionality or removing the Growth/campaign/segment surfaces entirely.

The data-integrity decision is finalized: use real code paths, not a parallel sandbox, but mark all records created by the walkthrough with `is_tutorial = true`. **G6 remains reopened/in progress after human walkthrough feedback.** The implementation includes migration 044, tutorial flags on the five transaction tables, route-aware steps, real action targets through billing, tutorial cookie state, core list/KPI/report exclusions, and a production server sweep every 15 minutes that deletes tutorial records older than two hours. Root cause of the “not taking me between pages” report was confirmed: route steps previously waited for the user to navigate manually, so starting from Help could leave the tour on a route-mismatched centered card. The engine now navigates to the declared route when a transaction step is reached, while real target clicks still advance the action. Build/deploy checks pass, but the required screen recording/live walkthrough is still outstanding before close-out. The Help dropdown and Help Center now have bounded scroll containers; human verification should include both surfaces.

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
