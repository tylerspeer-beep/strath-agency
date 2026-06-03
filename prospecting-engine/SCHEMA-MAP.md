# Strath Agency — Neon ↔ GHL Schema Map

**Last updated:** 4 Jun 2026  
**Neon table:** `prospects` (70 columns)  
**GHL location:** Strath Agency Ops (`Wh5GIK1F7zKLfCiM55zh`)  
**GHL field IDs verified:** 3 Jun 2026 via `GET /locations/{id}/customFields`

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Written correctly, verified live |
| ⚠️ | Written but needs attention |
| ❌ | Not written / broken |
| — | No GHL equivalent / not applicable |

**Pipeline steps:**
- **Scout** = `prospect-scout.ts` — runs on cron, creates GHL contact at discovery
- **Audit** = `prospect-audit.ts` — runs on cron after scout, updates GHL contact with findings

---

## System / Identity

| Neon Column | Type | GHL Field | GHL Field ID | Written By | Status |
|-------------|------|-----------|--------------|------------|--------|
| `id` | uuid | — | — | DB auto | — |
| `created_at` | timestamptz | — | — | DB auto | — |
| `updated_at` | timestamptz | — | — | DB auto | — |
| `status` | text | — | — | Scout/Audit | — |
| `source` | text | — | — | Scout | — |

---

## Business Identity

| Neon Column | Type | GHL Field | GHL Field ID | Written By | Status |
|-------------|------|-----------|--------------|------------|--------|
| `business_name` | text | Business Name (`contact.business_name`) | `3vWZA0tSQhEggH7ZFOrJ` | Scout + Audit | ✅ (added 4 Jun 2026) |
| `trading_name` | text | Trading Name (`contact.trading_name`) | `ZkBS30gtsiA3SQ9f5pmG` | — | ❌ Not written |
| `owner_name` | text | Owner Name (`contact.owner_name`) | `zcipK4SLbmn8BN9yFwCu` | — | ❌ Awaiting CH lookup |
| `owner_name_confidence` | text | Owner Name Confidence | `IuVOv8uiPKjinFM97Uee` | — | ❌ Awaiting CH lookup |
| `entity_type` | text | Entity Type (`contact.entity_type`) | `lyr2gHTjCnuponJg0v7d` | Scout + Audit | ✅ |
| `companies_house_number` | text | Companies House Number | `pONs3R8HVubJaA9MxxF7` | Scout (when CH match) | ⚠️ 0/143 — CH lookup not fully running |
| `companies_house_name` | text | — | — | Scout | — |
| `entity_verified_at` | timestamptz | — | — | Scout | — |

---

## Location

| Neon Column | Type | GHL Field | GHL Field ID | Written By | Status |
|-------------|------|-----------|--------------|------------|--------|
| `city` | text | Location/City (`contact.locationcity`) | `xeu7RsNrRcliZFRdMPMU` | Scout | ✅ (via `sourceCity`) |
| `region` | text | — | — | — | — |
| `postcode` | text | — | — | — | ❌ Not written |
| `full_address` | text | — | — | — | ❌ Not written (GHL standard `address` field used instead) |
| `latitude` | numeric | — | — | — | — |
| `longitude` | numeric | — | — | — | — |
| `service_area` | text | Service Radius (`contact.service_radius`) | `x3Fplw9BE1DJRWAKf7ou` | — | ❌ Not written |

---

## Contact Details

| Neon Column | Type | GHL Field | GHL Field ID | Written By | Status |
|-------------|------|-----------|--------------|------------|--------|
| `phone` | text | GHL standard phone | — | Scout (`upsertContact`) | ✅ |
| `email` | text | GHL standard email | — | Scout (`upsertContact`) | ✅ (when available) |
| `website_url` | text | Website URL (`contact.website_url`) | `TRQsiMWEr1Vz3ojOZ1Fp` | Scout + Audit | ✅ (added 4 Jun 2026) |
| `whatsapp_eligible` | boolean | WhatsApp Eligible (`contact.whatsapp_eligible`) | `s9lNKRXq6aVdriqzVxlP` | — | ❌ Not written (CHECKBOX — needs separate handling) |

---

## Google / GBP Data

| Neon Column | Type | GHL Field | GHL Field ID | Written By | Status |
|-------------|------|-----------|--------------|------------|--------|
| `google_place_id` | text | — | — | — | — |
| `gbp_name` | text | — | — | — | — |
| `gbp_rating` | numeric | GBP Rating (`contact.gbp_rating`) | `e8nu4c1NorvLiN8PVfVI` | Scout + Audit | ✅ |
| `gbp_review_count` | integer | GBP Review Count (`contact.gbp_review_count`) | `ucy9Pr5x4FEO398DcTuJ` | Scout + Audit | ✅ |
| `gbp_status` | text | GBP Status (`contact.gbp_status`) | `ifLfK1GLLFU07ZTBrqLW` | Scout + Audit | ✅ |
| `gbp_url` | text | GBP URL (`contact.gbp_url`) | `ov8L8hJ9z9sn7sR6acec` | Scout + Audit | ✅ (added 4 Jun 2026) |
| `gbp_type_mismatch` | boolean | GBP Type Mismatch (`contact.gbp_type_mismatch`) | `fqXlWcIhHDXUg24DCyNX` | — | ❌ CHECKBOX — not written |

