# Stream H — H4/H6/H7/H8 Discovery

Date: 2026-07-31
Repository state reviewed: `origin/main` at `2de7a6d`

This is discovery only. No H4, H6, H7, or H8 schema changes are made here.

## H4 — decision path and closure

### Current visit state

`site_visits.status` is defined in migration 029 as:

- `draft`
- `in_progress`
- `submitted`
- `staff_reviewed`

There is no current `decision_path`, `outcome`, `closed_at`, `closed_by`, or closure-check
field. Existing queries use the current status values directly, including review queues and the
Vusi Tools site-visit selectors. Enum surgery would therefore carry query and compatibility risk.

### Existing downstream objects

- `work_items` already support operational work and have `scheduled_for`, status, priority, and
  site/project/organization links. Field Work creates these through `/api/field/jobs`.
- `quotes` already support project/service quoting and are linked to organizations, sites,
  projects, work items, and client POs.
- `inspections` already support formal checklist inspections linked to sites, assets, areas,
  work items, and service reports.
- `consulting_solutioning_stages` links a site visit to a consulting/solutioning stage, service
  report, quote, and invoice, but its status is currently billing/delivery-oriented.
- `service_reports` support `site_survey` and `consulting` payloads and approval/client delivery
  states.
- `tasks` and `approval_requests` exist for internal follow-up/approval patterns.

### Decision-path mapping findings

The following are candidate mappings, not implementation decisions:

| Path | Candidate existing object | Discovery result |
| --- | --- | --- |
| Risk assessment | `service_reports` site survey or consulting stage | Existing report object, but objective/verification fields need confirmation. |
| Compliance review | `compliance_records` and/or formal `inspections` | Both exist and answer different questions; do not collapse them silently. |
| Service fault finding | `work_items` / Field Work | Cleanest existing operational target. |
| Project opportunity | `quotes` or a quote-linked work item | Existing quote path, but source/verification needs an explicit field. |
| Detailed asset audit | `inspections` | Formal inspection exists; no direct visit-to-inspection decision-path link yet. |
| Specialist escalation | `tasks` or `approval_requests` | Existing primitives exist, but specialist assignment and escalation semantics are not defined. |
| Insufficient evidence | visit follow-up task or deferred outcome | No dedicated object or status currently represents this. |

### H4 scope consequence

H4 can start with discovery of the nine-path contract and downstream adapters, but the storage
location should wait for H3's verified-record decision. A separate `outcome`/`decision_path`
column alongside the existing status is safer than changing the status check constraint. Closure
must be a separate acceptance gate: evidence, pathway, verification, report approval, and next
workflow/deferment must be checked before recording closure.

## H6 — request, trigger, and booking

### Existing scheduling infrastructure

- `/staff/schedule` and `/api/schedule` display task `due_at` values; they are not a booking or
  calendar-availability engine.
- `work_items.scheduled_for` supports a scheduled work date and is displayed in Field Work.
- `site_visits` can be created through `/api/site-visits` and already validate organization/site
  ownership, create/reuse an operational container, and link optional project/work-item/client PO.
- No booking-request table, requester/source/reason/urgency/access fields, calendar slot model,
  or client-facing booking flow was found.

### Identity reuse

The existing `organizations`, `sites`, `contacts`, `app_users`, projects, work items, and client
POs provide the identity/context foreign keys. A booking request should reference those records,
not copy names or contact details. A client-supplied reason classification must be labelled
preliminary/unverified until staff review.

### H6 scope consequence

H6 needs a new lightweight booking-request table unless product elects to make `site_visits`
itself the request object. The safer shape is a request table with an optional accepted
`site_visit_id`; it avoids treating an unaccepted request as an operational visit. Staff-facing
booking can use existing site-visit creation after acceptance. Client/partner portal scheduling
and true availability/slot booking are separate scope decisions.

## H7 — pre-assessment questionnaire

No structured questionnaire table, endpoint, or questionnaire UI exists. Existing sources that
can prefill or be referenced include organization/site/contact records, projects, quotes, work
items, site-visit notes/metadata, evidence, compliance records, and service-report payloads.

The questionnaire should therefore be attached to H6's booking request if H6 ships first, with an
optional direct site-visit link for already-created visits. The “enough information to plan” gate
is new business logic; it should return a state such as `ready`, `needs_information`, or
`reschedule_review`, without blocking the visit until product confirms that behavior.

## H8 — visit preparation and readiness

There is no existing prep-pack generator. There is, however, reusable report assembly:

- `buildConsultingReport` already assembles organization, site, container, project, work item,
  consulting stage, site-visit metadata, area, measurements, assets, evidence grouped by capture
  phase, and structured formal findings into a `service_reports.report_payload`.
- Inspection report generation already writes `site_survey` service reports and supports report
  detail and client sign-off flows.
- Existing evidence and document surfaces can supply known documents, but no single prep-pack
  payload or readiness record currently exists.

H8 should reuse the assembly patterns rather than create a second report engine. The readiness
gate (“knowledgeable representative confirmed”) should be recorded as a limitation/flag and not
block the visit unless a later product decision changes that rule.

## Recommended next sequence

1. Take H1 federation recommendation to Kiril/Amrish.
2. Run H4 discovery now, but defer storage implementation until H3's verified-record location is
   decided.
3. Scope H6's booking-request table and staff acceptance flow; keep portal availability separate.
4. Design H7 against the H6 request object.
5. Build H8 from the existing consulting/inspection report assembly once H6/H7 shapes are stable.
