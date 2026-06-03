-- Strath Agency — Migration 003: Fix Missing Columns
-- Run this in Neon console (strath-agency-db → SQL Editor).
-- Safe to re-run: all statements use IF NOT EXISTS.
--
-- Why this exists:
--   The Neon DB was initialised with an earlier version of schema.sql.
--   Some column names changed between versions (e.g. has_mobile → mobile_optimised).
--   This migration adds every column the current code expects, using both old
--   and new names so either code version works without errors.

-- ── Audit columns (current code uses these names) ────────────────────────────

ALTER TABLE prospects ADD COLUMN IF NOT EXISTS has_schema        BOOLEAN;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS has_title_tag     BOOLEAN;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS title_tag_quality TEXT;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS mobile_optimised  BOOLEAN;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS has_h1            BOOLEAN;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS has_faq           BOOLEAN;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS agency_watermark  TEXT;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS nearest_competitor TEXT;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS observation_1     TEXT;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS observation_2     TEXT;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS outreach_hook     TEXT;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS audit_error       TEXT;

-- ── Older code compatibility (deployed version may use these names) ───────────

ALTER TABLE prospects ADD COLUMN IF NOT EXISTS has_mobile        BOOLEAN;

-- Keep has_mobile in sync with mobile_optimised via a rule.
-- If has_mobile is set and mobile_optimised is null, copy it across.
-- This is a one-time backfill — not a trigger.
UPDATE prospects
  SET mobile_optimised = has_mobile
  WHERE has_mobile IS NOT NULL AND mobile_optimised IS NULL;

-- ── Session 1 columns (may be missing if migration_001 wasn't run) ───────────

ALTER TABLE prospects   ADD COLUMN IF NOT EXISTS raw_score             INTEGER;
ALTER TABLE prospects   ADD COLUMN IF NOT EXISTS duplicate_of_place_id TEXT;
ALTER TABLE scout_runs  ADD COLUMN IF NOT EXISTS search_keyword        TEXT NOT NULL DEFAULT 'locksmith';
ALTER TABLE scout_runs  ADD COLUMN IF NOT EXISTS prospects_suppressed  INTEGER DEFAULT 0;

-- ── Session 2 columns (may be missing if migration_002 wasn't run) ───────────

ALTER TABLE prospects ADD COLUMN IF NOT EXISTS gbp_type_mismatch BOOLEAN DEFAULT FALSE;

-- ── Report tracking columns ───────────────────────────────────────────────────

ALTER TABLE prospects ADD COLUMN IF NOT EXISTS report_first_opened_at  TIMESTAMPTZ;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS report_last_opened_at   TIMESTAMPTZ;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS report_open_count       INTEGER DEFAULT 0;

-- ── Prospect filters table (may not exist if schema was old) ─────────────────

CREATE TABLE IF NOT EXISTS prospect_filters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filter_type TEXT NOT NULL,
  value       TEXT NOT NULL,
  reason      TEXT,
  added_by    TEXT NOT NULL DEFAULT 'system',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(filter_type, value)
);

-- Re-seed all ignore rules (ON CONFLICT DO NOTHING is safe)
INSERT INTO prospect_filters (filter_type, value, reason, added_by) VALUES
  ('ignore_name_contains', 'Timpson',                'National chain',                          'system'),
  ('ignore_name_contains', 'Halfords',               'National chain',                          'system'),
  ('ignore_name_contains', 'Screwfix',               'National chain',                          'system'),
  ('ignore_name_contains', 'Home Locksmith',         'Residential-only, not our ICP',           'system'),
  ('ignore_name_contains', 'Locksmith Training',     'Training company not a service business', 'system'),
  ('ignore_name_contains', 'HomeServe',              'National franchise / aggregator',         'system'),
  ('ignore_name_contains', 'ERA',                    'National franchise / aggregator',         'system'),
  ('ignore_name_contains', 'Yale',                   'National franchise / aggregator',         'system'),
  ('ignore_name_contains', 'Avocet',                 'National franchise / aggregator',         'system'),
  ('ignore_name_contains', 'Banham',                 'National franchise / aggregator',         'system'),
  ('ignore_name_contains', 'Chubb',                  'National franchise / aggregator',         'system'),
  ('ignore_name_contains', 'Securitas',              'National franchise / aggregator',         'system'),
  ('ignore_name_contains', 'G4S',                    'National franchise / aggregator',         'system'),
  ('ignore_name_contains', 'KeyNest',                'National franchise / aggregator',         'system'),
  ('ignore_name_contains', 'KeySafe',                'National franchise / aggregator',         'system'),
  ('ignore_name_contains', 'Master Locksmiths',      'Trade association — not a prospect',      'system'),
  ('ignore_name_contains', 'Locksmiths Association', 'Trade association',                       'system'),
  ('ignore_name_contains', 'AA Locksmiths',          'National aggregator brand',               'system'),
  ('ignore_name_contains', 'Mr Locksmith',           'National franchise',                      'system'),
  ('ignore_name_contains', 'Fast Locksmith',         'National aggregator brand',               'system'),
  ('ignore_name_contains', 'Capital Locksmiths',     'National chain / aggregator',             'system'),
  ('ignore_name_contains', 'City Locksmith',         'Common aggregator trading name',          'system'),
  ('ignore_name_contains', 'Direct Locksmith',       'National aggregator brand',               'system'),
  ('ignore_name_contains', 'Locksmith Direct',       'National aggregator brand',               'system')
ON CONFLICT (filter_type, value) DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────
-- Run these after migration to confirm:
--
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'prospects'
--   AND column_name IN ('has_mobile','mobile_optimised','has_schema','has_title_tag',
--                       'has_h1','has_faq','observation_1','observation_2',
--                       'outreach_hook','audit_error','report_first_opened_at')
--   ORDER BY column_name;
-- -- Should return 11 rows
--
-- SELECT COUNT(*) FROM prospect_filters;
-- -- Should return 24