---

## Website Audit Flags

| Neon Column | Type | GHL Field | GHL Field ID | Written By | Status |
|-------------|------|-----------|--------------|------------|--------|
| `website_status` | text | Website Status (`contact.website_status`) | `czraIs6sKMNpYeOSBjdA` | Scout + Audit | ✅ |
| `has_schema` | boolean | Has Schema (`contact.has_schema`) | `KeZ2bl3VVckbJRLGApBs` | — | ❌ CHECKBOX — not written |
| `has_title_tag` | boolean | — | — | Audit (Neon only) | — |
| `title_tag_quality` | text | Title Tag Quality (`contact.title_tag_quality`) | `8m3XTkuxQJclZnZV4nUQ` | Scout + Audit | ✅ |
| `mobile_optimised` | boolean | Mobile Optimised (`contact.mobile_optimised`) | `w0GNCjAB0SvcN98mN0Aw` | — | ❌ CHECKBOX — not written |
| `has_h1` | boolean | — | — | Audit (Neon only) | — |
| `has_faq` | boolean | Has FAQ (`contact.has_faq`) | `yuB9iFQFsayZwOBIEeiG` | — | ❌ CHECKBOX — not written |
| `agency_watermark` | text | Agency Watermark (`contact.agency_watermark`) | `RvWaAU7LTaUElVBVtrjz` | — | ❌ CHECKBOX — not written |
| `franchise_flag` | boolean | Franchise Flag (`contact.franchise_flag`) | `KsnUXZd5a474Q2BAsln5` | — | ❌ CHECKBOX — not written |

> **Note on CHECKBOX fields:** GHL CHECKBOX fields expect the string `"Yes"` as the value (not `true`/`false`). These need separate handling — add them to the build functions with `value ? 'Yes' : undefined` transformation.

---

## ICP / Scoring

| Neon Column | Type | GHL Field | GHL Field ID | Written By | Status |
|-------------|------|-----------|--------------|------------|--------|
| `raw_score` | integer | Raw Score (`contact.raw_score`) | `Gx7hANQPUcpghuAJqjAG` | Scout | ⚠️ 0/143 null — backfill needed (migration_004) |
| `icp_score` | integer | ICP Score (`contact.icp_score`) | `KtdGRo2H6AkJ2SYyAbpR` | Audit | ✅ |
| `icp_tier` | text | ICP Tier (`contact.icp_tier`) | `KbxizRTDaK1oRn3TRDJG` | Scout (Pending Audit) + Audit (real tier) | ✅ |
| `score_breakdown` | jsonb | — | — | Scout/Audit (Neon only) | — |
| `scored_at` | timestamptz | — | — | DB auto | — |

---

## Audit / Intelligence

| Neon Column | Type | GHL Field | GHL Field ID | Written By | Status |
|-------------|------|-----------|--------------|------------|--------|
| `nearest_competitor` | text | Nearest Competitor (`contact.nearest_competitor`) | `M2afIWxwYDplAJdiIruy` | Audit | ✅ |
| `observation_1` | text | Observation 1 (`contact.observation_1`) | `Sk7axtnOCvX6VbXrS5wd` | Audit | ✅ |
| `observation_2` | text | Observation 2 (`contact.observation_2`) | `3leJlcPxoJHXQgPjKFdG` | Audit | ✅ |
| `outreach_hook` | text | Outreach Hook (`contact.outreach_hook`) | `eXygrVk5rgA0KNXaoBlq` | Audit | ✅ |
| `business_trade_type` | ARRAY | Business Trade Type (`contact.business_trade_type`) | `vkYInfQdnyDDgoZ48VoL` | — | ❌ Not written (MULTIPLE_OPTIONS) |
| `tps_ctps_status` | text | TPS/CTPS Status (`contact.tpsctps_status`) | `raYtYCN6warnhmGwJMRJ` | — | ❌ Not written |
| `duplicate_of_place_id` | text | — | — | Scout (Neon only) | — |
| `audit_error` | text | — | — | Audit (Neon only) | — |

---

## GHL Sync

| Neon Column | Type | GHL Field | GHL Field ID | Written By | Status |
|-------------|------|-----------|--------------|------------|--------|
| `ghl_contact_id` | text | — | — | Scout (backfilled by Audit) | ⚠️ 6/143 — 137 awaiting backfill |
| `ghl_opportunity_id` | text | — | — | Audit | ⚠️ 0/143 — existingId writeback added 4 Jun 2026 |
| `ghl_synced_at` | timestamptz | — | — | Scout/Audit | — |
| `outreach_stage` | text | Outreach Stage (`contact.outreach_stage`) | `73BozTdNQufntQ3mKc3K` | Scout (Not Contacted) | ✅ |
| `approved_for_outreach` | boolean | — | — | Manual (Tyler) | — |
| `approved_at` | timestamptz | — | — | Manual (Tyler) | — |
| `drive_logged` | boolean | — | — | Future | — |

