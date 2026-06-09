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
- [ ] **C2. Reframe the entity signal: compliance/contactability, not desirability**
      (decision + S code) — Tyler's steer: Ltd-vs-sole-trader must NOT be an arbitrary ICP
      desirability weight; its real job is **legal contact-channel eligibility** (WhatsApp/text
      vs email-only under PECR). **Proposed exact change (await sign-off — shifts tier math):**
      remove `entity` (Ltd 10 / non-Ltd 5) from the 0–100 `scoreProspect` total, and instead
      set a `whatsappEligible` / contactability flag from `entityType` (confirmed Ltd/LLP →
      eligible). Either rescale the score to /90 (keep tier numbers, recalibrate A/B/C cutoffs)
      or redistribute the 10 pts to presence categories. Currently **doc + comment reframed,
      code math unchanged** pending confirmation. (CLAUDE.md §16–17, `scoring.ts` comment)
- [ ] **C3. Companies House contactability assessment** (M) — Scout/prospect-engine: assess
      the Companies House business profile to (a) **confirm business details** and (b)
      **determine legal contact channels** (WhatsApp/text eligibility). Feeds C2's flag.

## D. Copy / page content

- [x] **D1. Honest-copy pass — guarantee removed** — done 9 Jun 2026 and **verified
      removed everywhere** (repo-wide grep returns zero hits). Tyler's call: remove it,
      it commoditizes us. Dropped "30 days or you don't pay" (`report.ts`) and "or we work
      for free" (landing page); replaced with directional timeframes (calls in weeks, Maps
      1–3 months proximity-capped, reviews immediate, SEO 6–12 months, AI a byproduct).
- [ ] **D2. Remaining honest-copy pass** (S) — add a one-line "how we measure" note for
      directional stats ("40+ reviews dominate local Maps"); strongest locksmith data is
      a 2018 BrightLocal study, some call stats are vendor-sourced. (§A6)
- [ ] **D3. Pricing-on-page** (S, pending pricing validation) — current written offer:
      **Setup Only £397 one-time · Growth Retainer £197/mo · Full Digital £397/mo** (GBP;
      the earlier $1,000–1,800 was US and is superseded). Decide whether/where to surface
      pricing on the report or keep it to the call. Validate competitiveness first.

## E. Visual proof / UX (approach DECIDED 9 Jun 2026)

- [ ] **E1. Visual-proof approach — CONFIRMED** (M). Build the report's visual proof as
      **live data cards + a free Google Maps embed**, explicitly **NOT stored screenshots**
      and **NOT iframing the prospect's own site**:
      - A branded **"Your Google listing" card** built from **Places API data**, referencing
        **Google's hosted photo URL** (no images stored by us).
      - A **map with pins** (free Google Maps embed) — not a screenshot.
      - A **per-town rank layer** to come from a **SERP API (DataForSEO / Serper)** — being
        **scoped in a separate thread**; wire it in once that scope lands.
      Screenshots and site-iframing are explicitly ruled out (cost/infra + trust/legal).
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
- [ ] **F3. Pre-go-live hardening** (S) — from the (now-archived) Execution Guide V1:
      run `npm audit fix` on the MCP server and review high-severity items; add `@types/node`
      to the prospecting-engine devDeps/tsconfig so `tsc` runs clean (ties to F2). Do before
      any client data flows.

## G. Build sequence — this week (the critical path)

Ordered. Each gate must pass before the next. No prospect is contacted in GHL until G5.

- [ ] **G1. Fully build the Locksmith Master Template** (L) — the single source every client
      clones from. Specifically:
  - [ ] Verify/add the **"Unknown"** option on the **Entity Type** custom field (GHL UI).
  - [ ] Build the **6 SMS templates** (Missed Call Text-Back, Review Request — First Ask,
        Review Request — Follow-Up, New Inquiry Confirmation, Job Booking Confirmation,
        New Client Welcome).
  - [ ] Build the **5 workflows** (01 Missed Call Text-Back, 02 Review Request Sequence,
        03 New Inquiry Auto-Response, 04 New Client Welcome, 05 Monthly Reporting Reminder).
  - [ ] Build the **8-stage Locksmith Job Pipeline** (New Inquiry → Called Back → Quoted →
        Job Booked → Job Complete → Review Requested → Won → Lost).
  - [ ] **Create the Snapshot** ("Strath Locksmith V1 — May 2026") once the above is verified.
- [ ] **G2. Clone the Template → create Car Key Kings as the end-to-end BETA** (M) — incl. the
      **premium site rebuild**. CKK is not built until this runs. (CKK is NOT live today.)
- [ ] **G3. strathgrowth.com rebuild** (M) — apply the **new branding package**, load into GHL,
      and **launch**. Not fully live until this is done.
- [ ] **G4. Refine the Tier A audit doc** (S–M) — the audit/report output a prospect receives.
- [ ] **G5. TEST outreach firing end-to-end** (M) — before connecting ANY prospect in GHL.
      Publish the 5-touch sequence / DNC handler only after this passes (today they're drafts;
      only "Strath - Response Handler" v6 is published).
- [ ] **G6. Agent swarm for client delivery** (L) — spin up post-close delivery automation,
      tested against the CKK beta first.

Tyler is signing up for a **WhatsApp Business number** this week. **GDPR/PECR boundary:**
**manual** outreach is OK; **automated** cold WhatsApp to individuals/sole traders is **not**
(most UK locksmiths are sole traders; ICO fines up to £17.5m). So **WhatsApp stays in the
prospecting/outreach workflow (manual, gated), NOT on the audit/report page.** Do not add
any WhatsApp automation to the audit flow.
