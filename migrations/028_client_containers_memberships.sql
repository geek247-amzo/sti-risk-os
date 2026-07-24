CREATE TABLE IF NOT EXISTS containers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'archived')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS container_id uuid REFERENCES containers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE job_cards
  ADD COLUMN IF NOT EXISTS parent_job_card_id uuid REFERENCES job_cards(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS portfolio_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS portfolio_group_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_group_id uuid NOT NULL REFERENCES portfolio_groups(id) ON DELETE CASCADE,
  user_id uuid REFERENCES app_users(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(user_id, contact_id) = 1),
  UNIQUE (portfolio_group_id, user_id),
  UNIQUE (portfolio_group_id, contact_id)
);

CREATE TABLE IF NOT EXISTS client_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_label text NOT NULL,
  access_tier text NOT NULL
    CHECK (access_tier IN ('owner', 'portfolio_manager', 'field')),
  seniority text NOT NULL DEFAULT 'non_executive'
    CHECK (seniority IN ('executive', 'non_executive')),
  can_view_financials boolean NOT NULL DEFAULT false,
  can_view_other_portfolios boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_containers_organization
  ON containers(organization_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_container
  ON projects(container_id, parent_project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_parent
  ON projects(parent_project_id);
CREATE INDEX IF NOT EXISTS idx_job_cards_parent
  ON job_cards(parent_job_card_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_groups_organization
  ON portfolio_groups(organization_id, name);
CREATE INDEX IF NOT EXISTS idx_portfolio_group_memberships_group
  ON portfolio_group_memberships(portfolio_group_id);
CREATE INDEX IF NOT EXISTS idx_client_memberships_organization
  ON client_memberships(organization_id, access_tier, seniority);
CREATE INDEX IF NOT EXISTS idx_client_memberships_user
  ON client_memberships(user_id, organization_id);
