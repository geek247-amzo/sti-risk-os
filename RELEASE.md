# STI Risk Production Release Checklist

## Required Configuration

1. Copy `.env.example` to `.env`.
2. Set strong unique values for `POSTGRES_PASSWORD`, `SESSION_SECRET`, `WEBHOOK_SECRET`, `N8N_AGENT_TOKEN`, and `INITIAL_ADMIN_PASSWORD`.
3. Configure Microsoft Entra SSO with `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and `MICROSOFT_REDIRECT_URI`.
4. Set `GEMINI_API_KEY` before enabling Ask Steve, WhatsApp staff agent, or RAG reindexing.
5. Set `LEMLIST_*`, `WHATSAPP_WEBHOOK_SECRET`, and `MESSENGER_API_TOKEN` only when those integrations are ready.

## First Deploy

```sh
docker compose config
docker compose build web
docker compose up -d postgres web caddy
docker compose logs -f web
```

The web container runs environment validation, migrations, seed data, staff bootstrap, and then starts the server.

## Smoke Tests

Public pages:

```sh
curl -fsS https://stirisk.cloudmonkey.co.za/health
curl -fsS https://stirisk.cloudmonkey.co.za/ready
curl -fsS https://stirisk.cloudmonkey.co.za/about
curl -fsS https://stirisk.cloudmonkey.co.za/services
curl -fsS https://stirisk.cloudmonkey.co.za/case-studies
```

Staff checks:

1. `/staff` redirects anonymous users to `/staff/login`.
2. `/api/auth/microsoft/status` reports the SSO configuration state.
3. Break-glass admin password works only when explicitly configured.
4. Dashboard, CRM, Contacts, Growth, Ask Steve, Projects, Tasks, Billing, Schedule, and Settings load.

Integration checks:

1. Ask Steve returns an approval-first response when `GEMINI_API_KEY` and `N8N_AGENT_TOKEN` are configured.
2. RAG reindex can fetch pending docs and update embeddings.
3. WhatsApp rejects unapproved numbers and queues approved responses when messenger credentials are configured.
4. Lemlist health is green before campaign sync or enrollment is used.

## Rollback And Restart

```sh
docker compose restart web
docker compose logs --tail=200 web
docker compose down
docker compose up -d
```

Database state lives in the `postgres_data` volume. Do not delete volumes during rollback unless the data loss is intentional and approved.
