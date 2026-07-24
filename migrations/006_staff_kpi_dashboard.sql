CREATE TABLE IF NOT EXISTS staff_kpi_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  manager_name text NOT NULL DEFAULT 'Kiril',
  role_summary text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_kpi_objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES staff_kpi_profiles(id) ON DELETE CASCADE,
  objective_key text NOT NULL,
  title text NOT NULL,
  success_measure text NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, objective_key)
);

CREATE TABLE IF NOT EXISTS staff_kpi_pillars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES staff_kpi_profiles(id) ON DELETE CASCADE,
  pillar_key text NOT NULL,
  title text NOT NULL,
  owner_label text NOT NULL DEFAULT 'Vusi',
  description text NOT NULL DEFAULT '',
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, pillar_key)
);

CREATE TABLE IF NOT EXISTS staff_kpi_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES staff_kpi_profiles(id) ON DELETE CASCADE,
  pillar_id uuid REFERENCES staff_kpi_pillars(id) ON DELETE SET NULL,
  metric_key text NOT NULL,
  title text NOT NULL,
  target_label text NOT NULL,
  tracking_label text NOT NULL,
  target_value numeric(14,2),
  target_unit text NOT NULL DEFAULT 'count',
  calculation_key text NOT NULL DEFAULT 'manual',
  position integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, metric_key)
);

CREATE TABLE IF NOT EXISTS staff_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES staff_kpi_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  category_key text NOT NULL,
  category_label text NOT NULL,
  activity_label text NOT NULL,
  hours numeric(8,2) NOT NULL DEFAULT 0,
  entry_date date NOT NULL DEFAULT current_date,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_kpi_metrics_profile_id ON staff_kpi_metrics(profile_id);
