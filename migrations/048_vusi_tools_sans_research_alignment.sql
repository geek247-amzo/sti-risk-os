-- Align the initial advisory seed with the supplied SANS visual-research report.
-- This remains a Vusi Tools-only taxonomy and does not alter formal inspections.
UPDATE vusi_tools_checklist_items
SET active = false
WHERE standard_code LIKE 'SANS %';

CREATE UNIQUE INDEX IF NOT EXISTS idx_vusi_tools_items_unique_rule
  ON vusi_tools_checklist_items(standard_code, setting, requirement_description);

INSERT INTO vusi_tools_checklist_items
  (standard_code, setting, requirement_description, compliant_visual_criteria, noncompliant_visual_criteria, is_red_flag)
VALUES
  ('SANS 10105-1 / 10400-T 4.37', 'shared', 'Portable fire extinguisher mounting', 'Extinguisher is mounted at 980mm AFFL on a wooden backing board.', 'Extinguisher is sitting directly on the floor or mounted too high.', true),
  ('SANS 1186-5', 'shared', 'Symbolic safety signage', 'Sign is photoluminescent, at least 190mm x 190mm, and securely screw-fixed with no adhesive-only mounting.', 'Sign is faded, paper-based, dangling, adhesive-only, or smaller than 150mm in a commercial area.', true),
  ('SANS 10139', 'shared', 'Manual Call Point (Break Glass) height', 'Centre of the element is positioned 1.4m (±200mm) from floor level and is accessible.', 'Call point is at shoulder height outside the allowed range or blocked by furniture.', false),
  ('SANS 10139', 'shared', 'Visual Alarm (Beacon) height', 'Beacon is mounted at a minimum height of 2.1m and is visible.', 'Beacon is below door-frame level or obscured by a ceiling drop.', false),
  ('SANS 10400-T 4.16.5', 'shared', 'Escape route clear width', 'Path of travel is completely unobstructed with a minimum clear width typically between 1.0m and 1.5m.', 'Stock, boxes, office equipment or other items are stored in corridors or near exit doors.', true),
  ('SANS 10400-T 4.10.4', 'shared', 'Fire door self-closing', 'Fire door has a visible self-closing or automatic-closing mechanism.', 'Fire door is propped open with a wedge or its closing arm is disconnected or missing.', true),
  ('SANS 10139', 'shared', 'Detector obstruction clearance', 'Detector is visibly at least 500mm from walls, partitions and light fittings.', 'Detector is within 500mm of a wall, partition or light fitting, or is visibly obstructed.', true),
  ('SANS 10400-T 4.37.1', 'industrial', 'Extinguisher density (D1/D2)', 'At least one 9kg Powder or 10kg CO2 extinguisher is visibly provided per 100m².', 'There are visible gaps in coverage, such as only one small extinguisher for a large workshop bay.', true),
  ('SANS 10400-T 4.35.4', 'industrial', 'External/Internal Hydrant spacing', 'No point in the building appears further than 90m from a hydrant and hydrant access is clear.', 'Hydrants are visibly blocked by outdoor pallets, stock or other obstructions.', true),
  ('SANS 10400-W 4.4', 'industrial', 'Hydrant/Isolator identification', 'Isolating valves and hydrants are clearly marked, visibly red where required, and unobstructed.', 'Hydrants or isolating valves are painted over, unmarked, missing standard red identification or blocked.', true),
  ('SANS 10400-T 4.50', 'industrial', 'Parking/Garage Floor Level', 'Garage floor is at least 10mm lower than the threshold of adjoining rooms to prevent flammable-liquid flow.', 'Garage floor is visibly flush with or higher than the adjoining internal office floor.', false),
  ('SANS 10139', 'industrial', 'Detector spacing in large zones', 'Large zones visibly have intermediate detection/zone indication such that search travel distance to the fire source is no more than 60m from the zone entrance.', 'Large open warehouses visibly lack intermediate detectors or zone indicators.', true),
  ('SANS 246 / 14520-1', 'server_room', 'Gaseous suppression signage', 'Warning signs reading “DANGER: Multiple power supplies” and “DO NOT USE WATER” are visible near electronic racks.', 'Required warning signage is missing near electronic racks.', true),
  ('SANS 10139', 'server_room', 'Detector placement vs. Airflow', 'Detectors are visibly fitted no less than 1m from air-conditioning inlets or vents.', 'Smoke detector is directly in the path of a high-velocity AC discharge.', true),
  ('SANS 10400-T 4.36.2', 'server_room', 'Under-floor/Ceiling Void coverage', 'Voids exceeding 800mm in height visibly have independent sprinkler or detection coverage.', 'Deep raised floors or ceiling voids show cabling but no internal detection heads.', true),
  ('SANS 10139', 'server_room', 'Detector sensing depth', 'Smoke sensing element is visibly between 25mm and 600mm below the ceiling.', 'Smoke detector is recessed into a high decorative bulkhead or lost in a deep void.', true),
  ('SANS 10400-T 4.11', 'server_room', 'Raised access flooring', 'Suspended floor is no more than 50mm above a non-combustible slab, unless the suspended floor is non-combustible.', 'Visible timber or other combustible support structures are present in the floor void.', true),
  ('SANS 10400-T 4.37.1', 'corporate', 'Extinguisher density (G1)', 'At least one 4.5kg Powder or 5kg CO2 extinguisher is visibly provided per 200m².', 'Office area visibly has only one extinguisher at the far end of the floor or otherwise lacks coverage.', true),
  ('SANS 10400-T 4.30.1', 'corporate', 'Emergency lighting', 'Artificial emergency lighting is visibly provided above the final exit door and along escape routes.', 'Exit path visibly has no emergency luminaire pack or equivalent emergency lighting.', true),
  ('SANS 10400-T 4.29.4', 'corporate', 'Exit door marking', 'Illuminated symbolic safety sign is displayed directly over every visible exit door.', 'Signage is placed on a side wall away from the exit door frame or is not visible.', true),
  ('SANS 10400-T 4.16.7', 'corporate', 'Dead-end corridors', 'Visible dead-end corridor travel in one direction only does not exceed 10m.', 'Long office hallway visibly has only one exit point at the end and appears longer than 10m.', true),
  ('SANS 10139', 'corporate', 'Obstruction clearance', 'Detectors are visibly not mounted within 500mm of a wall, partition or light fitting.', 'Detector is visibly mounted flush against a shelf, wall, light fitting or small cubicle partition.', true)
ON CONFLICT (standard_code, setting, requirement_description) DO UPDATE SET
  compliant_visual_criteria = EXCLUDED.compliant_visual_criteria,
  noncompliant_visual_criteria = EXCLUDED.noncompliant_visual_criteria,
  is_red_flag = EXCLUDED.is_red_flag,
  active = true;
