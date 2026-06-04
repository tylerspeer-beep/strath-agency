# Strath Agency — Session 2 Debrief & Handover

**Date:** 4 Jun 2026  
**Last commit:** `29a07ea` — pushed to `github.com/tylerspeer-beep/strath-agency`  
**Vercel project:** strath-agency — auto-deploys from main branch  
**Railway MCP:** zesty-achievement / web — GHL tools active on Strath Ops

---

## What Was Built This Session

### Core pipeline: fully operational end-to-end

```
Google Places API → Scout → Neon DB → GHL Contact → Audit (Claude) → GHL Custom Fields
```

Every stage confirmed working on live Kilmarnock data. 10 prospects audited, GHL fields populated, report URL written.

### Bugs fixed (8 total)

| # | Bug | File | Fix |
|---|-----|------|-----|
| 1 | `title:` → `name:` in GHL opportunity call | `ghl-client.ts` + `prospect-scout.ts` | Fixed both locations |
| 2 | `logScoutRun` null DB error (`query`, `search_keyword` columns NOT NULL) | `db.ts` | Made params optional with fallbacks |
| 3 | Audit returned `audited:0` — `icp_tier = 'ungraded'` filter found no records (old scout wrote real tiers) | `db.ts` | Removed tier filter, use `COALESCE(raw_score, icp_score, 0) >= 40` |
| 4 | `NeonDbError: could not determine data type of parameter $19` | `db.ts` | Added `::integer` cast to `scored_at CASE WHEN` |
| 5 | GHL custom field writes silently failed — code sent `key` format, GHL requires UUID `id` format | `ghl-client.ts` | Added `FIELD_IDS` map (all 62 field UUIDs), switched all build functions to use `id` |
| 6 | Audit GHL push skipped for 137/143 prospects — `ghl_contact_id` null, guard failed silently | `prospect-audit.ts` | Added `findContact(phone)` fallback + Neon backfill when ID missing |
| 7 | Missing GHL field writes: `businessName`, `websiteUrl`, `gbpUrl` | `ghl-client.ts` + `prospect-audit.ts` + `prospect-scout.ts` | Added to `FIELD_IDS`, both build functions, and all callers |
| 8 | `ghl_opportunity_id` never written back to Neon after GHL creates it | `prospect-audit.ts` | Catch duplicate 400, extract `existingId` from response, write to Neon |

### New files created

| File | Purpose |
|------|---------|
| `prospecting-engine/SCHEMA-MAP.md` | Complete Neon ↔ GHL field mapping. Source of truth for sync. |
| `prospecting-engine/db/migration_004_backfill_raw_score.sql` | Copies `icp_score → raw_score` for 143 pre-Session-2 records |
| `prospecting-engine/api/report.ts` | Branded HTML audit report at `/api/report?id={uuid}` with open tracking pixel |

---

## Current System State

### Data (as of 4 Jun 2026)

| Metric | Value | Notes |
|--------|-------|-------|
| Prospects in Neon | 143 | Kilmarnock + Glasgow + surrounding cities |
| Audited | 34 | `status = 'audited'` — full Claude analysis done |
| Pending audit | 109 | `status = 'discovered'` — queued for next audit run |
| GHL contacts | 6 | Only Kilmarnock batch pushed so far |
| GHL contacts missing | 137 | Need backfill — task #14 |
| GHL opportunities | ~6 | Created during audit; IDs now written back to Neon |

### What's working

- ✅ Scout cron (Google Places → score → Neon → GHL contact at `raw_score >= 40`)
- ✅ Audit cron (Claude Sonnet website analysis → GHL field update → opportunity creation)
- ✅ GHL contact creation with custom fields (IDs verified)
- ✅ Report URL written to GHL contact — prospect opens `/api/report?id=...`
- ✅ Opportunity created at `Identified` stage after audit confirms tier A or B
- ✅ `ghl_contact_id` backfill in audit (phone lookup fallback)
- ✅ `ghl_opportunity_id` writeback (including from duplicate 400 responses)

### What's not yet done

| Task | Priority | Notes |
|------|----------|-------|
| Run migration_004 in Neon | High | One SQL statement — backfills `raw_score` for 143 records |
| Backfill 137 GHL contacts | High | Build `/api/backfill-ghl-contacts` endpoint |
| Timpson filter (no-go list) | High | One SQL insert into `prospect_filters` |
| Review V1 audit report output | Medium | Open a report URL from GHL, assess quality |
| CHECKBOX fields not written | Medium | `has_schema`, `mobile_optimised`, `has_faq`, etc. |
| Companies House lookup | Medium | CH module exists, website-name extraction not wired up |
| 5-touch email sequence in GHL | High | Templates exist, workflow built — needs merge field verify |
| Snapshot: Strath Locksmith V1 | Medium | After Locksmith Template workflows verified |
| Glasgow/Edinburgh scout runs | Low | System is live, cron will pick up new cities automatically |

---

## Pending SQL (run in Neon SQL Editor)

### migration_004 — backfill raw_score
```sql
UPDATE prospects
SET raw_score = icp_score
WHERE raw_score IS NULL
  AND icp_score IS NOT NULL;
```

### Timpson filter
```sql
INSERT INTO prospect_filters (filter_type, value)
VALUES ('ignore_name_contains', 'timpson');
```

### Verify GHL contact coverage
```sql
SELECT
  COUNT(*) FILTER (WHERE ghl_contact_id IS NOT NULL) AS in_ghl,
  COUNT(*) FILTER (WHERE ghl_contact_id IS NULL AND icp_score >= 40) AS missing_eligible,
  COUNT(*) AS total
FROM prospects;
```

---

## Infrastructure Quick Reference

| System | URL / Location | Notes |
|--------|----------------|-------|
| GitHub | `github.com/tylerspeer-beep/strath-agency` | Main branch = production |
| Vercel | `strath-agency.vercel.app` | Auto-deploys from GitHub main |
| Neon DB | `strath-agency-db` (London lhr1) | `NEON_DATABASE_URL` in Vercel env |
| Railway MCP | `web-production-9311e.up.railway.app` | GHL tools for Cowork sessions |
| GHL Strath Ops | `Wh5GIK1F7zKLfCiM55zh` | Active account for all prospecting |
| CRON_SECRET | `strath-cron-2026-x7k` | Stored in DEPLOY-NOW.md (gitignored) |

### Manual cron triggers
```bash
# Scout (pick next city automatically)
curl -X POST https://strath-agency.vercel.app/api/prospect-scout \
  -H "Authorization: Bearer strath-cron-2026-x7k"

# Audit (batch of 10)
curl -X POST "https://strath-agency.vercel.app/api/prospect-audit?batch=10" \
  -H "Authorization: Bearer strath-cron-2026-x7k"
```

---

## Next Session Priority Order

1. Run migration_004 + Timpson filter SQL (2 minutes)
2. Build `/api/backfill-ghl-contacts` — push all 137 missing prospects to GHL
3. Verify 5-touch email sequence merge fields on a test contact
4. Open a report URL — review quality, assess homepage-only vs multi-page
5. Publish the outreach workflow once merge fields are confirmed
6. Run a fresh scout on Glasgow and Edinburgh
7. Create Strath Locksmith V1 snapshot from Locksmith Template

---

*Session 2 closed. All code committed to `29a07ea`. System is live and functional.*
