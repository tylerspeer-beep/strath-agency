# Strath — Audit & Scoring Reconciliation

**Date:** 9 June 2026
**Author:** Systems engineering pass (Session 4)
**Scope:** Get the prospecting + audit system back on one track after the recent
product decisions. Reconcile documentation ↔ scoring model ↔ execution code,
implement a single GBP-first scoring model, and map the execution changes needed
to run prospects through the updated audit accurately.

This document is the source-of-truth reconciliation record. It has three parts:

- **Part A — Documentation consistency report** (what had drifted; what was fixed)
- **Part B — The unified scoring model** (the new GBP-first rubric, implemented)
- **Part C — Execution roadmap** (prioritised change-map for the updated audit)

The five recent product decisions this aligns to are referenced throughout as
**D1**–**D5** (GBP/Maps-first positioning; single 0–100 scoring model; multi-page
audit; per-page evidence/competitor/missed-call signals; honest timeframes).

---

## Part A — Documentation Consistency Report

### A1. Two divergent scoring rubrics that disagreed — **RESOLVED (code)**

The system had **two unrelated scoring formulas**, neither GBP-first:

| Where | What it computed | Problem |
|-------|------------------|---------|
| `lib/scoring.ts` → `scoreProspect()` | ICP score 0–100, stored in `icp_score` / `raw_score` / `score_breakdown` | **Website-heavy**, not GBP-first: Website **25** = Reviews **25** > GBP **20**. Contradicts D1. |
| `api/report.ts` (inline) | "AI Search Visibility Score" displayed as `X/10` | **Mathematically capped at 7/10** (schema 3 + faq 2 + mobile 1 + title 1). Re-derived its own rubric from four booleans, **ignored the stored score entirely**, and never rendered `icp_score` even though it was `SELECT`ed. Contained dead code `const aiScore = p.observation_1 ? null : null;`. |

This is exactly the divergence D2 calls out. **Fixed:** collapsed to one source of
truth (`scoreProspect`), reweighted GBP-first, and the report now renders the
**stored** breakdown instead of re-deriving. See Part B. The capped-`/10` bug was
also independently documented in `AUDIT_REPORT_ASSESSMENT.md §2a` (4 Jun 2026).

### A2. Stale rubric documentation — **FIXED IN PLACE**

The old website-heavy weights were copied into several docs. All updated to the new
GBP-first rubric (Part B):

- `CLAUDE.md` §17 (ICP Scoring Rubric) — full rewrite of weights, tiers, examples.
- `lib/scoring.ts` header comment — rewritten; now names itself as the source of truth.
- `lib/types.ts` `ScoreBreakdown` — added `phone`, corrected per-field max comments.
- `prospect-scout-log.md` — header formula line updated.

### A3. The `audits` table is declared but **never written** — **FLAG**

`db/schema.sql` defines a full `audits` table (one row per audit run per prospect).
**Nothing ever inserts into it.** All audit output is written to columns on
`prospects` via `updateProspectAudit()`. The only references to `audits` are in
`scripts/pre-build-purge-neon.mjs` (which counts/deletes it).

Consequence: every column unique to the `audits` table is **dead schema** —
`title_tag`, `meta_description`, `h1_tag`, `schema_types`, `has_faq_section`,
`mobile_viewport`, `page_load_class`, `has_address`, `has_phone`, `agency_watermark`,
`ai_visibility_score`, `ai_visibility_notes`, the GBP snapshot trio,
`competitor_rank`, `observation_1/2`, `raw_html_snapshot`, `raw_gbp_data`,
`passed_to_ghl`.

**Decision needed (D3/D4):** the multi-page audit produces per-page detail that
*should* live in a child table, not as more JSONB on `prospects`. Recommend
**reviving the `audits` table** as the per-run / per-page record rather than
dropping it. See Part C. Until then, the table is misleading to a new engineer.

### A4. Specifically-flagged "declared but never written" columns — **CONFIRMED**

