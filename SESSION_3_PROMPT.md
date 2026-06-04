# Session 3 — Strath Agency Starting Prompt

Paste this entire block into a fresh Cowork or Claude Chrome session to pick up exactly where Session 2 ended.

---

**Context:** I'm Tyler, founder of Strath Agency — a digital marketing agency targeting independent UK locksmiths. I have a prospecting engine deployed on Vercel that scouts prospects via Google Places, scores them with an ICP formula, stores them in Neon Postgres, and syncs to GoHighLevel (GHL) CRM.

**Last commit:** `29a07ea` on `github.com/tylerspeer-beep/strath-agency`  
**Vercel:** `https://strath-agency.vercel.app` (auto-deploys from main)  
**GHL account:** Strath Agency Ops (Location ID: `Wh5GIK1F7zKLfCiM55zh`) — use Railway MCP tools  
**CRON_SECRET:** `strath-cron-2026-x7k`

---

## System Status

The full pipeline is working end-to-end:

- Scout cron: Google Places → ICP score → Neon DB → GHL contact
- Audit cron: Claude Sonnet website analysis → GHL custom fields → opportunity creation
- GHL field writes: confirmed working (using field UUIDs, not key strings)
- 143 prospects in Neon. 34 audited. 6 have GHL contacts (137 need backfill).

---

## Do These First (Quick SQL — Neon SQL Editor)

**1. Backfill raw_score for 143 existing records:**
```sql
UPDATE prospects SET raw_score = icp_score WHERE raw_score IS NULL AND icp_score IS NOT NULL;
```

**2. Add Timpson to no-go filter:**
```sql
INSERT INTO prospect_filters (filter_type, value) VALUES ('ignore_name_contains', 'timpson');
```

**3. Check GHL contact coverage:**
```sql
SELECT
  COUNT(*) FILTER (WHERE ghl_contact_id IS NOT NULL) AS in_ghl,
  COUNT(*) FILTER (WHERE ghl_contact_id IS NULL AND icp_score >= 40) AS missing_eligible,
  COUNT(*) AS total
FROM prospects;
```

---

## Priority Tasks This Session

### 1. Build `/api/backfill-ghl-contacts` (most important)
137 prospects have `icp_score >= 40` but no `ghl_contact_id`. They exist in Neon but never got pushed to GHL. Build a protected endpoint that:
- Queries prospects WHERE `ghl_contact_id IS NULL AND icp_score >= 40`
- Creates GHL contacts using `ghl.upsertContact()` (same as scout does)
- Writes IDs back via `updateProspectGhlIds()`
- Processes in batches of 20 with a small delay
- Returns `{ processed: N, failed: N }`

Reference: `prospect-scout.ts` lines 388-419 for the exact upsertContact call pattern. Use `buildScoutCustomFields()` from `ghl-client.ts`.

### 2. Verify email sequence merge fields
The 5-touch email sequence exists in GHL Strath Ops. Before publishing the workflow:
- Open a test GHL contact that has been through the audit (has Observation 1, Observation 2, Outreach Hook populated)
- Check the email templates use the correct merge field syntax for custom fields
- Confirm `{{contact.observation_1}}`, `{{contact.observation_2}}`, `{{contact.outreach_hook}}` resolve correctly in preview

### 3. Open a report URL and assess quality
Pull the Report URL from any audited GHL contact. Open it in a browser. The report lives at `https://strath-agency.vercel.app/api/report?id={prospect_uuid}`.
- Does it render correctly?
- Is the audit quality good enough to send to a prospect?
- Is homepage-only analysis sufficient or do we need inner pages (services, contact, about)?

### 4. Publish the outreach workflow
Once merge fields are verified, enable the GHL workflow in Strath Ops. The workflow should:
- Trigger on `approved_for_outreach = true` (or a tag)
- Fire 5-email sequence over 17 days
- Pause immediately on any reply and notify Tyler

### 5. Run fresh scout runs
```bash
# Scout Glasgow
curl -X POST https://strath-agency.vercel.app/api/prospect-scout \
  -H "Authorization: Bearer strath-cron-2026-x7k"
```

Then run audit on the new batch:
```bash
curl -X POST "https://strath-agency.vercel.app/api/prospect-audit?batch=10" \
  -H "Authorization: Bearer strath-cron-2026-x7k"
```

---

## Key Files

| File | Purpose |
|------|---------|
| `prospecting-engine/SCHEMA-MAP.md` | Complete Neon ↔ GHL field map with all field UUIDs |
| `prospecting-engine/SESSION_2_DEBRIEF.md` | Full session 2 summary and bug fix log |
| `prospecting-engine/lib/ghl-client.ts` | GHL client — `FIELD_IDS` map, `buildScoutCustomFields`, `buildAuditCustomFields` |
| `prospecting-engine/lib/db.ts` | All Neon queries — `insertProspect`, `getProspectsPendingAudit`, `logScoutRun` |
| `prospecting-engine/api/prospect-scout.ts` | Scout cron — Google Places → score → Neon → GHL |
| `prospecting-engine/api/prospect-audit.ts` | Audit cron — Claude Sonnet → GHL update → opportunity |
| `prospecting-engine/api/report.ts` | HTML report at `/api/report?id={uuid}` |
| `prospecting-engine/db/migration_004_backfill_raw_score.sql` | Run this in Neon |

---

## Infrastructure

| System | Details |
|--------|---------|
| GitHub | `github.com/tylerspeer-beep/strath-agency` — main branch = production |
| Vercel | `strath-agency.vercel.app` — Hobby plan, daily cron limit |
| Neon | `strath-agency-db`, London lhr1 |
| Railway MCP | `web-production-9311e.up.railway.app` — 550+ GHL tools |
| GHL Strath Ops | Location ID `Wh5GIK1F7zKLfCiM55zh` |
| GHL Pipeline | Locksmith Prospect Pipeline ID `I7FwEILwbdXkvyK4ak6q` |

---

## Compliance Rules (always apply)

- Cold email to Ltd companies: OK under PECR
- Cold email to sole traders: requires opt-out and legitimate interest basis
- Cold WhatsApp to anyone without prior contact: DO NOT do this
- Every outreach message must include: Strath identity, opt-out, business contact
- Car Key Kings (`6D4IPXvCT5SOEct8ah0O`) is a live client — never test there
- Tyler's personal number must never be used for any outreach
