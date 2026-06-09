# Strath — Jobs To Be Done (this week's queue)

**Created:** 9 June 2026
**Purpose:** Single capture of everything deferred/queued so nothing is lost. Targeted
for **this week**. Detail + rationale for most items lives in
`docs/AUDIT_RECONCILIATION.md` (Parts A & C); this is the actionable checklist.

Effort: **S** ≤ half a day · **M** ~1–2 days · **L** multi-day / new infra.

---

## A. Updated audit — execution build (the core v1 work)

- [ ] **A1. Multi-page-lite crawl** (M) — replace homepage-only audit with a crawl of
      the top 5–8 important pages; run the existing per-page checks on each. Reuse
      `auditWebsite()` so per-page logic stays single-source.
- [ ] **A2. Page-selection method** (S, part of A1) — implement the 3-source method
      spec'd in `docs/AUDIT_RECONCILIATION.md §C1a`: (a) `sitemap.xml` / `robots.txt`
      Sitemap line (primary, free); (b) `site:domain.com` via a cheap SERP API
      (**Serper.dev ~$0.001/query** or DataForSEO) for Google's relevance order
      (secondary; needs `SERPER_API_KEY`); (c) nav/internal-link prominence (free
      fallback). Always include homepage; cap at 8; record which source chose each page.
      Keep copy honest: "most **important** pages," not "most trafficked" (no GSC for
      cold prospects).
- [ ] **A3. Town-page-pattern detection** (M, rides on A1) — detect many town/area
      links all routing to a single `/contact` (no unique town pages). Sharp, cheap finding.
- [ ] **A4. Competitor — single, real-data check + URL** (M) — capture the competitor's
      `place_id` → website URL and run the same per-page checks; store URL + result
      (today only the name is stored). Full multi-page competitor audit is deferred.
- [ ] **A5. `audits`-table decision + migration** (S, blocks A1/A4 storage) — the
      `audits` table is declared but never written (dead schema incl. `competitor_rank`,
      `page_load_class`). **Decide:** revive `audits` as the per-run/per-page record
      (recommended) vs. add JSONB to `prospects`. Then `migration_007`. See §A3/§C.

## B. Report engagement + attribution (GHL receiver fields already exist)

- [ ] **B1. Wire the 3 GHL engagement producers** — fields exist in GHL, no code writes them:
  - [ ] `Report CTA Clicked` (`1eppfEUxc99mwgRdiUI5`)
  - [ ] `Report Time On Page Seconds` (`NOH0M0vs860XXylQm1wv`)
  - [ ] `Report Sections Viewed` (`Oft0VvnvXzHpjutMUqSi`)
- [ ] **B2. CTA `/go=cta` redirect tracking** (S) — route the booking CTA through a
      tracked redirect (e.g. `/api/report?id=…&cta=1` → record click → 302 to calendar)
      to populate `Report CTA Clicked`. Pairs with B1.
- [ ] **B3. Per-prospect `?ref` booking attribution** (S) — append a per-prospect ref to
      the booking URL so bookings attribute back to the prospect/report.
- [ ] **B4. Scroll/dwell tracking** (M) — client-side JS + beacon to populate
      `Report Time On Page Seconds` + `Report Sections Viewed`.

## C. Scoring / fields reconciliation

- [ ] **C1. 0–10 vs 0–100 score-field reconciliation** (S decision + GHL connector) —
      GHL "AI Visibility Score" (`VvQ9s0ihgKFEfCIIX23F`) is **0–10**; unified model is
      **0–100**. **Keep the field as the 0–10 AI byproduct; do NOT write 0–100 into it.**
      Decide whether a 0–100 presence score needs its own GHL field or rides on existing
      "ICP Score" (`KtdGRo2H6AkJ2SYyAbpR`). GHL-side, handled with connector work. (§A10.1)

## D. Copy / page content

- [x] **D1. Honest-copy pass — guarantee removed** — done 9 Jun 2026: dropped
      "30 days or you don't pay" / "or we work for free" in `report.ts` + landing page;
      replaced with directional timeframes (calls in weeks, Maps 1–3 months
      proximity-capped, reviews immediate, SEO 6–12 months, AI a byproduct).
- [ ] **D2. Remaining honest-copy pass** (S) — add a one-line "how we measure" note for
      directional stats ("40+ reviews dominate local Maps"); strongest locksmith data is
      a 2018 BrightLocal study, some call stats are vendor-sourced. (§A6)
- [ ] **D3. Pricing-on-page** (S, pending pricing validation) — current written offer:
      **Setup Only £397 one-time · Growth Retainer £197/mo · Full Digital £397/mo** (GBP;
      the earlier $1,000–1,800 was US and is superseded). Decide whether/where to surface
      pricing on the report or keep it to the call. Validate competitiveness first.

## E. Visual proof / UX (approach TBD — decide before building)

- [ ] **E1. Visual-proof approach** (decision, then M/L) — how to show per-page evidence.
      Options to weigh: **stored screenshots** (screenshot API + blob storage, new env var
      + cost) vs **live-data finding cards** (cheapest, no infra) vs **Google Maps embed**
      of the GBP. Pick the approach before building; screenshots stay deferred unless chosen.
- [ ] **E2. Founder bio/photo + Car Key Kings proof** (S–M) — one founder line + photo and
      a real client outcome (Car Key Kings) for cold-prospect trust. Needs a real,
      quotable outcome — confirm the numbers before publishing.

## F. Repo / hygiene

- [ ] **F1. Version the untracked project files after secret review** (S) — separate,
      reviewed pass. Untracked files referencing credentials (`prospecting-engine/scripts/*.mjs`,
      `tool-registry-schema-patch/`, `ghl-mcp-switch-account-patch/`, `locksmith-template-config.json`,
      `push-to-github.sh`, `github-push/`, plus docs `AUDIT_REPORT_ASSESSMENT.md`,
      `GHL-Build-Debrief.md`, `Car Key Kings — Workflow Build Guide.md`,
      `deploy-locksmith-template.md`, `tool-registry-patch.md`) live only in the Drive
      master, not GitHub. Review for hardcoded secrets, then commit the clean ones.
- [ ] **F2. Fix pre-existing scout TS errors** (S, optional) — `prospect-scout.ts`
      `resolveEntity().catch(...)` fallback type; `tsc` trips on it. (§A8)

---

## Note — WhatsApp (this week, GDPR boundary)

Tyler is signing up for a **WhatsApp Business number** this week. **GDPR/PECR boundary:**
**manual** outreach is OK; **automated** cold WhatsApp to individuals/sole traders is **not**
(most UK locksmiths are sole traders; ICO fines up to £17.5m). So **WhatsApp stays in the
prospecting/outreach workflow (manual, gated), NOT on the audit/report page.** Do not add
any WhatsApp automation to the audit flow.
