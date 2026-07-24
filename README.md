# STI Risk Platform

This package contains the STI Risk web app, database migrations, seed scripts, Docker setup, Caddy reverse proxy, and n8n workflow exports.

## Requirements

- Docker Engine with Docker Compose
- A DNS record for `SITE_DOMAIN` pointing to the server if using the included Caddy HTTPS setup
- Ports `80` and `443` open on the server

## First Server Setup

1. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and set production values:

   ```bash
   SITE_DOMAIN=your-domain.example.com
   PUBLIC_BASE_URL=https://your-domain.example.com
   MICROSOFT_REDIRECT_URI=https://your-domain.example.com/api/auth/microsoft/callback
   POSTGRES_PASSWORD=<strong unique password>
   SESSION_SECRET=<strong unique secret>
   WEBHOOK_SECRET=<strong unique secret>
   N8N_AGENT_TOKEN=<strong unique token>
   INITIAL_ADMIN_PASSWORD=<strong admin password>
   ```

3. Optional but recommended: set fixed staff passwords in `.env` before first boot:

   ```bash
   MELLISSA_PASSWORD=<password>
   VUSI_PASSWORD=<password>
   GEORGE_PASSWORD=<password>
   KIRIL_PASSWORD=<password>
   ```

   `STEVE_PASSWORD` can be left blank because Steve is configured as the agent profile. In production, generated staff passwords are not printed unless `PRINT_GENERATED_PASSWORDS=true` is set.

4. Start the platform:

   ```bash
   docker compose up -d --build
   ```

5. Watch startup logs:

   ```bash
   docker compose logs -f homepage
   ```

The homepage container startup command runs:

```bash
npm run validate:env
npm run db:migrate
npm run db:seed
npm run db:ensure-staff
npm run start
```

## Database Migrations And Seeding

Migrations live in `migrations/` and run in filename order through `scripts/migrate.mjs`. Applied migrations are tracked in the `schema_migrations` table.

Seed scripts:

- `npm run db:seed` creates default pipeline stages, task stages, and the initial admin account from `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_NAME`, and `INITIAL_ADMIN_PASSWORD`.
- `npm run db:ensure-staff` creates or updates staff users for Mellissa, Vusi, George, Kiril, and the Steve agent profile.
- `npm run db:import:pipedrive` imports Pipedrive data when the required input/configuration is available.

To rerun migrations/seeding inside Docker:

```bash
docker compose exec homepage npm run db:migrate
docker compose exec homepage npm run db:seed
docker compose exec homepage npm run db:ensure-staff
```

The seed scripts are written as upserts, so rerunning them is expected during deployment.

## Local Development

For local development without Docker:

```bash
npm ci
cp .env.example .env
npm run validate:env
npm run db:migrate
npm run db:seed
npm run db:ensure-staff
npm run dev
```

Set `DATABASE_URL` in `.env` to a reachable PostgreSQL database. The production compose file uses the `pgvector/pgvector:pg16` image.

## Backups

Before moving or replacing a production server, dump the database and preserve uploaded files:

```bash
docker compose exec postgres pg_dump -U sti -d sti_risk > sti_risk_backup.sql
docker run --rm -v sti-risk-main_uploads:/uploads -v "$PWD":/backup alpine tar -czf /backup/uploads.tar.gz /uploads
```

Restore on a new server after `docker compose up -d postgres`:

```bash
docker compose exec -T postgres psql -U sti -d sti_risk < sti_risk_backup.sql
docker run --rm -v sti-risk-main_uploads:/uploads -v "$PWD":/backup alpine tar -xzf /backup/uploads.tar.gz -C /
```

## Included Integrations

- Microsoft SSO environment hooks
- Gemini/Hermes agent environment hooks
- n8n workflow exports under `n8n/workflows/`
- WhatsApp and messenger webhook environment hooks
- Lemlist outreach webhook/API environment hooks
