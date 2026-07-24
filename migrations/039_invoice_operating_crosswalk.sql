ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS client_po_id uuid REFERENCES client_pos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sales_order_id uuid REFERENCES sales_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS work_item_id uuid REFERENCES work_items(id) ON DELETE SET NULL;

-- Backfill only unambiguous project-level relationships. Ambiguous legacy records remain
-- visible in the payment-release view and must be linked deliberately by staff.
UPDATE invoices i
SET work_item_id = matches.id
FROM (
  SELECT p.id AS project_id, (array_agg(wi.id ORDER BY wi.id))[1] AS id
  FROM projects p
  JOIN work_items wi ON wi.project_id = p.id
  GROUP BY p.id
  HAVING count(*) = 1
) matches
WHERE i.work_item_id IS NULL
  AND i.project_id = matches.project_id;

UPDATE invoices i
SET client_po_id = matches.id
FROM (
  SELECT p.id AS project_id, (array_agg(cp.id ORDER BY cp.id))[1] AS id
  FROM projects p
  JOIN client_pos cp ON cp.project_id = p.id
  GROUP BY p.id
  HAVING count(*) = 1
) matches
WHERE i.client_po_id IS NULL
  AND i.project_id = matches.project_id;

UPDATE invoices i
SET sales_order_id = matches.id
FROM (
  SELECT p.id AS project_id, (array_agg(so.id ORDER BY so.id))[1] AS id
  FROM projects p
  JOIN sales_orders so ON so.project_id = p.id
  GROUP BY p.id
  HAVING count(*) = 1
) matches
WHERE i.sales_order_id IS NULL
  AND i.project_id = matches.project_id;

CREATE INDEX IF NOT EXISTS idx_invoices_client_po_id ON invoices(client_po_id);
CREATE INDEX IF NOT EXISTS idx_invoices_sales_order_id ON invoices(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_work_item_id ON invoices(work_item_id);
