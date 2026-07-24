CREATE TABLE IF NOT EXISTS taxonomies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taxonomy_type text NOT NULL CHECK (taxonomy_type IN ('area', 'technology')),
  parent_id uuid REFERENCES taxonomies(id) ON DELETE RESTRICT,
  standard_code text NOT NULL,
  standard_name text NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (taxonomy_type, standard_code)
);

ALTER TABLE areas
  ADD COLUMN IF NOT EXISTS taxonomy_id uuid REFERENCES taxonomies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_local_name text,
  ADD COLUMN IF NOT EXISTS custom_area_text text;

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS taxonomy_id uuid REFERENCES taxonomies(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS area_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id uuid NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  site_visit_id uuid NOT NULL REFERENCES site_visits(id) ON DELETE CASCADE,
  beam_count integer CHECK (beam_count IS NULL OR beam_count >= 0),
  column_count integer CHECK (column_count IS NULL OR column_count >= 0),
  hole_count integer CHECK (hole_count IS NULL OR hole_count >= 0),
  hole_size numeric(12,3) CHECK (hole_size IS NULL OR hole_size >= 0),
  hole_size_unit text,
  leakage_percentage numeric(6,3) CHECK (leakage_percentage IS NULL OR leakage_percentage BETWEEN 0 AND 100),
  beam_drop_distance numeric(12,3) CHECK (beam_drop_distance IS NULL OR beam_drop_distance >= 0),
  beam_drop_distance_unit text,
  measurement_notes text,
  evidence_file_id uuid REFERENCES evidence_files(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (area_id, site_visit_id)
);

CREATE INDEX IF NOT EXISTS idx_taxonomies_lookup
  ON taxonomies(taxonomy_type, active, parent_id, standard_name);
CREATE INDEX IF NOT EXISTS idx_areas_taxonomy
  ON areas(taxonomy_id);
CREATE INDEX IF NOT EXISTS idx_assets_taxonomy
  ON assets(taxonomy_id);
CREATE INDEX IF NOT EXISTS idx_area_measurements_visit
  ON area_measurements(site_visit_id, area_id);

INSERT INTO taxonomies (taxonomy_type, standard_code, standard_name)
VALUES
  ('area', 'transformer_room', 'Transformer room'),
  ('area', 'mcc_room', 'MCC room'),
  ('area', 'plant_room', 'Plant room'),
  ('area', 'ht_hv_room', 'HT/HV room'),
  ('area', 'mv_room', 'MV room'),
  ('area', 'battery_room', 'Battery room'),
  ('area', 'factory_floor', 'Factory floor')
ON CONFLICT (taxonomy_type, standard_code) DO UPDATE SET
  standard_name = EXCLUDED.standard_name,
  updated_at = now();

INSERT INTO taxonomies (taxonomy_type, standard_code, standard_name)
VALUES
  ('technology', 'sprinkler', 'Sprinkler'),
  ('technology', 'wet_chemical_dafo', 'Wet chemical (DAFO)'),
  ('technology', 'powder', 'Powder'),
  ('technology', 'clean_agent', 'Clean agent')
ON CONFLICT (taxonomy_type, standard_code) DO UPDATE SET
  standard_name = EXCLUDED.standard_name,
  updated_at = now();

INSERT INTO taxonomies (taxonomy_type, parent_id, standard_code, standard_name)
SELECT 'technology', parent.id, child.standard_code, child.standard_name
FROM taxonomies parent
JOIN (VALUES
  ('aerosol', 'Aerosol'),
  ('co2', 'CO2'),
  ('water_mist', 'Water mist'),
  ('foam', 'Foam'),
  ('in_cabinet', 'In-cabinet')
) AS child(standard_code, standard_name)
  ON true
WHERE parent.taxonomy_type = 'technology' AND parent.standard_code = 'clean_agent'
ON CONFLICT (taxonomy_type, standard_code) DO UPDATE SET
  parent_id = EXCLUDED.parent_id,
  standard_name = EXCLUDED.standard_name,
  updated_at = now();

-- Non-destructive best-effort mapping. Existing free-text values are retained.
UPDATE areas a
SET taxonomy_id = t.id, updated_at = now()
FROM taxonomies t
WHERE t.taxonomy_type = 'area'
  AND t.active
  AND a.taxonomy_id IS NULL
  AND lower(trim(a.area_type)) = lower(t.standard_name);

UPDATE assets a
SET taxonomy_id = t.id, updated_at = now()
FROM taxonomies t
WHERE t.taxonomy_type = 'technology'
  AND t.active
  AND a.taxonomy_id IS NULL
  AND (
    lower(trim(a.asset_type)) = lower(t.standard_name)
    OR lower(trim(COALESCE(a.system_family, ''))) = lower(t.standard_name)
  );