| Column / field | Declared in | Written? | Notes |
|----------------|-------------|----------|-------|
| `competitor_rank` | `audits` table | ❌ Never | Whole `audits` table is dead (A3). Audit stores only the competitor **name** (`prospects.nearest_competitor`), no rank, no URL. |
| `page_load_class` | `audits` table | ❌ Never | No page-speed measurement exists anywhere in the code. |
| `report_sections_viewed` | GHL field `Oft0VvnvXzHpjutMUqSi` + `report.ts` param | ❌ Never populated | `updateGhlReportFields()` accepts `sectionsViewed` but no caller passes it — there is no scroll/section tracking, only the open pixel. |
| `ai_visibility_score` | `audits` table **and** GHL field `VvQ9s0ihgKFEfCIIX23F` | ⚠️ GHL only | The audit computes Claude's 0–10 score and pushes it to **GHL**, but stores it in **no `prospects` column**. That is *why* `report.ts` had to re-derive it. Per D4, AI visibility is now a byproduct, so the report no longer needs it. If we ever want it on the report, add `prospects.ai_visibility_score`. |

### A5. CHECKBOX GHL fields never written — **CONFIRMED (already documented)**

`SCHEMA-MAP.md` already flags that `has_schema`, `mobile_optimised`, `has_faq`,
`franchise_flag`, `agency_watermark`, `gbp_type_mismatch`, `whatsapp_eligible` have
GHL CHECKBOX fields that are never written (they need a `value ? 'Yes' : undefined`
transform). Still accurate. Low impact until outreach prep. No change made.

### A6. Honest-timeframe / overclaim drift (D5) — **PARTIALLY FIXED, REST FLAGGED**

`report.ts` contained claims the methodology can't support:

- "ChatGPT, Perplexity, and Google AI **cannot identify or recommend** this business" → **softened** to "missing the structured-data signals AI tools prefer when they cite local providers."
- "FAQ content is the **primary** way AI tools surface local businesses" → **softened** to "one of the formats AI tools draw on."
- "**over 70%** of emergency locksmith searches happen on a phone" (uncited) → **softened** to "most … happen on a phone."
- "Schema Markup (Structured Data)" jargon → relabelled "Machine-readable business info (schema markup)."

**Still flagged for your product decision (not changed):**

- **CTA guarantee** "Results in 30 days or you don't pay." — this is an unverified
  business promise, not a timeframe the system can stand behind. D5 says claims must
  be honest/directional (GBP: answered calls in weeks, Maps 1–3 months; SEO 6–12
  months; reviews lift conversion immediately). **Do you actually offer this
  guarantee?** If yes, keep + add structure; if no, replace with the directional
  timeframes. I did **not** rewrite your offer copy unilaterally.
- Remaining uncited stats ("40+ reviews dominate local Maps") — directionally fine
  but should carry a one-line "how we measure" note (the strongest locksmith-specific
  data is a **2018 BrightLocal** study; some call stats are vendor-sourced).

### A7. Audit is homepage-only — **CONSISTENT (drift is the product gap, not the docs)**

`CLAUDE.md` §15/§16 and `prospect-audit.ts` agree: the audit fetches **one** page
(homepage, first 8000 chars) and the privacy-policy page (franchise check only).
This matches the code — but D3 requires multi-page. This is the central execution
gap, mapped in Part C. No doc fix needed; it's a build item.

### A8. Pre-existing TypeScript errors — **FLAG (not mine to fix)**

`npx tsc --noEmit` reports 3 pre-existing errors in `api/prospect-scout.ts`
(lines ~424/425/465): the `resolveEntity(...).catch(() => ({ entityType: 'Unknown',
confidence: 'not_found' }))` fallback returns a narrower type than `EntityResolution`,
so `.companiesHouseNumber` / `.companiesHouseName` don't exist on the union. These
predate this session (confirmed against `git HEAD`). Vercel builds with esbuild
(no typecheck), so it deploys anyway — which is why this has gone unnoticed.

