-- Strath Agency — Migration 005: Scout Quality (false-positive fixes)
-- Adds Places metadata columns + new prospect_filters entries.
-- Run once in Neon SQL editor. Safe to re-run.
--
-- What this addresses (see CLAUDE.md / scout debrief):
--   1. business_status was fetched from Places but never persisted. The scout's
--      existing PERMANENTLY_CLOSED skip used the wrong string constant
--      (Places uses CLOSED_PERMANENTLY) so it never fired. CLOSED_TEMPORARILY
--      was ignored entirely.
--   2. Google Places `types` (category array) was fetched but only used as a
--      soft signal — adjacent categories like 'storage' slipped through
--      keyword matches on "lock". We now persist the array and gate on it.
--   3. The franchise/aggregator list missed Lock N Leave (a UK self-storage
--      chain) and other self-storage brands that name-match "lock".

-- ── 1. Schema additions ──────────────────────────────────────────────────────

-- Places business_status: 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY'
-- Stored so we can audit later. Scout filters on this at ingest time.
ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS business_status TEXT;

-- Places types[]: the Google category array (e.g. ['locksmith','point_of_interest']).
-- We gate scout ingest on `'locksmith' = ANY(gbp_categories)` going forward.
-- Note: a legacy `google_types TEXT` column exists from an earlier schema; left
-- alone to avoid destructive ALTER. New writes go to `gbp_categories` (TEXT[]).
ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS gbp_categories TEXT[];

-- ── 2. Filter additions ─────────────────────────────────────────────────────
-- Lock N Leave is the immediate Aberdeen false-positive. Adding the broader
-- self-storage brand names that commonly use "lock" prefixes so the same class
-- of mismatch doesn't recur. The category gate (step 1) is the structural fix;
-- these rows are belt-and-braces in case Google ever mis-tags one of them as
-- 'locksmith'.

INSERT INTO prospect_filters (filter_type, value, reason, added_by) VALUES
  ('ignore_name_contains', 'Lock N Leave',  'Self-storage chain — not a locksmith', 'system'),
  ('ignore_name_contains', 'Lok''nStore',   'Self-storage chain',                   'system'),
  ('ignore_name_contains', 'Big Yellow',    'Self-storage chain',                   'system'),
  ('ignore_name_contains', 'Safestore',     'Self-storage chain',                   'system'),
  ('ignore_name_contains', 'Self Storage',  'Self-storage category name',           'system'),
  ('ignore_name_contains', 'Storage King',  'Self-storage chain',                   'system'),
  ('ignore_name_contains', 'Access Self',   'Self-storage chain',                   'system')
ON CONFLICT (filter_type, value) DO NOTHING;

-- ── 3. Verification ─────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name='prospects' AND column_name IN ('business_status','gbp_categories');
-- -- expect 2 rows
--
-- SELECT value FROM prospect_filters
--  WHERE value IN ('Lock N Leave','Lok''nStore','Big Yellow','Safestore',
--                  'Self Storage','Storage King','Access Self')
--  ORDER BY value;
-- -- expect 7 rows
