-- Strath Agency — Migration 002: Session 2 Build
-- Run this ONCE against the Neon database after migration_001 has been applied.
-- Fresh installs: run schema.sql instead (already includes these changes).
-- Safe to re-run: all statements use IF NOT EXISTS or ON CONFLICT DO NOTHING.

-- ─── TARGET 5: Outreach hook column (Claude-generated opening sentence) ──────

ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS outreach_hook TEXT;

-- ─── TARGET 3: GBP type mismatch column ──────────────────────────────────────
-- True when a prospect was found by keyword search but is NOT in the type=locksmith
-- result set — signals a possible Google Maps miscategorisation.

ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS gbp_type_mismatch BOOLEAN DEFAULT FALSE;

-- ─── Audit error tracking ─────────────────────────────────────────────────────
-- Stores the last error string from the audit cron, if any.
-- Allows retrying failed audits without losing the record.

ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS audit_error TEXT;

-- ─── TARGET 2: Franchise keyword seed rows ────────────────────────────────────
-- FRANCHISE_KEYWORDS were previously hardcoded in scoring.ts.
-- They are now managed here as ignore_name_contains rows in prospect_filters.
-- This lets Tyler add/remove keywords from the DB without a code deploy.

INSERT INTO prospect_filters (filter_type, value, reason, added_by) VALUES
  ('ignore_name_contains', 'HomeServe',        'National franchise / aggregator',  'system'),
  ('ignore_name_contains', 'ERA',              'National franchise / aggregator',  'system'),
  ('ignore_name_contains', 'Yale',             'National franchise / aggregator',  'system'),
  ('ignore_name_contains', 'Avocet',           'National franchise / aggregator',  'system'),
  ('ignore_name_contains', 'Banham',           'National franchise / aggregator',  'system'),
  ('ignore_name_contains', 'Chubb',            'National franchise / aggregator',  'system'),
  ('ignore_name_contains', 'Securitas',        'National franchise / aggregator',  'system'),
  ('ignore_name_contains', 'G4S',             'National franchise / aggregator',  'system'),
  ('ignore_name_contains', 'KeyNest',          'National franchise / aggregator',  'system'),
  ('ignore_name_contains', 'KeySafe',          'National franchise / aggregator',  'system'),
  ('ignore_name_contains', 'Master Locksmiths','Trade association — not a prospect','system'),
  ('ignore_name_contains', 'Locksmiths Association', 'Trade association',         'system'),
  ('ignore_name_contains', 'AA Locksmiths',   'National aggregator brand',         'system'),
  ('ignore_name_contains', 'Mr Locksmith',    'National franchise',                'system'),
  ('ignore_name_contains', 'Fast Locksmith',  'National aggregator brand',         'system'),
  ('ignore_name_contains', 'Capital Locksmiths', 'National chain / aggregator',   'system'),
  ('ignore_name_contains', 'City Locksmith',  'Common aggregator trading name',    'system'),
  ('ignore_name_contains', 'Direct Locksmith','National aggregator brand',         'system'),
  ('ignore_name_contains', 'Locksmith Direct','National aggregator brand',         'system')
ON CONFLICT (filter_type, value) DO NOTHING;

-- ─── Verification queries ─────────────────────────────────────────────────────
-- Run these after migration to confirm everything landed:
--
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'prospects'
--   AND column_name IN ('gbp_type_mismatch', 'audit_error', 'outreach_hook');
--
-- SELECT COUNT(*) FROM prospect_filters;  -- should be 5 (migration_001) + 19 (migration_002) = 24
--
-- SELECT value FROM prospect_filters WHERE filter_type = 'ignore_name_contains' ORDER BY value;