---

## Report Tracking

| Neon Column | Type | GHL Field | GHL Field ID | Written By | Status |
|-------------|------|-----------|--------------|------------|--------|
| `report_first_opened_at` | timestamptz | Report First Opened At | `wtEdzyqquMh5nf1uUBI7` | Report API (pixel) | ⚠️ 0/143 — no reports opened yet |
| `report_last_opened_at` | timestamptz | Report Last Opened At | `HBSvO8jZ1OIUEaCZRv99` | Report API (pixel) | ⚠️ 0/143 — no reports opened yet |
| `report_open_count` | integer | Report Open Count | `8jabUZ3jtnBSnPi8lA6W` | Report API (pixel) | ⚠️ 0/143 — no reports opened yet |

> **Report URL** is written to GHL field `contact.report_url` (`c6JtF7wICYmqwQdApYgV`) by the Audit. The report pixel at `/api/report?id={uuid}` writes the three report tracking fields back to GHL when the prospect opens the report. This flow is implemented but untested — no prospects have opened a report yet.

---

## Outstanding Issues

### Immediate (blocking clean data)

1. **raw_score backfill** — run `migration_004_backfill_raw_score.sql` in Neon SQL Editor. Copies `icp_score → raw_score` for the 143 existing records.

2. **137 prospects missing ghl_contact_id** — these exist in Neon but have no GHL contact. Requires a backfill: query all prospects where `ghl_contact_id IS NULL AND icp_score >= 40`, create GHL contacts for each, write IDs back. Build a one-off `/api/backfill-ghl-contacts` endpoint or run via Claude MCP directly.

3. **ghl_opportunity_id writeback** — fixed 4 Jun 2026. Audit now extracts `existingId` from duplicate 400s and writes to Neon. Next audit run will populate this field.

### Medium priority

4. **CHECKBOX fields not written** — `has_schema`, `mobile_optimised`, `has_faq`, `franchise_flag`, `agency_watermark`, `gbp_type_mismatch`, `whatsapp_eligible` all have GHL CHECKBOX fields but are never written. Add to audit payload with `value ? 'Yes' : undefined` transform. Low visual impact until outreach prep.

5. **trading_name, service_area, tps_ctps_status** — in Neon but no GHL write. Add when outreach sequence needs them.

### Future / planned

6. **Companies House lookup** — `owner_name`, `companies_house_number`, `companies_house_name` all 0/143. The CH lookup module exists (`lib/companies-house.ts`) but entity resolution is running with limited name variants at scout time. Website-extracted names (audit phase) not yet implemented.

7. **Business Trade Type** — MULTIPLE_OPTIONS field. GHL expects an array of option strings. Not yet mapped from Neon `business_trade_type` (ARRAY column).

---

## GHL Field IDs Quick Reference

```
businessName:         3vWZA0tSQhEggH7ZFOrJ
websiteUrl:           TRQsiMWEr1Vz3ojOZ1Fp
gbpUrl:               ov8L8hJ9z9sn7sR6acec
gbpRating:            e8nu4c1NorvLiN8PVfVI
gbpReviewCount:       ucy9Pr5x4FEO398DcTuJ
gbpStatus:            ifLfK1GLLFU07ZTBrqLW
websiteStatus:        czraIs6sKMNpYeOSBjdA
rawScore:             Gx7hANQPUcpghuAJqjAG
icpScore:             KtdGRo2H6AkJ2SYyAbpR
icpTier:              KbxizRTDaK1oRn3TRDJG
entityType:           lyr2gHTjCnuponJg0v7d
companiesHouseNumber: pONs3R8HVubJaA9MxxF7
observation1:         Sk7axtnOCvX6VbXrS5wd
observation2:         3leJlcPxoJHXQgPjKFdG
nearestCompetitor:    M2afIWxwYDplAJdiIruy
outreachHook:         eXygrVk5rgA0KNXaoBlq
quickWins:            8DfXT55RQanwJSpvNpt0
aiVisibilityScore:    VvQ9s0ihgKFEfCIIX23F
titleTagQuality:      8m3XTkuxQJclZnZV4nUQ
outreachStage:        73BozTdNQufntQ3mKc3K
sequenceStatus:       phOmcu3qbJalYhRADv0m
reportUrl:            c6JtF7wICYmqwQdApYgV
reportFirstOpenedAt:  wtEdzyqquMh5nf1uUBI7
reportLastOpenedAt:   HBSvO8jZ1OIUEaCZRv99
reportOpenCount:      8jabUZ3jtnBSnPi8lA6W
reportSectionsViewed: Oft0VvnvXzHpjutMUqSi
reportTimeonPage:     NOH0M0vs860XXylQm1wv
ghlSubAccountId:      q2NZETtXLJT322J6SmAM
sourceCity:           xeu7RsNrRcliZFRdMPMU
```
