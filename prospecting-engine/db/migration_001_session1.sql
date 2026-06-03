-- Strath Agency — Migration 001: Session 1 Build
-- Run this ONCE against any existing Neon database.
-- Fresh installs: run schema.sql instead (already includes these changes).
-- Safe to re-run: all statements use IF NOT EXISTS or ON CONFLICT DO NOTHING.

-- ─── TARGET 1: Dedup improvements ────────────────────────────────────────────

-- raw_score: scout's signal-count score, set at discovery time.
-- icp_score remains for the audit-confirmed score (was being used for both before).
ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS raw_score             INTEGER,
  ADD COLUMN IF NOT EXISTS duplicate_of_place_id TEXT;

-- google_place_id UNIQUE already exists in schema.sql — verify with:
-- \d prospects
-- If missing for any reason, run:
-- ALTER TABLE prospects ADD CONSTRAINT prospects_google_place_id_key UNIQUE (google_place_id);

-- ─── TARGET 3: Keyword expansion ─────────────────────────────────────────────

ALTER TABLE scout_runs
  ADD COLUMN IF NOT EXISTS search_keyword       TEXT NOT NULL DEFAULT 'locksmith',
  ADD COLUMN IF NOT EXISTS prospects_suppressed INTEGER DEFAULT 0;

-- ─── TARGET 2: Prospect filters table ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prospect_filters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filter_type TEXT NOT NULL,
  value       TEXT NOT NULL,
  reason      TEXT,
  added_by    TEXT NOT NULL DEFAULT 'system',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(filter_type, value)
);

-- Seed initial ignore rules
INSERT INTO prospect_filters (filter_type, value, reason, added_by) VALUES
  ('ignore_name_contains', 'Timpson',           'National chain',                            'system'),
  ('ignore_name_contains', 'Halfords',           'National chain',                            'system'),
  ('ignore_name_contains', 'Screwfix',           'National chain',                            'system'),
  ('ignore_name_contains', 'Home Locksmith',     'Residential-only, not our ICP',             'system'),
  ('ignore_name_contains', 'Locksmith Training', 'Training company not a service business',   'system')
ON CONFLICT (filter_type, value) DO NOTHING;

-- Status field comment update (informational only — Postgres TEXT has no enum enforcement)
-- Valid status values now include 'flagged' (set when prospect matches a flag_for_review filter rule)
-- 'discovered' | 'audited' | 'approved' | 'rejected' | 'flagged' | 'in_outreach'
-- | 'responded' | 'closed_won' | 'closed_lost' | 'do_not_contact'

-- ─── Verification queries ─────────────────────────────────────────────────────
-- Run these after migration to confirm everything landed:
--
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'prospects'
--   AND column_name IN ('raw_score', 'duplicate_of_place_id');
--
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'scout_runs'
--   AND column_name IN ('search_keyword', 'prospects_suppressed');
--
-- SELECT COUNT(*) FROM prospect_filters;  -- should return 5