**One-line fix** (flagged, not applied to keep this change scoped to scoring):
type the catch fallback as a full `EntityResolution`, e.g.
`.catch((): EntityResolution => ({ entityType: 'Unknown', confidence: 'not_found' }))`.
A new engineer running `tsc` will trip on this immediately.

### A9. `scoring.ts` "Formula source" was circular — **FIXED**

The old header said "Formula source: `prospect-scout-log.md`", while `CLAUDE.md` §17
claimed `scoring.ts` was the source of truth. Circular. The header now declares
`scoring.ts` itself as the single source of truth and points to `CLAUDE.md` §17 +
this doc for rationale.

---

## Part B — The Unified Scoring Model (implemented)

**One function, one weight table, one stored result.** `scoreProspect()` in
`lib/scoring.ts` is the only place a score is computed. The scout calls it for
`raw_score`; the audit calls it for the confirmed `icp_score`; the report **renders
the stored breakdown** and computes no score of its own.

### B1. Weights (0–100, GBP-first)

Higher points = **bigger opportunity** = stronger ICP (a weak online presence is
what makes a good Strath prospect). Per D1, the lead-capturing signals (GBP, reviews,
phone) dominate; the website is a support signal (~12%).

**Presence categories — shown in the prospect report (max 75):**

| Signal | Max | Bands | What it checks | Where stored |
|--------|-----|-------|----------------|--------------|
| Google Reviews | **30** | `<15 → 30` · `15–40 → 18` · `40+ → 6` | `gbp_review_count` from Places | `score_breakdown.reviews` |
| GBP status | **25** | `Unclaimed → 25` · `Claimed-Basic → 18` · `Claimed-Optimised → 6` | `gbp_status` (inferred from Places data completeness at scout time) | `score_breakdown.gbp` |
| Website (support) | **12** | `None → 12` · `Basic/Old → 10` · `Modern → 5` · `Optimised → 1` | `website_status` (Basic/Old at scout; upgraded by audit) | `score_breakdown.website` |
| Phone / contactability | **8** | `no public phone → 8` · `reachable phone → 0` | `hasPhone` (GBP or website-recovered) | `score_breakdown.phone` |

**Fit categories — internal ICP qualifiers, never shown to the prospect (max 25):**

| Signal | Max | Bands | Where stored |
|--------|-----|-------|--------------|
| Entity (Ltd) | **10** | `Ltd → 10` · else `5` | `score_breakdown.entity` |
| Urban / proximity | **8** | `urban → 8` · else `0` | `score_breakdown.urban` |
| Not franchise | **7** | `independent → 7` · `franchise/aggregator → 0` | `score_breakdown.notFranchise` |

**Tiers (unchanged — preserves GHL option strings + Neon indexes):**
A = 70+, B = 40–69, C = <40.

### B2. The phone / missed-call signal (D4) — honest about its v1 limits

D4 names missed-call / speed-to-lead handling as "the sharpest commercial hook." It
is now a **first-class category slot**, but its v1 input is **contactability only**
(does a public phone exist). True missed-call / speed-to-lead measurement requires a
live call test or a connected-client telephony integration (a paid/connected step
per D5) and is **not yet wired**. The slot exists so that enrichment lands later
**without another reweight**. This is deliberately conservative — we do not award
"speed-to-lead opportunity" points on an assumption.

### B3. How the report renders the stored score (D2)

`report.ts` no longer computes a rubric. It reads `score_breakdown` and the exported
`SCORE_WEIGHTS` / `PRESENCE_KEYS` / `PRESENCE_MAX` from `scoring.ts`, and renders an
**Online Presence Score** card:

- For each presence category, it **inverts** the stored opportunity points for
  display: `strength = max − opportunity` (clamped). Higher bar = stronger area.
- Headline = `round(totalStrength / PRESENCE_MAX × 100)` → an honest 0–100 "presence
  strength" the prospect understands (high = good for them), derived purely from the
  stored breakdown and the single weight table. **No scoring logic lives in the report.**
- Stale, pre-rebuild rows (breakdown lacking the `phone` key) are screened out so we
  never render misleading bars; their per-signal findings cards still show.

