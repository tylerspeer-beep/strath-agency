# Strath Prospecting Engine — Deploy Guide

## What This Is

Two Vercel cron functions that run fully automatically:

| Cron | Schedule | What it does |
|------|----------|-------------|
| `/api/prospect-scout` | Every hour, :00 | Finds locksmiths in a target city via Google Places, scores them (ICP formula), pushes Tier A + B to GHL Strath Ops |
| `/api/prospect-audit` | Every hour, :30 | Fetches websites for unaudited Tier A/B prospects, checks schema/mobile/title/FAQ, generates observation_1 and observation_2 for outreach emails, updates GHL contact fields |

The two run 30 minutes apart so audit always has fresh scout data to work on.

---

## Step 1 — Neon DB (do once)

1. Log into neon.tech → project strath-agency-db
2. Open the SQL editor
3. Run the full contents of `db/schema.sql`
4. Confirm tables: `prospects`, `audits`, `scout_runs`

---

## Step 2 — Google Places API Key

You need a Google Places API key with these APIs enabled:
- Places API (Nearby Search, Text Search, Place Details)
- Geocoding API

Go to console.cloud.google.com → APIs & Services → Credentials → Create API Key.
Restrict it to IP (Vercel's IPs) or HTTP referrer (your Vercel domain).

**Cost:** Google Places gives $200 free credit/month. At ~60 places per scout run × 24 runs/day, you're looking at well under the free tier. Place Details calls cost ~$0.017 each. Budget: £0–5/month.

---

## Step 3 — Add the code to your Vercel project

Option A — new Vercel project (cleanest):
```bash
cd prospecting-engine
vercel
# Follow prompts. Name it strath-prospecting or add to strath-agency project.
```

Option B — add to existing strath-agency Vercel project:
Copy `api/`, `lib/`, `db/`, `vercel.json`, `package.json`, `tsconfig.json` into your existing project root. Vercel will pick up the new cron entries when you deploy.

---

## Step 4 — Vercel Environment Variables

Add these in Vercel Dashboard → Project → Settings → Environment Variables:

| Variable | Value | Required |
|----------|-------|----------|
| `NEON_DATABASE_URL` | Your Neon connection string | ✅ |
| `GOOGLE_PLACES_API_KEY` | Google Places API key from Step 2 | ✅ |
| `GHL_STRATH_OPS_PIT` | Strath Agency Ops sub-account PIT | ✅ |
| `GHL_STRATH_OPS_LOCATION_ID` | `Wh5GIK1F7zKLfCiM55zh` | ✅ |
| `GHL_BASE_URL` | `https://services.leadconnectorhq.com` | ✅ |
| `CRON_SECRET` | Any random string (keep it secret) | ✅ |
| `COMPANIES_HOUSE_API_KEY` | CH API key (improves rate limits) | Optional |
| `SCOUT_TARGET_CITIES` | `Glasgow,Edinburgh,Aberdeen,Dundee,Inverness,Stirling,Falkirk,Hamilton,Livingston,Perth,Paisley,Kilmarnock,East Kilbride` | Optional (defaults to this list) |

**GHL_STRATH_OPS_PIT:** Get this from GHL → Strath Agency Ops sub-account → Settings → Integrations → Private Integrations. This is the sub-account PIT, not the agency key.

**CRON_SECRET:** Vercel automatically sends `Authorization: Bearer {CRON_SECRET}` on cron calls. Also add it to Railway if you want to trigger manually from there.

---

## Step 5 — Deploy

```bash
vercel --prod
```

Vercel will show the cron schedule in the dashboard under Settings → Crons.

---

## Step 6 — Test manually

Once deployed, you can trigger the scout manually:
```bash
curl -X POST https://your-project.vercel.app/api/prospect-scout?city=Glasgow \
  -H "Authorization: Bearer your-cron-secret"
```

You should see output like:
```json
{
  "city": "Glasgow",
  "prospectsFound": 42,
  "prospectsNew": 38,
  "tierA": 12,
  "tierB": 16,
  "tierC": 10
}
```

Then check GHL Strath Ops → Contacts → filter by tag `tier-a` to see the results.

---

## How the Pipeline Works End-to-End

```
[Vercel Cron: :00]
  prospect-scout.ts
    → Google Places finds locksmiths in target city
    → Companies House lookup for entity type
    → ICP score calculated
    → New prospects saved to Neon DB
    → Tier A + B → GHL Strath Ops
        → Contact created (name, phone, website, ICP fields)
        → Opportunity created in Locksmith Prospect Pipeline, stage: Identified

[Vercel Cron: :30]
  prospect-audit.ts
    → Picks top 5 unaudited Tier A/B prospects from Neon
    → Fetches each website, checks: title, meta, H1, schema, mobile, FAQ
    → Derives websiteStatus, aiVisibilityScore
    → Finds nearest competitor via Google Places text search
    → Generates observation_1 and observation_2 (specific, used in Touch 1 email)
    → Updates Neon DB: status → 'audited'
    → Updates GHL contact: observation_1, observation_2, refined scores

[Tyler reviews in GHL]
    → Strath Ops → Contacts → filter tier-a → review each
    → Reads observation_1, observation_2 on the contact card
    → If good: add tag "Approved for Outreach"
    → This triggers the Strath Outreach Sequence workflow in GHL (already built)

[GHL Workflow fires]
    → 5-touch email sequence over 17 days
    → Touch 3b WhatsApp for confirmed Ltd companies
    → Response Handler pauses sequence on any reply
```

---

## Monitoring

- Neon DB: `SELECT * FROM scout_runs ORDER BY ran_at DESC LIMIT 20;`
- Neon DB: `SELECT icp_tier, COUNT(*) FROM prospects GROUP BY icp_tier;`
- Neon DB: `SELECT * FROM prospects WHERE status = 'audited' ORDER BY icp_score DESC;`
- GHL: Contacts → filter tag `tier-a` → sort by date added

---

## Known Limitations

1. **Google Places does not expose "GBP claimed" status.** We infer it from data completeness. The lite audit cannot check this directly. A manual spot-check confirms the rating.

2. **Companies House lookup is name-match only.** It works for most Ltd companies but can miss if the trading name differs significantly from the registered name. The agent flags these as "Unknown" — safe for PECR (email-only).

3. **Website audit is single-page only** (homepage). Doesn't check inner pages or page speed API. Sufficient for generating outreach observations but not a full technical audit.

4. **No TPS/CTPS check built in.** WhatsApp eligibility in the outreach workflow requires `whatsapp_eligible = true` — this field defaults to false in Neon. Set it manually for confirmed Ltd contacts after verifying they're not TPS-registered, or build a TPS API integration (ICO charges for this).

---

## Files

```
prospecting-engine/
  api/
    prospect-scout.ts     Main discovery cron
    prospect-audit.ts     Lite audit cron
  lib/
    types.ts              Shared TypeScript types
    scoring.ts            ICP scoring logic
    companies-house.ts    Companies House API client
    ghl-client.ts         GHL REST API client (direct, not MCP)
    db.ts                 Neon DB queries
  db/
    schema.sql            Run once in Neon SQL editor
  vercel.json             Cron schedule
  package.json
  tsconfig.json
  DEPLOY.md               This file
```

---

*Last updated: 26 May 2026*
