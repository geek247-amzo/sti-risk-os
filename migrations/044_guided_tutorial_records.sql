-- G6: mark records created by the cross-page guided transaction walkthrough.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS is_tutorial boolean NOT NULL DEFAULT false;
ALTER TABLE client_pos ADD COLUMN IF NOT EXISTS is_tutorial boolean NOT NULL DEFAULT false;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS is_tutorial boolean NOT NULL DEFAULT false;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS is_tutorial boolean NOT NULL DEFAULT false;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_tutorial boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_quotes_is_tutorial ON quotes(is_tutorial);
CREATE INDEX IF NOT EXISTS idx_client_pos_is_tutorial ON client_pos(is_tutorial);
CREATE INDEX IF NOT EXISTS idx_sales_orders_is_tutorial ON sales_orders(is_tutorial);
CREATE INDEX IF NOT EXISTS idx_work_items_is_tutorial ON work_items(is_tutorial);
CREATE INDEX IF NOT EXISTS idx_invoices_is_tutorial ON invoices(is_tutorial);
