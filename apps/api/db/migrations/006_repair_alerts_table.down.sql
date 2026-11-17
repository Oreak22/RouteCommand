-- The canonical alerts table belongs to migration 001. This migration only
-- repairs databases that drifted from that baseline, so rollback preserves
-- the table expected by migration 001 and the application.
SELECT 1;