> **Framing decision — FLAGGED for your sign-off.** Internally the stored number is
> an *opportunity* score (high = weak business = hot prospect). Showing that raw to a
> prospect is backwards ("you scored 92!" would mean "you're very weak"). I chose the
> **sensible default**: the report shows the *inverse* presence-strength view (high =
> strong), derived deterministically from the same stored breakdown — not a second
> rubric. If you'd rather the report show a literal stored number, the clean
> alternative is to store a dedicated `presence_score` column (one function, two
> stored views) — a small migration. Tell me which you prefer.

### B4. Files changed

| File | Change |
|------|--------|
| `lib/scoring.ts` | Rewrote `scoreProspect` weights GBP-first; added `phone` signal + `hasPhone` input; exported `SCORE_WEIGHTS`, `PRESENCE_KEYS`, `FIT_KEYS`, `PRESENCE_MAX`; rewrote header. |
| `lib/types.ts` | `ScoreBreakdown` gains `phone`; corrected per-field max comments. |
| `api/prospect-scout.ts` | Passes `hasPhone: !!rawPhone` into `scoreProspect`. |
| `api/prospect-audit.ts` | Tracks `recoveredPhone`; passes `hasPhone: !!(prospect.phone \|\| recoveredPhone)`. |
| `api/report.ts` | Removed re-derived `/10` AI score + dead code; renders stored breakdown as Online Presence Score; softened overclaims; plain-English labels. |

Typecheck: scoring/report/types changes are clean (`tsc --noEmit`); only the
pre-existing scout errors (A8) remain.

### B5. Recomputed tier examples (replaces the stale §17 examples)

| Profile | Calc | Score | Tier |
|---------|------|-------|------|
| No website, unclaimed GBP, 8 reviews, has phone, Ltd, Glasgow | 30+25+12+0+10+8+7 | **92** | A |
| Basic site, claimed-basic GBP, 22 reviews, has phone, Unknown, Edinburgh | 18+18+10+0+5+8+7 | **66** | B |
| Modern site, claimed-basic GBP, 30 reviews, has phone, Unknown, Aberdeen | 18+18+5+0+5+8+7 | **61** | B |
| Optimised site, claimed-optimised GBP, 60 reviews, has phone, Ltd, Glasgow | 6+6+1+0+10+8+7 | **38** | C |
| Optimised site, claimed-optimised GBP, 80 reviews, has phone, Ltd, rural | 6+6+1+0+10+0+7 | **30** | C |

The GBP-first reweighting correctly pushes already-strong businesses into C (weak
prospects) and keeps no-presence businesses firmly in A.

---

## Part C — Execution Roadmap (run prospects through the updated audit accurately)

Effort: **S** ≤ half a day · **M** ~1–2 days · **L** multi-day / new infra.
"v1" = required for an *accurate, consistent, shippable* updated audit. "Defer" =
real value, not needed for v1.

### C1. Change-map

