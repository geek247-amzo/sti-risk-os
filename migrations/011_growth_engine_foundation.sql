ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lifecycle_stage text NOT NULL DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS persona text,
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS consent_status text,
  ADD COLUMN IF NOT EXISTS consent_basis text,
  ADD COLUMN IF NOT EXISTS consent_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bounce_status text,
  ADD COLUMN IF NOT EXISTS last_contacted_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_meaningful_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_follow_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS lemlist_lead_id text;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS account_type text,
  ADD COLUMN IF NOT EXISTS account_status text,
  ADD COLUMN IF NOT EXISTS is_partner boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_client boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_prospect boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS account_health text,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS campaign_source text,
  ADD COLUMN IF NOT EXISTS probability numeric(5,2),
  ADD COLUMN IF NOT EXISTS expected_close_date date,
  ADD COLUMN IF NOT EXISTS lost_reason text,
  ADD COLUMN IF NOT EXISTS won_at timestamptz,
  ADD COLUMN IF NOT EXISTS lost_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_activity_at timestamptz;

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS lemlist_campaign_id text,
  ADD COLUMN IF NOT EXISTS lemlist_lead_id text,
  ADD COLUMN IF NOT EXISTS lemlist_event_id uuid;

ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS lemlist_campaign_id text,
  ADD COLUMN IF NOT EXISTS lemlist_lead_id text,
  ADD COLUMN IF NOT EXISTS lemlist_event_id uuid;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS lemlist_campaign_id text,
  ADD COLUMN IF NOT EXISTS risk_flag text,
  ADD COLUMN IF NOT EXISTS steve_recommendation_id uuid REFERENCES ai_recommendations(id) ON DELETE SET NULL;

ALTER TABLE ai_recommendations
  ADD COLUMN IF NOT EXISTS lemlist_campaign_id text,
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS outcome_at timestamptz;

CREATE TABLE IF NOT EXISTS lemlist_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lemlist_campaign_id text UNIQUE NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'unknown',
  purpose text NOT NULL DEFAULT 'growth',
  segment text,
  owner_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  default_task_owner_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  metrics_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lemlist_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lemlist_event_id text,
  idempotency_key text UNIQUE NOT NULL,
  event_type text NOT NULL,
  lemlist_campaign_id text,
  lemlist_lead_id text,
  lead_email citext,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed')),
  error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lemlist_lead_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES lemlist_campaigns(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  lemlist_lead_id text,
  email citext NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  enrollment_source text NOT NULL DEFAULT 'staff',
  approved_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  validation_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_event_id uuid REFERENCES lemlist_events(id) ON DELETE SET NULL,
  last_event_type text,
  last_event_at timestamptz,
  replied_at timestamptz,
  interested_at timestamptz,
  meeting_booked_at timestamptz,
  bounced_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lemlist_lead_links_campaign_contact
  ON lemlist_lead_links(campaign_id, contact_id)
  WHERE contact_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lemlist_lead_links_campaign_email
  ON lemlist_lead_links(campaign_id, email);

CREATE TABLE IF NOT EXISTS crm_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suppression_type text NOT NULL CHECK (suppression_type IN ('email', 'domain', 'contact')),
  value citext NOT NULL,
  reason text NOT NULL CHECK (reason IN ('unsubscribe', 'hard_bounce', 'do_not_contact', 'complaint', 'manual_block')),
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'manual',
  source_event_id uuid REFERENCES lemlist_events(id) ON DELETE SET NULL,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (suppression_type, value, reason)
);

CREATE TABLE IF NOT EXISTS integration_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration text NOT NULL,
  operation text NOT NULL,
  direction text NOT NULL DEFAULT 'outbound',
  status text NOT NULL,
  entity_type text,
  entity_id uuid,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  response jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS crm_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  view_key text UNIQUE NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  entity_type text NOT NULL DEFAULT 'contact',
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lemlist_events_campaign ON lemlist_events(lemlist_campaign_id);
CREATE INDEX IF NOT EXISTS idx_lemlist_events_lead ON lemlist_events(lemlist_lead_id);
CREATE INDEX IF NOT EXISTS idx_lemlist_events_contact ON lemlist_events(contact_id);
CREATE INDEX IF NOT EXISTS idx_lemlist_lead_links_status ON lemlist_lead_links(status);
CREATE INDEX IF NOT EXISTS idx_crm_suppressions_value ON crm_suppressions(value);
CREATE INDEX IF NOT EXISTS idx_integration_sync_log_integration ON integration_sync_log(integration, started_at DESC);

