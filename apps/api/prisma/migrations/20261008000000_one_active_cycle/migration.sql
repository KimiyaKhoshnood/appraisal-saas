-- At most one ACTIVE evaluation cycle per tenant, enforced by the database: two admins
-- activating different draft cycles concurrently cannot both succeed (found in review).
CREATE UNIQUE INDEX evaluation_cycle_one_active ON evaluation_cycle (tenant_id) WHERE status = 'ACTIVE';
