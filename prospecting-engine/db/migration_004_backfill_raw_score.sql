-- Migration 004: Backfill raw_score for pre-Session-2 records
-- Context: old scout code wrote the ICP score to icp_score directly.
-- New scout code writes to raw_score (pre-audit estimate) and leaves icp_score
-- for the audit cron to set after full analysis.
-- For the 143 existing records, copy icp_score → raw_score where raw_score is null.
-- Safe to run multiple times (WHERE raw_score IS NULL guard).

UPDATE prospects
SET raw_score = icp_score
WHERE raw_score IS NULL
  AND icp_score IS NOT NULL;

-- Verify
SELECT
  COUNT(*) FILTER (WHERE raw_score IS NOT NULL) AS raw_score_populated,
  COUNT(*) FILTER (WHERE raw_score IS NULL)     AS raw_score_null,
  COUNT(*)                                      AS total
FROM prospects;