CREATE INDEX IF NOT EXISTS idx_staff_time_entries_profile_date ON staff_time_entries(profile_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_staff_time_entries_user_date ON staff_time_entries(user_id, entry_date);

INSERT INTO app_users (email, name, role, password_hash, auth_provider)
VALUES (
  'vusi@stirisk.co.za',
  'Vusi',
  'staff',
  'scrypt:disabled:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  'password'
)
ON CONFLICT (email) DO UPDATE SET
  name = COALESCE(NULLIF(app_users.name, ''), EXCLUDED.name),
  role = CASE WHEN app_users.role = 'viewer' THEN 'staff' ELSE app_users.role END,
  updated_at = now();

INSERT INTO staff_kpi_profiles (user_id, manager_name, role_summary, active)
SELECT
  id,
  'Kiril',
  'Revenue development, technical sales, project/service quoting, site visit guidance, onboarding, project/service delivery, partner development, and capability development.',
  true
FROM app_users
WHERE email = 'vusi@stirisk.co.za'
ON CONFLICT (user_id) DO UPDATE SET
  manager_name = EXCLUDED.manager_name,
  role_summary = EXCLUDED.role_summary,
  active = true,
  updated_at = now();

WITH profile AS (
  SELECT skp.id
  FROM staff_kpi_profiles skp
  JOIN app_users u ON u.id = skp.user_id
  WHERE u.email = 'vusi@stirisk.co.za'
),
objective_seed(objective_key, title, success_measure, position) AS (
  VALUES
    ('revenue_growth', 'Increase STI Risk revenue', 'R500k/month minimum revenue with growth toward R1m/month.', 10),
    ('service_installation_capability', 'Build STI Risk service and installation capability', 'Team structure, cost model, vehicle model, and first internal technician structure established.', 20),
    ('partner_ecosystem', 'Build a partner ecosystem', '5 sprinkler partners, 5 insurance partners, and 5 competitor/collaborator partners.', 30),
    ('client_lifetime_value', 'Increase lifetime value of every client', 'Service contracts, NextGrid cross-sell, referrals, and testimonials tracked at the right project moments.', 40),
    ('knowledge_authority', 'Build STI Risk knowledge and market authority', 'Recorded calls, lessons learned, case studies, SOP improvements, and industry expertise database.', 50)
)
INSERT INTO staff_kpi_objectives (profile_id, objective_key, title, success_measure, position)
SELECT profile.id, objective_seed.objective_key, objective_seed.title, objective_seed.success_measure, objective_seed.position
FROM profile CROSS JOIN objective_seed
ON CONFLICT (profile_id, objective_key) DO UPDATE SET
  title = EXCLUDED.title,
  success_measure = EXCLUDED.success_measure,
  position = EXCLUDED.position;

WITH profile AS (
  SELECT skp.id
  FROM staff_kpi_profiles skp
  JOIN app_users u ON u.id = skp.user_id
  WHERE u.email = 'vusi@stirisk.co.za'
),
pillar_seed(pillar_key, title, description, position) AS (
  VALUES
    ('revenue_development', 'Revenue Development', 'New brownfield and greenfield projects, lead conversion, and revenue growth.', 10),
    ('service_delivery', 'Service Delivery', 'Existing client services, maintenance, installations, and after-sales support.', 20),
    ('partner_development', 'Partner Development', 'Agape model, competitor partnerships, and insurance partnerships.', 30),
    ('capability_development', 'Capability Development', 'Internal team, vehicle strategy, training, certifications, and SOPs.', 40)
)
INSERT INTO staff_kpi_pillars (profile_id, pillar_key, title, owner_label, description, position)
SELECT profile.id, pillar_seed.pillar_key, pillar_seed.title, 'Vusi', pillar_seed.description, pillar_seed.position
FROM profile CROSS JOIN pillar_seed
ON CONFLICT (profile_id, pillar_key) DO UPDATE SET
  title = EXCLUDED.title,
  owner_label = EXCLUDED.owner_label,
  description = EXCLUDED.description,
  position = EXCLUDED.position;

WITH profile AS (
  SELECT skp.id
  FROM staff_kpi_profiles skp
  JOIN app_users u ON u.id = skp.user_id
  WHERE u.email = 'vusi@stirisk.co.za'
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
  p.id,
  seed.metric_key,
  seed.title,
  seed.target_label,
  seed.tracking_label,
  seed.target_value,
  seed.target_unit,
  seed.calculation_key,
  seed.position
FROM profile
JOIN (
  VALUES
    ('revenue', 'revenue_development', 'Revenue', 'R500k/month', 'Revenue won, invoiced, and collected.', 500000, 'zar', 'revenue_month', 10),
    ('new_opportunities', 'revenue_development', 'New Opportunities', '10/month', 'New projects and services identified.', 10, 'count', 'new_opportunities_month', 20),
    ('quotations', 'revenue_development', 'Quotations', '20/month', 'Quotes issued, quote value, and win rate.', 20, 'count', 'quotations_month', 30),
    ('partner_development', 'partner_development', 'Partner Development', '15 strategic engagements', 'Sprinkler partners, insurance partners, and competitors/collaborators.', 15, 'count', 'partner_engagements_month', 40),
    ('existing_client_development', 'service_delivery', 'Existing Client Development', '5 client reviews/month', 'Cross-sell, upsell, service, and referral opportunities.', 5, 'count', 'client_reviews_month', 50),
    ('service_delivery', 'service_delivery', 'Service Delivery', 'Track delivery flow', 'Open projects, completed projects, and customer satisfaction.', NULL, 'status', 'service_delivery', 60),
    ('capability_development', 'capability_development', 'Capability Development', 'Track capability build', 'Team structure, vehicle costing, and internal team business case.', NULL, 'status', 'capability_development', 70),
    ('knowledge_capture', 'capability_development', 'Knowledge Capture', 'Track knowledge assets', 'Calls recorded, lessons learned, and SOP improvements.', NULL, 'count', 'knowledge_capture', 80)
) AS seed(metric_key, pillar_key, title, target_label, tracking_label, target_value, target_unit, calculation_key, position)
  ON true
LEFT JOIN staff_kpi_pillars p ON p.profile_id = profile.id AND p.pillar_key = seed.pillar_key
ON CONFLICT (profile_id, metric_key) DO UPDATE SET
  pillar_id = EXCLUDED.pillar_id,
  title = EXCLUDED.title,
  target_label = EXCLUDED.target_label,
  tracking_label = EXCLUDED.tracking_label,
  target_value = EXCLUDED.target_value,
  target_unit = EXCLUDED.target_unit,
  calculation_key = EXCLUDED.calculation_key,
  position = EXCLUDED.position,
  active = true,
  updated_at = now();

WITH profile AS (
  SELECT skp.id AS profile_id, skp.user_id
  FROM staff_kpi_profiles skp
  JOIN app_users u ON u.id = skp.user_id
  WHERE u.email = 'vusi@stirisk.co.za'
),
seed(category_key, category_label, activity_label, hours) AS (
  VALUES
    ('revenue_development', 'Revenue Development', 'Discovery calls, prospect meetings, and lead qualification', 12),
    ('partner_development', 'Partner Development', 'Agape, competitor, and insurance partner discussions', 2),
    ('project_delivery', 'Project Delivery', 'Site visits, project meetings, installations, and after-sales support', 18),
    ('quotations', 'Quotations', 'Costing, supplier engagement, and proposal development', 6),
    ('strategy_management', 'Strategy & Management', 'Internal planning, SOP development, and team coaching', 1),
    ('travel', 'Travel', 'Driving, flights, site travel, tolls, fuel, and trip cost allocation', 11)
)
INSERT INTO staff_time_entries (profile_id, user_id, category_key, category_label, activity_label, hours, entry_date, source)
SELECT profile.profile_id, profile.user_id, seed.category_key, seed.category_label, seed.activity_label, seed.hours, current_date, 'workbook_seed'
FROM profile CROSS JOIN seed
WHERE NOT EXISTS (
  SELECT 1
  FROM staff_time_entries existing
  WHERE existing.profile_id = profile.profile_id
    AND existing.source = 'workbook_seed'
    AND existing.category_key = seed.category_key
);
