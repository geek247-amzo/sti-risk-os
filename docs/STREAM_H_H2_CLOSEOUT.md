# Stream H — H2 Close-out

Date: 2026-07-31

## Implemented

- Added `site_visit_notes` in migration 053, linked to `site_visits` and optionally to
  `evidence_files`.
- Added typed note categories: voice, typed, question, recommendation, and missing information.
- Added urgent, immediate-danger, and specialist-review flags.
- Immediate danger automatically persists as urgent and is surfaced in site-visit counts and the
  staff site-visit screen.
- Added protected API endpoints:
  - `GET/POST /api/site-visits/:id/notes`
  - site-visit listing now includes note, urgent, and immediate-danger counts.
- Added staff route: `/staff/site-visits`.

## Deliberately not implemented

- No notification, SMS, email, or task creation pipeline. The flag is visible to staff and remains
  available for a follow-up notification ticket.
- No changes to `evidence_files` or formal inspection tables.
- The current staff form captures note text and flags; voice capture/transcription remains a
  follow-up integration with the existing voice/evidence capture UX.

## Verification

- `npm run build`: passed.
- Live migration 053: applied successfully.
- Live quick-note POST/GET: passed.
- Immediate-danger round trip: persisted `is_immediate_danger = true` and `is_urgent = true`.
- Live `/health`: 200.
- Live `/ready`: 200.
- Full lint remains unsuitable as a gate because the repository has pre-existing formatting
  violations; the new route is included in the successful production build.
