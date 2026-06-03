# Session 1 Debrief — Prospecting Engine Foundation
**Date:** 1 June 2026
**Scope:** Deduplication, filter system, keyword scaffolding, raw score / tier separation

---

## What was built

### TARGET 1: Deduplication and data hygiene

Three layers of dedup now run before any prospect is inserted:

1. **Place ID** — unchanged from before, but now cross-run (DB-backed)
2. **Normalized phone** — phones are stripped to digits only before comparison. UK country code prefix (`44XXXXXXXXXX`) is converted to local form (`0XXXXXXXXXX`). Postgres `regexp_replace` normalizes stored values at query time so existing denormalized records are matched too. All new inserts store the normalized phone.
3. **Root domain** — the website URL's root domain (no protocol, no `www.`) is extracted and checked against existing records. If a match is found, the new prospect is inserted as a minimal suppressed record with `status='do_not_contact'` and `duplicate_of_place_id` pointing to the original's `google_place_id`. This keeps suppressed records traceable rather than silently discarded.

`google_place_id` already had a UNIQUE constraint in `schema.sql` — confirmed and left in place.

New columns added to `prospects`: `raw_score`, `duplicate_of_place_id`.

---

### TARGET 2: Prospect filter and ignore list system

New `prospect_filters` table with a `UNIQUE(filter_type, value)` constraint. Schema:

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `filter_type` | TEXT | See types below |
| `value` | TEXT | The string to match |
| `reason` | TEXT | Why the rule exists |
| `added_by` | TEXT | `'system'` or `'tyler'` |
| `created_at` | TIMESTAMPTZ | |

Filter types:
- `ignore_place_id` — exact match on `google_place_id`
- `ignore_domain` — exact match on root domain extracted from `website_url`
- `ignore_name_contains` — case-insensitive substring match on `business_name`
- `ignore_keyword` — matches business name or URL
- `flag_for_review` — inserts the prospect with `status='flagged'`, does not push to GHL

Seeded on creation:
| Rule | Value | Reason |
|------|-------|--------|
| `ignore_name_contains` | Timpson | National chain |
| `ignore_name_contains` | Halfords | National chain |
| `ignore_name_contains` | Screwfix | National chain |
| `ignore_name_contains` | Home Locksmith | Residential-only, not our ICP |
| `ignore_name_contains` | Locksmith Training | Training company not a service business |

The scout checks filters after dedup and before scoring. Suppressed prospects are skipped entirely (logged with the matched rule). Flagged prospects are inserted but not pushed to GHL.

To add a new rule at any time: `INSERT INTO prospect_filters (filter_type, value, reason, added_by) VALUES (...)`.

---

### TARGET 3: Keyword expansion scaffolding

`search_keyword` column added to `scout_runs`. Every run now logs which keyword was used.

Keyword resolution priority in the scout:
1. `?keyword=auto+locksmith` query param (per-run override)
2. `SCOUT_KEYWORD` env var (global override)
3. Default: `'locksmith'`

The Places API call was changed from `&type=locksmith` (fixed taxonomy) to `&keyword=locksmith` (free text) to support future keywords like `auto locksmith`, `emergency locksmith`, `car key replacement`. No code change required to add new keywords — just pass them as a query param or env var.

**Note:** See decision D below re: `keyword` vs `type` API behavior difference.

---

### TARGET 4: Raw score only — tier assignment moved to audit cron

**Before:** Scout calculated `icp_tier` (A/B/C) and immediately created both a GHL contact and a GHL opportunity.

**After:**
- Scout calculates `raw_score` (0-100) using the same ICP formula. Stores it in the new `raw_score` column.
- `icp_tier` is set to `'ungraded'` at insert time.
- `icp_score` is left NULL — reserved for the audit cron's confirmed score after full website analysis.
- GHL push threshold: `raw_score >= 40`. Contact is created with `icp_tier = 'Pending Audit'` in the custom field.
- No tier tag applied at this stage. No GHL opportunity created.
- Audit cron now creates the GHL opportunity after confirming the tier, applies the correct tier tag (`tier-a`, `tier-b`, or `tier-c`), and stores the opportunity ID in Neon. Opportunity is only created for confirmed A or B tiers, and only if one does not already exist (safe on audit retry).

`getProspectsPendingAudit` query updated from `icp_tier IN ('A...', 'B...')` to `icp_tier = 'ungraded' AND raw_score >= 40`.

---

### Bonus fix: snake_case / camelCase mapping bug

`getProspectsPendingAudit` was doing `return rows as unknown as Prospect[]`. Neon returns snake_case column names (`ghl_contact_id`, `website_url`, etc.) but the `Prospect` interface uses camelCase (`ghlContactId`, `websiteUrl`). The cast silently passed TypeScript but all camelCase field accesses at runtime returned `undefined`. This meant `ghlContactId` in the audit cron was always `undefined`, so the GHL update block never ran for any prospect.

Fixed by adding `rowToProspect()` in `db.ts` — a complete explicit mapper from DB snake_case to `Prospect` camelCase. `getProspectsPendingAudit` now pipes all rows through it.

---

## Files changed

