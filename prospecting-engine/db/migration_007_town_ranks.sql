-- Strath Agency — Migration 007: Per-town map-rank storage
-- Run AFTER migration_006 in the Neon SQL editor. Safe to re-run (IF NOT EXISTS).
--
-- Adds storage for the "rank on the map" report visual:
--   - town_ranks: the full per-town Serper local-rank scan for a prospect, cached
--     so we hit Serper once per scan (audit time) and never per report view.
--   - town_ranks_scanned_at: when that scan last ran (freshness / re-scan gating).
--
-- town_ranks JSON shape (written by lib/town-rank.ts → scanTownRanks):
--   {
--     "scannedAt": "2026-06-09T10:00:00.000Z",
--     "keyword": "auto locksmith",
--     "townSource": "homepage_nav" | "fallback",
--     "towns": [
--       { "town": "Kilmarnock", "lat": 55.61, "lng": -4.49,
--         "rank": 2, "found": true, "matchedBy": "place_id", "topResult": "ACME Auto Keys" },
--       { "town": "Irvine", "lat": 55.61, "lng": -4.66,
--         "rank": null, "found": false, "matchedBy": null, "topResult": "Other Locksmith" }
--     ],
--     "totalTowns": 8, "foundCount": 5, "topThreeCount": 3
--   }

ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS town_ranks JSONB;

ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS town_ranks_scanned_at TIMESTAMPTZ;

-- ── Verification ────────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name='prospects'
--    AND column_name IN ('town_ranks','town_ranks_scanned_at');
-- -- expect 2 rows
