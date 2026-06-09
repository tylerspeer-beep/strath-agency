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
- [x] **C2. Entity signal reframed → compliance/contactability** — **DONE 9 Jun 2026
      (Tyler approved).** Removed `entity` (was Ltd 10 / non-Ltd 5) from the `scoreProspect`
      total; the 6 remaining categories (raw max 90) are normalised `round(raw/90×100)` to keep
      a 0–100 scale + tiers. `isWhatsappEligible(entityType)` now sets the GHL **"WhatsApp
      Eligible"** field (`s9lNKRXq6aVdriqzVxlP`, CHECKBOX "Yes") via the scout + backfill, and
      persists to Neon `whatsapp_eligible`. Tier math: all documented examples unchanged (Ltd
      loses only its old +5 edge). (scoring.ts, types.ts, scout, audit, ghl-client, db, CLAUDE.md §16–17)
- [ ] **C3. Companies House contactability assessment** (M) — Scout: assess the Companies
      House business profile to (a) **confirm business details** and (b) **set contact-channel
      (WhatsApp/text) eligibility**. Today `isWhatsappEligible` keys off `entityType === 'Ltd'`
      from the existing CH lookup; this item deepens that (LLP handling, confidence, address
      confirmation) and feeds the WhatsApp Eligible flag.

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

- [x] **E1. Visual-proof — BUILT 9 Jun 2026** (was M). Shipped in `api/report.ts`:
      - **"Your Google listing" card** from stored Places data (name, rating, reviews,
        category, claimed badge). Photo served via a **same-origin proxy**
        (`/api/report?id=…&photo=1`) — Places Details→Photo fetched server-side and
        streamed (CDN-cached `s-maxage=604800`), so the **API key never reaches the
        client** (Google's photo URL embeds the key; "referenced directly" was not
        possible without leaking it). No images stored.
      - **Leaflet + OSM map** (no key/billing) with a pin per served town, coloured by
        local-pack rank (green top-3 / amber 4–10 / red not-found) + headline
        "Top 3 on Google Maps in X of Y towns you serve". Framed on the prospect's
        OWN claimed towns (not a geo comparison).
      - **Per-town rank layer:** `lib/town-rank.ts` (town extraction from homepage nav →
        fallback to city+nearby; **Serper.dev** Maps query per town; rank by place_id
        then name) + `api/town-rank-scan.ts` (CRON_SECRET-protected, `?id=` single /
        `?batch=` fill-in). Cached in Neon `prospects.town_ranks` (migration_007) —
        Serper hit **once per scan**, never per report view. Town centres geocoded free
        via OSM Nominatim for the pins.
      - **Graceful fallback verified:** prospects with no `town_ranks` (all 237 existing)
        render with the map section + Leaflet includes fully hidden; the listing card
        still shows. Typecheck clean; map JS syntax-checked; render asserted both states.
      - **Brand note:** matched the *existing* report.ts card/typography system (the
        brief's racing-green/honey/Manrope is the **new** package, see G3 — not built
        yet). Rank pins use the report's existing green/amber/red status colours.
      - Screenshots and site-iframing remain ruled out (cost/infra + trust/legal).
- [ ] **E1a. Town-rank scan — schedule + scale** (S–M, follow-up to E1):
  - [ ] Add a **periodic `town-rank-scan` cron** (e.g. weekly, `?batch=N`) for tier-A/audited
        prospects so ranks stay fresh. Today it's run manually (`?id=`) or batch fill-in.
  - [ ] **Town discovery v2:** extraction is a homepage-nav heuristic. Fold in `sitemap.xml`
        / `site:domain` (ties to **A2** Serper) and **town-page-pattern detection (A3)** —
        "many town links → one `/contact`" is itself a sharp finding to surface on the map.
  - [ ] **Serper keyword** is fixed to `"auto locksmith"`; vary by the prospect's actual
        service focus once auto-focus classification is trusted.
  - [ ] **Nominatim** town-centre geocoding is fine at current volume (≤8/scan, 1 req/s).
        If scaled, cache town→coords (they don't change) or move to a paid geocoder.
- [ ] **E1b. Listing-photo cost** (S, follow-up to E1) — the photo proxy makes **2 Google
      Places calls** (Details→Photo) on the first uncached load per prospect (then CDN-cached
      `s-maxage=604800`). To halve it, store `gbp_photo_reference` at **scout** time (one
      Details `photos` field) and skip the per-view Details call. Monitor Places spend.
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
- [x] **F2. Fix pre-existing scout TS errors** — **DONE 9 Jun 2026** (alongside E1, to land
      a clean `tsc --noEmit` before the report commit). `prospect-scout.ts` now types the
      `resolveEntity().catch()` fallback as `EntityResolution` (`{ entityType:'Unknown',
      confidence:'not_found' }`). Whole project typechecks clean.
- [ ] **F3. Pre-go-live hardening** (S) — from the (now-archived) Execution Guide V1:
      run `npm audit fix` on the MCP server and review high-severity items; add `@types/node`
      to the prospecting-engine devDeps/tsconfig so `tsc` runs clean (ties to F2). Do before
      any client data flows.
- [ ] **F4. Mine-then-archive the build-reference docs** — during the Template build (G1) and
      the CKK build (G2), reference `tool-registry-patch.md`, `deploy-locksmith-template.md`,
      and the **Car Key Kings / Workflow Build Guide** docs for any value-add **not yet
      implemented**, fold what's useful into the build, **then archive them**. Kept in place
      for now per Tyler (they describe things not yet built).
- [ ] **F5. Reconcile `Strath_Cloud_Architecture_V1.1 (1).docx` to CLAUDE.md §9** (S) —
      **CLAUDE.md §9 is the canonical infrastructure map.** Do not archive the docx; instead
      reconcile it to §9 (or note the contradictions) so the two don't diverge.

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
- [ ] **G6. Harvest Car Key Kings as social proof → THEN scale** (S–M) — once CKK is live and
      producing results, capture the outcome (reviews lifted, calls/bookings) as the founder
      proof block (ties to E2) and the report's competitor/value framing. Only scale outreach
      after CKK has proven the end-to-end system. (Sequencing confirmed by Tyler.)
- [ ] **G7. Agent swarm for client delivery** (L) — spin up post-close delivery automation,
      tested against the CKK beta first.

Tyler is signing up for a **WhatsApp Business number** this week. **GDPR/PECR boundary:**
**manual** outreach is OK; **automated** cold WhatsApp to individuals/sole traders is **not**
(most UK locksmiths are sole traders; ICO fines up to £17.5m). So **WhatsApp stays in the
prospecting/outreach workflow (manual, gated), NOT on the audit/report page.** Do not add
any WhatsApp automation to the audit flow.
