-- Strath Agency — Prospect Engine DB Schema
-- Neon Postgres (strath-agency-db, London lhr1)
-- Run once to initialise. Safe to re-run (IF NOT EXISTS everywhere).

-- ─── PROSPECTS ───────────────────────────────────────────────────────────────
-- One row per discovered locksmith business.
-- Created by the prospect-scout cron. Updated by lite-audit and GHL sync.

CREATE TABLE IF NOT EXISTS prospects (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Identity
  business_name         TEXT NOT NULL,
  trading_name          TEXT,
  owner_name            TEXT,
  owner_name_confidence TEXT,         -- 'confirmed' | 'likely' | 'unknown'

  -- Location
  city                  TEXT NOT NULL,
  region                TEXT,
  postcode              TEXT,
  full_address          TEXT,
  latitude              NUMERIC(9,6),
  longitude             NUMERIC(9,6),
  service_area          TEXT,

  -- Contact
  phone                 TEXT,
  email                 TEXT,
  website_url           TEXT,
  whatsapp_eligible     BOOLEAN DEFAULT false,

  -- Google Business Profile
  google_place_id       TEXT UNIQUE,
  gbp_name              TEXT,
  gbp_rating            NUMERIC(2,1),
  gbp_review_count      INTEGER,
  gbp_status            TEXT,         -- 'Unclaimed' | 'Claimed - Basic' | 'Claimed - Optimised'
  gbp_url               TEXT,

  -- Entity / PECR
  entity_type           TEXT DEFAULT 'Unknown',  -- 'Ltd' | 'Sole Trader' | 'Partnership' | 'Unknown'
  companies_house_number TEXT,
  companies_house_name  TEXT,
  entity_verified_at    TIMESTAMPTZ,
  tps_ctps_status       TEXT DEFAULT 'Unknown',  -- 'Not Registered' | 'Registered' | 'Unknown'

  -- Website quality (set by lite-audit)
  website_status        TEXT,         -- 'None' | 'Basic/Old' | 'Modern' | 'Optimised'
  has_schema            BOOLEAN,
  has_title_tag         BOOLEAN,
  title_tag_quality     TEXT,         -- 'Missing' | 'Generic' | 'Good' | 'Optimised'
  mobile_optimised      BOOLEAN,
  has_h1                BOOLEAN,
  has_faq               BOOLEAN,
  agency_watermark      TEXT,         -- e.g. 'Yell', 'Checkatrade'
  franchise_flag        BOOLEAN DEFAULT false,

  -- ICP scoring
  -- raw_score: scout's signal-count score before audit. icp_score: confirmed score after audit.
  raw_score             INTEGER,      -- 0–100, set by scout
  icp_score             INTEGER,      -- 0–100, set by audit (may differ from raw_score)
  icp_tier              TEXT,         -- 'ungraded' (scout) | 'A - Hot (70+)' | 'B - Warm (40-69)' | 'C - Cold (<40)'
  score_breakdown       JSONB,        -- { reviews: 15, website: 20, gbp: 15, entity: 10, ... }
  scored_at             TIMESTAMPTZ,

  -- Competitive intel (set by lite-audit)
  nearest_competitor    TEXT,         -- Name of top-ranking local competitor
  observation_1         TEXT,         -- Primary audit observation for outreach
  observation_2         TEXT,         -- Secondary audit observation for outreach

  -- Business type
  business_trade_type   TEXT[],       -- ['Residential', 'Emergency', ...]
  source                TEXT DEFAULT 'google_places',

  -- Dedup
  duplicate_of_place_id TEXT,         -- place_id of the original record when suppressed as a duplicate

  -- GHL sync
  ghl_contact_id        TEXT,         -- GHL Contact ID once synced
  ghl_opportunity_id    TEXT,         -- GHL Opportunity ID in Locksmith Prospect Pipeline
  ghl_synced_at         TIMESTAMPTZ,
  outreach_stage        TEXT DEFAULT 'Not Contacted',
  approved_for_outreach BOOLEAN DEFAULT false,
  approved_at           TIMESTAMPTZ,

  -- Status
  status                TEXT DEFAULT 'discovered',  -- 'discovered' | 'audited' | 'approved' | 'rejected' | 'flagged' | 'in_outreach' | 'responded' | 'closed_won' | 'closed_lost' | 'do_not_contact'

  -- Drive backup
  drive_logged          BOOLEAN DEFAULT false
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prospects_updated_at
  BEFORE UPDATE ON prospects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── AUDITS ──────────────────────────────────────────────────────────────────
-- One row per audit run per prospect. Multiple audits allowed (re-audit on update).

CREATE TABLE IF NOT EXISTS audits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id      UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Website checks
  website_url      TEXT,
  title_tag        TEXT,
  meta_description TEXT,
  h1_tag           TEXT,
  has_schema       BOOLEAN,
  schema_types     TEXT[],            -- e.g. ['LocalBusiness', 'FAQPage']
  has_faq_section  BOOLEAN,
  mobile_viewport  BOOLEAN,
  page_load_class  TEXT,              -- 'fast' | 'moderate' | 'slow' (rough)
  has_address      BOOLEAN,
  has_phone        BOOLEAN,
  agency_watermark TEXT,

  -- AI visibility score (0–10)
  ai_visibility_score  INTEGER,
  ai_visibility_notes  TEXT,

  -- GBP snapshot at time of audit
  gbp_rating           NUMERIC(2,1),
  gbp_review_count     INTEGER,
  gbp_status           TEXT,

  -- Competitor
  nearest_competitor   TEXT,
  competitor_rank      TEXT,          -- 'above' | 'same_pack' | 'unknown'

  -- Generated observations
  observation_1        TEXT,
  observation_2        TEXT,

  -- Raw data
  raw_html_snapshot    TEXT,          -- first 5000 chars of homepage HTML
  raw_gbp_data         JSONB,

  passed_to_ghl        BOOLEAN DEFAULT false
);

