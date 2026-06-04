-- Strath Agency — Migration 006: Auto-focus + Franchise tracking
-- Run AFTER migration_005 in Neon SQL editor. Safe to re-run.
--
-- Adds the columns needed for:
--   1. Auto-locksmith focus classification (per scout qualification rework)
--   2. Audit-time franchise detection (privacy policy scrape)
--   3. Cleanup traceability — record WHY a prospect was marked do_not_contact

-- ── Schema additions ───────────────────────────────────────────────────────────

-- 'confirmed' | 'likely' | 'unknown'
--   confirmed: name regex matches auto patterns AND discovered via auto keyword
--   likely:    one of the two signals present
--   unknown:   neither — record gets status='flagged' for manual review
ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS auto_focus TEXT;

-- Free-text label describing how franchise_flag became true.
-- Expected values: 'filter_match' | 'name_pattern' | 'privacy_policy' | 'manual'
ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS franchise_detected_by TEXT;

-- Reason a record was set to status='do_not_contact'.
-- Helps audit which cleanup rule fired without keeping a separate log table.
ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS do_not_contact_reason TEXT;

-- ── Generic franchise tokens ───────────────────────────────────────────────────
-- These match against the business name via ignore_keyword (already supported by
-- checkProspectFilters). They catch generic franchise language that brand-name
-- entries in prospect_filters won't.

INSERT INTO prospect_filters (filter_type, value, reason, added_by) VALUES
  ('ignore_keyword', 'franchise',  'Generic franchise marker',  'system'),
  ('ignore_keyword', 'franchisee', 'Generic franchise marker',  'system')
ON CONFLICT (filter_type, value) DO NOTHING;

-- ── Indexes ─────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_prospects_auto_focus
  ON prospects(auto_focus);
CREATE INDEX IF NOT EXISTS idx_prospects_franchise_flag
  ON prospects(franchise_flag);

-- ── Verification ────────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name='prospects'
--    AND column_name IN ('auto_focus','franchise_detected_by','do_not_contact_reason');
-- -- expect 3 rows
--
-- SELECT value FROM prospect_filters
--  WHERE filter_type = 'ignore_keyword' ORDER BY value;
-- -- expect: franchise, franchisee
