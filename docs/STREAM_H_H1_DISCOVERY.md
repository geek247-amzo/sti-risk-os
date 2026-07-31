# Stream H — H1 Compliance/AI Signal Consolidation Discovery

Date: 2026-07-31
Repository state reviewed: `main` at `20614a3`

## Finding

The three signal systems are separate by purpose and data shape. They overlap in subject
matter (site/area safety) but do not currently form one shared score or write into one another.
The repository supports keeping them federated, with any future combined score treated as a
presentation/aggregation concern unless Kiril/Amrish explicitly choose a stored score object.

## Current systems and callers

### `compliance_records`

- Migration: `034_compliance_records.sql`.
- Human-entered append-only area/asset state: `green`, `red`, or `yellow`; yellow requires a note.
- Required links: `area_id` and `site_visit_id`; optional asset, service report, quote, and assessor.
- Write path: `/api/compliance-records`, used by `src/routes/staff.compliance.tsx`.
- Read paths: the staff Compliance page, project QR/sticker views, and project-level compliance
  queries in `src/server/api.ts`.
- Downstream links: a record can be linked to an existing `service_report` or `quote`. It is
  therefore capable of appearing in client-facing project QR/sticker output, although the
  compliance record itself is human-entered and not an AI result.

### Vusi Tools

- Migrations: `047`–`052`.
- Fire scan: fixed SANS checklist items scored `met`, `not_met`, or `unclear`, with Gemini
  rationale. Evidence is stored through `evidence_files`, but the scan tables are standalone.
- Area findings report: single-image, two-stage Gemini description plus SANS-oriented overview,
  risk, concerns, actions, and findings. It is explicitly advisory.
- Write/read paths: `/api/vusi-tools/sans-scan` and
  `/api/vusi-tools/findings-report`; staff routes `/staff/vusi-tools` and
  `/staff/vusi-tools/findings-report`.
- No callers were found from Vusi Tools into `compliance_records`, formal inspections,
  `service_reports`, quotes, or the inspection AI fields. Its optional `site_visit_id` is context
  only.

### Formal inspection AI compliance

- Migrations: `025_checklist_inspections.sql` and `027_documentation_photo_compliance.sql`.
- The signal is stored on `inspection_item_responses.ai_compliance_result` with values
  `plausible_match`, `unclear`, or `mismatch`, plus rationale, timestamp, and error fields.
- It is produced by the formal inspection evidence upload path when the response belongs to a
  documentation-category checklist item. The existing `checkDocumentationPhotoCompliance`
  function remains scoped to that formal document-photo workflow.
- Read paths include staff Inspections and Survey Reports. Formal inspection responses and
  findings are assembled into service reports, so this signal participates in the formal report
  pipeline rather than the Vusi Tools advisory pipeline.

## Actual overlap and conflict

The code contains no automatic cross-system conflict detection and no evidence that one system
currently overwrites another. The same physical area can be represented by all three systems,
but each row is independently created and assessed. A conflict is therefore possible at the
human interpretation level—for example, a human `green` compliance record alongside a Vusi
`not_met` visual result—but there is currently no stored relationship or aggregate that resolves
that conflict.

## Decision support

1. **Stored aggregate score:** gives management one comparable view, but requires defining
   weighting, freshness, conflict handling, verification status, and ownership across signals.
   It risks making an advisory photo result look equivalent to a signed human or formal
   checklist result.
2. **Deprecation/consolidation:** reduces parallel concepts, but requires historical migration,
   UI/report changes, and a deliberate decision about which evidence loses meaning. No current
   caller analysis supports safely removing any of the three.
3. **Federation with presentation-only aggregation:** preserves the existing safety boundaries
   and lets each system answer its own question. A future dashboard can show the three signals
   side by side with source, timestamp, and verification label without creating false equivalence.

## Recommendation for Kiril/Amrish

Keep the systems federated for now (option 3). If a combined Compliance Score is required later,
start with a read-only presentation model that labels source and verification tier explicitly.
Do not alter schemas or migrate historical data until the product decision is recorded.

This memo is discovery only; H1 makes no schema or UI change.