| # | Item (decision) | Effort | Depends on | v1? |
|---|-----------------|--------|------------|-----|
| 1 | **GBP-first unified scoring + report renders stored score** (D1/D2) | S | — | ✅ **DONE this session** |
| 2 | **AI-visibility demoted to byproduct; overclaims softened** (D4/D5) | S | — | ✅ **DONE this session** |
| 3 | **Multi-page-lite crawl**: from the homepage, enumerate internal nav/menu links; fetch up to ~5 key pages (home, top services, contact, 1–2 town pages); run the existing per-page checks on each; store a per-page summary. (D3) | M | — | ✅ **v1** |
| 4 | **Town-page-pattern detection**: detect many town/area links resolving to a single `/contact` (no unique town pages) — a sharp, cheap finding. (D3) | M | #3 (needs enumerated links) | ✅ **v1** |
| 5 | **Competitor real URL + same checks**: capture the competitor's `place_id` → website, run the same per-page checks, store URL + result (not just the name). (D4) | M | #3 (reuse the crawl), competitor URL capture | ✅ **v1 (single-page competitor)** · full multi-page competitor = Defer |
| 6 | **migration_007** for the columns #3–#5 need — **or revive the `audits` table** (A3) as the per-run/per-page record. (D3) | S | decision A3 | ✅ **v1** |
| 7 | **"Important pages, not highest-traffic" honesty**: label the audit "most important pages" until GSC/analytics is connected. (D3) | S | #3 | ✅ **v1** (copy only) |
| 8 | **robots.txt + full sitemap enumeration**: complete page inventory beyond nav links. (D3) | M | #3 | Defer (v1.1) |
| 9 | **Stored screenshots per page** (screenshot API / headless, not live iframe). (D4) | M | external screenshot service + storage (blob), new env var | **Defer** — adds cost + infra; not needed for an accurate audit |
| 10 | **Real missed-call / speed-to-lead signal** (telephony / call test). (D4) | L | connected-client / paid step | **Defer** — v1 uses the contactability placeholder (B2) |
| 11 | **Page-load / speed measurement** to finally write `page_load_class`. (D3) | M | #3 | Defer |
| 12 | **`report_sections_viewed` scroll tracking** (A4). | M | client-side JS in report | Defer |
| 13 | **GHL custom fields** for new signals (competitor URL, town-page pattern, screenshot link) + `FIELD_IDS`. | S | Tyler creates fields in GHL UI | Defer (until outreach uses them) |
| 14 | **Honest-timeframe copy pass** across report CTA + email templates (D5); resolve the guarantee question (A6). | S | **your product decision** | v1 for the report copy once you answer A6; email templates Defer |
| 15 | **Fix pre-existing scout TS errors** (A8). | S | — | Optional (recommended) |

### C2. Recommended sequence — minimum to ship an accurate, consistent v1

1. **Done:** items 1, 2 (scoring + report) — committed this session.
2. **Decide A3** (revive `audits` table vs. add JSONB to `prospects`) — 5-minute call
   that unblocks item 6. Recommendation: revive `audits`.
3. **Item 6** — `migration_007` (or `audits` revival) for per-page + competitor storage.
4. **Item 3** — multi-page-lite crawl (the core of D3). Build it to reuse the existing
   `auditWebsite()` per-page check so the per-page logic stays single-source.
5. **Item 4** — town-page-pattern detection (rides on #3's link list).
6. **Item 5** — competitor URL + single-page competitor check (reuse #3).
7. **Item 7 + 14 (report half)** — copy: "most important pages," honest timeframes,
   resolve the guarantee line.

That set delivers the updated audit D1–D4 ask **without new infrastructure**. Stop there for v1.

### C3. Explicitly deferred (and why) — scope guardrails

These are tempting but are **not** required for "accurate, consistent, shippable,"
and each adds cost, infra, or a dependency:

- **Screenshots (item 9)** — needs a screenshot API + blob storage + env var. Evidence
  is nice; the audit is accurate without it. Defer to v1.1.
- **Full sitemap/robots crawl (item 8)** — nav-link enumeration covers the important
  pages; full inventory is diminishing returns for v1.
- **Real missed-call telephony (item 10)** — a connected-client/paid step by definition
  (D5). v1 ships the honest contactability placeholder.
- **Scroll/section tracking, page-speed class, pretty URLs, GHL field plumbing**
  (items 11–13) — analytics polish, not audit accuracy.
- **The report conversion redesign** from `AUDIT_REPORT_ASSESSMENT.md` (sticky CTA,
  social proof, competitor side-by-side table) — a separate conversion workstream,
  not part of "make the audit accurate and consistent." Keep it out of this track.

**Scope-creep watch:** the moment we start building screenshots, full crawls, or
telephony into "v1," we are past the brief. The v1 line is: one GBP-first score, a
report that renders it honestly, and a multi-page-lite crawl that assesses the few
pages that matter (plus the competitor) — nothing that needs new infrastructure.

---

*End of reconciliation. Code changes (scoring + report) and doc updates committed;
nothing deployed. No live scout/backfill run.*