INSERT INTO crm_saved_views (view_key, name, description, entity_type, filters)
VALUES
  ('quote_followups', 'Quote follow-ups', 'Open quote or proposal deals needing follow-up.', 'deal', '{"segment":"quote_followups"}'::jsonb),
  ('dormant_clients', 'Dormant clients', 'Client accounts without recent meaningful activity.', 'organization', '{"segment":"dormant_clients"}'::jsonb),
  ('partner_prospects', 'Partner prospects', 'Prospective partner accounts and contacts.', 'organization', '{"segment":"partner_prospects"}'::jsonb),
  ('cold_prospects', 'Cold prospects', 'Prospects eligible for cold outbound review.', 'contact', '{"segment":"cold_prospects"}'::jsonb),
  ('public_lead_nurture', 'Public lead nurture', 'Public lead contacts that need nurture.', 'contact', '{"segment":"public_lead_nurture"}'::jsonb),
  ('active_campaign_contacts', 'Active campaign contacts', 'Contacts currently active in outbound campaigns.', 'contact', '{"segment":"active_campaign_contacts"}'::jsonb),
  ('replied_not_followed_up', 'Replied not followed up', 'Campaign replies with no completed follow-up task.', 'contact', '{"segment":"replied_not_followed_up"}'::jsonb),
  ('bounced', 'Bounced', 'Contacts with hard bounce events.', 'contact', '{"segment":"bounced"}'::jsonb),
  ('unsubscribed', 'Unsubscribed', 'Contacts suppressed by unsubscribe.', 'contact', '{"segment":"unsubscribed"}'::jsonb)
ON CONFLICT (view_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  entity_type = EXCLUDED.entity_type,
  filters = EXCLUDED.filters,
  updated_at = now();

WITH profile AS (
  SELECT skp.id
  FROM staff_kpi_profiles skp
  JOIN app_users u ON u.id = skp.user_id
  WHERE u.email = 'vusi@stirisk.co.za'
),
pillar AS (
  SELECT p.id, p.profile_id
  FROM staff_kpi_pillars p
  JOIN profile ON profile.id = p.profile_id
  WHERE p.pillar_key = 'revenue_development'
),
growth_metric_seed(metric_key, title, target_label, tracking_label, target_value, target_unit, calculation_key, position) AS (
  VALUES
    ('outbound_created_opportunities', 'Outbound-created Opportunities', 'Track monthly', 'Deals created from lemlist and campaign-sourced outreach.', NULL::numeric, 'count', 'outbound_created_opportunities', 90),
    ('quote_followups_completed', 'Quote Follow-ups Completed', 'Track weekly', 'Quote follow-up work completed from growth views and tasks.', NULL::numeric, 'count', 'quote_followups_completed', 100),
    ('partner_prospects_contacted', 'Partner Prospects Contacted', 'Track monthly', 'Partner prospects contacted through campaigns or CRM activity.', NULL::numeric, 'count', 'partner_prospects_contacted', 110),
    ('partner_meetings', 'Partner Meetings', 'Track monthly', 'Partner meetings booked from outreach and follow-up work.', NULL::numeric, 'count', 'partner_meetings', 120),
    ('campaign_learnings', 'Campaign Learnings', 'Track monthly', 'Campaign insights, reply themes, and Steve recommendations captured.', NULL::numeric, 'count', 'campaign_learnings', 130),
    ('followup_task_completion', 'Follow-up Task Completion', 'Track weekly', 'Campaign and quote follow-up tasks completed.', NULL::numeric, 'percent', 'followup_task_completion', 140)
)
INSERT INTO staff_kpi_metrics (
  profile_id,
  pillar_id,
  metric_key,
  title,
  target_label,
  tracking_label,
  target_value,
  target_unit,
  calculation_key,
  position
)
SELECT
  profile.id,
  pillar.id,
  seed.metric_key,
  seed.title,
  seed.target_label,
  seed.tracking_label,
  seed.target_value,
  seed.target_unit,
  seed.calculation_key,
  seed.position
FROM profile
LEFT JOIN pillar ON pillar.profile_id = profile.id
CROSS JOIN growth_metric_seed seed
ON CONFLICT (profile_id, metric_key) DO UPDATE SET
  pillar_id = EXCLUDED.pillar_id,
  title = EXCLUDED.title,
  target_label = EXCLUDED.target_label,
  tracking_label = EXCLUDED.tracking_label,
  target_unit = EXCLUDED.target_unit,
  calculation_key = EXCLUDED.calculation_key,
  position = EXCLUDED.position,
  active = true,
  updated_at = now();
