# STI Risk AI Autonomous CRM MVP

## Objective

Build a CRM-backed STI Risk staff portal that captures public leads, creates sales pipeline records, and prepares AI-assisted recommendations for staff review before any external action is taken.

## MVP Scope

- Public contact and partner referral forms create or update CRM contacts, organizations, deals, inbound events, audit events, and pending AI recommendations.
- Staff users authenticate with Microsoft SSO restricted to `stirisk.co.za`; sessions are backed by Postgres. A local `admin@stirisk.co.za` super admin credential is available for break-glass access.
- Staff dashboard, pipeline, and contacts screens read live CRM data.
- Deal stage movement records stage history, activities, timestamps, and audit events.
- n8n and Hermes integrations call signed `/api/webhooks/*` and `/api/hermes/tools/*` endpoints over the private Docker network.
- AI actions are recommendation-only in this MVP. Staff approval is required before outbound email, archive/delete, or won/lost changes.

## Architecture

- TanStack Start app serves the public site, staff UI, and `/api/*`.
- PostgreSQL stores CRM data and sessions. `pgcrypto`, `citext`, and `vector` are required extensions.
- Caddy exposes `80/443`; PostgreSQL, n8n, and Hermes stay on the private Docker network.
- Local Docker volumes store database, n8n, Hermes, and MVP file data.

## Operational Defaults

- Currency: ZAR.
- Embedding dimension: `vector(768)` for Gemini embedding models.
- Email workflows ship disabled until IMAP/SMTP credentials are provided.
- Production domain: `stirisk.cloudmonkey.co.za`.