-- ─── SCOUT RUNS ──────────────────────────────────────────────────────────────
-- One row per cron execution. Useful for debugging and rate-limit tracking.

CREATE TABLE IF NOT EXISTS scout_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  city             TEXT NOT NULL,
  query            TEXT NOT NULL,
  search_keyword   TEXT NOT NULL DEFAULT 'locksmith',
  prospects_found  INTEGER DEFAULT 0,
  prospects_new    INTEGER DEFAULT 0,
  prospects_suppressed INTEGER DEFAULT 0,  -- filtered by prospect_filters
  tier_a_count     INTEGER DEFAULT 0,
  tier_b_count     INTEGER DEFAULT 0,
  tier_c_count     INTEGER DEFAULT 0,
  error            TEXT,
  duration_ms      INTEGER
);

-- ─── PROSPECT FILTERS ────────────────────────────────────────────────────────
-- Ignore and flag rules checked before any prospect is inserted.
-- filter_type: 'ignore_place_id' | 'ignore_domain' | 'ignore_name_contains' | 'ignore_keyword' | 'flag_for_review'

CREATE TABLE IF NOT EXISTS prospect_filters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filter_type TEXT NOT NULL,
  value       TEXT NOT NULL,
  reason      TEXT,
  added_by    TEXT NOT NULL DEFAULT 'system',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(filter_type, value)
);

-- Seed initial ignore rules (ON CONFLICT DO NOTHING is safe due to UNIQUE constraint above)
INSERT INTO prospect_filters (filter_type, value, reason, added_by) VALUES
  ('ignore_name_contains', 'Timpson',           'National chain',                            'system'),
  ('ignore_name_contains', 'Halfords',           'National chain',                            'system'),
  ('ignore_name_contains', 'Screwfix',           'National chain',                            'system'),
  ('ignore_name_contains', 'Home Locksmith',     'Residential-only, not our ICP',             'system'),
  ('ignore_name_contains', 'Locksmith Training', 'Training company not a service business',   'system')
ON CONFLICT (filter_type, value) DO NOTHING;

-- ─── INDEXES ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_prospects_icp_tier    ON prospects(icp_tier);
CREATE INDEX IF NOT EXISTS idx_prospects_status      ON prospects(status);
CREATE INDEX IF NOT EXISTS idx_prospects_city        ON prospects(city);
CREATE INDEX IF NOT EXISTS idx_prospects_entity_type ON prospects(entity_type);
CREATE INDEX IF NOT EXISTS idx_prospects_approved    ON prospects(approved_for_outreach);
CREATE INDEX IF NOT EXISTS idx_prospects_ghl_id      ON prospects(ghl_contact_id);
CREATE INDEX IF NOT EXISTS idx_audits_prospect_id    ON audits(prospect_id);