| File | Change type | Summary |
|------|------------|---------|
| `lib/types.ts` | Modified | Added `'ungraded'` to `IcpTier`, `'flagged'` to `ProspectStatus`, `rawScore` and `duplicateOfPlaceId` to `Prospect` |
| `db/schema.sql` | Modified | New columns on `prospects` and `scout_runs`, new `prospect_filters` table with seed data |
| `db/migration_001_session1.sql` | **New** | ALTER TABLE migrations for existing databases. Run once before deploying. Verification queries included. |
| `lib/db.ts` | Significant rewrite | `normalizePhone()`, `extractRootDomain()`, `rowToProspect()`, `findProspectByDomain()`, `checkProspectFilters()`, `updateProspectOpportunityId()`. Updated `insertProspect()`, `findProspectByPhone()`, `logScoutRun()`, `getProspectsPendingAudit()`. |
| `api/prospect-scout.ts` | Significant rewrite | Keyword param, three-layer dedup, filter check, `raw_score` storage, `icp_tier='ungraded'`, contact-only GHL push, opportunity removed. |
| `api/prospect-audit.ts` | Modified | Imports `GHL` and `updateProspectOpportunityId`. Applies tier tag to contact. Creates GHL opportunity after tier confirmation (A/B only, no duplicate). |

---

## Decisions to revisit

**A — Domain duplicate handling: insert suppressed record vs. silent skip**
Domain duplicates are currently inserted as minimal records with `status='do_not_contact'` and `duplicate_of_place_id` set. This keeps them traceable. If you prefer silent discard (smaller table), change the domain dedup block in the scout to a simple `continue`.

**B — `icp_score` field in GHL during scout push**
The scout writes `raw_score` to the `contact.icp_score` GHL field before the audit runs. The audit overwrites it with the confirmed score. GHL will show the scout's estimate temporarily. Confirm this is acceptable or tell me to leave `icp_score` blank until the audit.

**C — `keyword=` vs `type=locksmith` in Places API**
Changed from `&type=locksmith` to `&keyword=locksmith` to support free-text keywords. These have slightly different ranking behavior in the Places API — `type` is a strict taxonomy filter, `keyword` is a text search. For `'locksmith'` specifically, behavior should be near-identical. If you want both (`&type=locksmith&keyword=locksmith`), one-line change, just say so.

**D — Franchise filter overlap**
`detectFranchise()` in `scoring.ts` still runs before `checkProspectFilters()`. Both result in suppression. In Session 2 we could migrate the `FRANCHISE_KEYWORDS` list from `scoring.ts` into `prospect_filters` as `ignore_name_contains` rules so the full ignore list lives in one place and is editable without a deploy. Flag if you want this in scope.

---

## Pre-existing bugs found (not introduced in Session 1)

**`generateObservations()` in `prospect-audit.ts` — line 248**
References `audit.hasTitleTag` and `audit.titleTagQuality`. Neither field exists on `WebsiteAuditResult`. Both are always `undefined` at runtime. Side effect: the "page title not optimised" observation always fires (because `!undefined` is `true`). Does not affect Session 1 targets. Fix is straightforward — add these fields to `WebsiteAuditResult` or update the condition to use `audit.titleTag` directly. Schedule for Session 2.

---

## Deployment checklist

Run in this order:

1. **Run migration** — connect to Neon (`strath-agency-db`, London `lhr1`) and run `db/migration_001_session1.sql`. Verify with the queries at the bottom of that file. Confirm 5 rows in `prospect_filters` and new columns on `prospects` and `scout_runs`.

2. **Deploy code** — push to GitHub, confirm Vercel deploys successfully.

3. **Smoke test scout** — `POST /api/prospect-scout?city=Glasgow` with `Authorization: Bearer {CRON_SECRET}`. Confirm response JSON includes `keyword`, `prospectsSuppressed`, and no `error`. Check Neon: new prospects should have `icp_tier='ungraded'` and a value in `raw_score`.

4. **Smoke test audit** — `POST /api/prospect-audit?batch=2`. Confirm at least one prospect moves from `status='discovered'` to `status='audited'` and `icp_tier` gets a real value. Check GHL Strath Ops: the contact should have the tier tag applied and a new opportunity in the `Identified` stage.

5. **(Optional) Test keyword param** — `POST /api/prospect-scout?city=Glasgow&keyword=auto+locksmith`. Confirm `search_keyword='auto locksmith'` appears in `scout_runs`.

---

## Note on existing Neon data

If you have existing rows in `prospects` with real `icp_tier` values (`'A - Hot (70+)'` etc.) that have not been audited yet, they will not enter the audit queue under the new logic (query filters on `icp_tier = 'ungraded'`). If you want to re-audit those rows, add this to the migration run:

```sql
UPDATE prospects
SET icp_tier = 'ungraded', raw_score = icp_score
WHERE icp_tier IN ('A - Hot (70+)', 'B - Warm (40-69)', 'C - Cold (<40)')
  AND status = 'discovered';
```

This promotes their existing `icp_score` to `raw_score` and marks them ungraded so the audit cron picks them up. Only run if you have live unaudited data you want to preserve.
