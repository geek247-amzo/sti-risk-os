-- Vusi Tools is an advisory namespace. It is deliberately independent of the
-- signed-off checklist/inspection model.
CREATE TABLE IF NOT EXISTS vusi_tools_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  standard_code text NOT NULL,
  setting text NOT NULL CHECK (setting IN ('shared', 'industrial', 'server_room', 'corporate')),
  requirement_description text NOT NULL,
  compliant_visual_criteria text NOT NULL,
  noncompliant_visual_criteria text NOT NULL,
  is_red_flag boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vusi_tools_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_visit_id uuid REFERENCES site_visits(id) ON DELETE SET NULL,
  setting text NOT NULL CHECK (setting IN ('shared', 'industrial', 'server_room', 'corporate')),
  performed_by uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vusi_tools_scan_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES vusi_tools_scans(id) ON DELETE CASCADE,
  evidence_file_id uuid REFERENCES evidence_files(id) ON DELETE SET NULL,
  checklist_item_id uuid NOT NULL REFERENCES vusi_tools_checklist_items(id) ON DELETE RESTRICT,
  score text NOT NULL CHECK (score IN ('met', 'not_met', 'unclear')),
  gemini_rationale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scan_id, checklist_item_id)
);

CREATE INDEX IF NOT EXISTS idx_vusi_tools_items_setting
  ON vusi_tools_checklist_items(setting, active, is_red_flag);
CREATE INDEX IF NOT EXISTS idx_vusi_tools_scans_performed_by
  ON vusi_tools_scans(performed_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vusi_tools_results_scan
  ON vusi_tools_scan_results(scan_id, score);

-- Initial advisory visual rules. These are deliberately phrased as observable
-- evidence criteria, not as formal inspection outcomes.
INSERT INTO vusi_tools_checklist_items
  (standard_code, setting, requirement_description, compliant_visual_criteria, noncompliant_visual_criteria, is_red_flag)
VALUES
  ('SANS 10400-T 4.37.1', 'shared', 'Escape routes and exits remain visibly unobstructed.', 'Doorways, corridors and exit paths are visibly clear and usable.', 'Stored goods, furniture, equipment or locked gates visibly obstruct an escape path or exit.', true),
  ('SANS 10400-T 4.37.2', 'shared', 'Emergency exits are identifiable and open in the direction of escape where applicable.', 'Exit door is identifiable, reachable and appears openable without a key from the escape side.', 'Exit is hidden, blocked, locked or has no visible identification where one is needed.', true),
  ('SANS 10400-T 4.37.3', 'shared', 'Fire extinguishers are visible, accessible and appropriately mounted or positioned.', 'Extinguisher is visible, reachable, upright/mounted and not surrounded by storage.', 'Extinguisher is missing, blocked, discharged-looking, damaged or difficult to reach.', true),
  ('SANS 10400-T 4.37.4', 'shared', 'Fire safety signage is visible at relevant exits and firefighting equipment.', 'Signs are visible, legible and placed where they can guide occupants to exits or equipment.', 'Required-looking signs are absent, obscured, damaged, illegible or misleading.', false),
  ('SANS 10400-T 4.37.5', 'shared', 'Combustible storage is kept away from ignition sources and escape routes.', 'Storage appears orderly, limited and separated from hot work, electrical equipment and exits.', 'Combustibles are piled near ignition sources, electrical equipment, heaters or escape routes.', true),
  ('SANS 10400-T 4.37.6', 'shared', 'Smoke detectors are present where visible and not visibly obstructed or damaged.', 'Detector is visible on the ceiling, unobstructed and appears intact.', 'Detector is missing where expected, covered, painted over, damaged or visibly obstructed.', true),
  ('SANS 10400-T 4.37.7', 'industrial', 'Industrial work areas keep fire loads and hazardous materials controlled.', 'Flammable/combustible materials appear labelled, contained and separated from ignition sources.', 'Containers are open/unlabelled, leaking, poorly stored or placed beside ignition sources.', true),
  ('SANS 10400-T 4.37.8', 'industrial', 'Firefighting access and equipment remain clear in the work area.', 'Access lanes, hose reels/extinguishers and equipment approaches are visibly clear.', 'Plant, pallets or stock visibly prevent access to firefighting equipment or emergency routes.', true),
  ('SANS 10400-T 4.37.9', 'server_room', 'Server-room fire detection and room access appear unobstructed.', 'Ceiling detectors, room access and equipment clearances are visibly unobstructed.', 'Detectors are covered/obstructed, access is blocked, or equipment is tightly packed against hazards.', true),
  ('SANS 10400-T 4.37.10', 'server_room', 'Server-room cable and power arrangements show no obvious fire hazard.', 'Cables are orderly, intact and free of visible overheating, exposed conductors or overloaded adaptors.', 'Exposed/damaged cables, scorch marks, tangled temporary power or overloaded adaptors are visible.', true),
  ('SANS 10400-T 4.37.11', 'corporate', 'Public and office circulation routes remain clear to exits.', 'Desks, cabinets and stored items leave a clear route to visible exits.', 'Furniture, boxes or stored items narrow or block the route to an exit.', true),
  ('SANS 10400-T 4.37.12', 'corporate', 'Kitchen and office ignition sources show no obvious unsafe storage around them.', 'Paper, packaging and other combustibles are visibly separated from appliances and heat sources.', 'Combustible material is visibly stacked against/over appliances or heat sources.', true)
ON CONFLICT DO NOTHING;
