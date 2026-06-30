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
- [ ] **B5. Decide report-link tier gating** (S, decision) — **clarified 9 Jun 2026:** the report
      is **NOT Tier-A-gated**. `api/report.ts` renders live for ANY prospect UUID (no tier/score
      gate in the renderer), and the `report_url` field is written to the GHL contact for **every
      audited prospect** that has a `ghl_contact_id` (audit cron `buildAuditCustomFields`, all tiers
      A/B/C). The only tier gates today: scout→GHL contact + `getProspectsPendingAudit` selection at
      `raw_score >= 40` (includes B), and GHL **opportunity** creation A+B only. The report is also
      not "pre-generated" — it's a live endpoint. **Decide:** if outreach should only ever surface a
      report link for Tier A, gate the `reportUrl` write (or its use in the outreach sequence) by tier.

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
- [ ] **F6. Wire Vercel auto-deploy from `main` (or document CLI-only)** (S) — **observed
      9 Jun 2026:** `git push origin main` did NOT trigger a Vercel production deploy; prod is
      updated only via `vercel --prod` (CLI) and the `strath-agency.vercel.app` alias tracks the
      latest CLI prod deploy, not the latest push. Either connect/repair the Git integration so
      pushes to `main` auto-deploy, or document that prod deploys are manual CLI so a push is never
      assumed live. (Vercel project root directory = `prospecting-engine`; `.vercel` link at repo root.)
- [ ] **F5. Reconcile `Strath_Cloud_Architecture_V1.1 (1).docx` to CLAUDE.md §9** (S) —
      **CLAUDE.md §9 is the canonical infrastructure map.** Do not archive the docx; instead
      reconcile it to §9 (or note the contradictions) so the two don't diverge.

## G. Build sequence — this week (the critical path)

Ordered. Each gate must pass before the next. No prospect is contacted in GHL until G5.

> **⚠️ SEQUENCING DECISION — 17 Jun 2026 (Tyler approved, overrides G1→G2 order below):**
> Live-state check (17 Jun 2026) found **both** sub-accounts already partially built, and
> divergent from this doc:
> - **Locksmith Template** (`AIpGr6E5flDNeru0DH9Z`): 1 pipeline ("Marketing Pipeline," 9 stages
>   — not the documented 8-stage Locksmith Job Pipeline), 7 draft workflows (different names
>   than the 5 listed in G1), 17 custom fields (not 21), 23 tags (not 20, incl. an apparent
>   duplicate "warm lead"/"warm-lead").
> - **Car Key Kings** (`6D4IPXvCT5SOEct8ah0O`): **NOT empty**, contrary to "NOTHING in it" —
>   already has 1 pipeline ("Marketing Pipeline," 9 stages, same name/shape as Template's),
>   6 draft workflows (named "1. New Lead Nurture (Fast 5)…" through "6. Stale Leads" — also
>   not matching G1's documented 5), 1 custom field ("Message"), 5 tags (incl. `mcp-test`,
>   `delete-me` — leftover test artifacts from the May 2026 schema-patch verification).
>
> Given CKK is further along than G1/G2 assumed, **Tyler's call: work directly in CKK going
> forward and treat IT as the template** — build the agent swarm / SOPs there, then clone
> CKK → Locksmith Master Template (reversing the originally-planned clone direction) once
> proven, rather than finishing Template-first and cloning Template → CKK. This **overrides**
> the live-tool "LIVE CLIENT — do not test here" warning and the docs below for this build;
> CKK is being treated as the active build/test environment until further notice. Clean up
> `mcp-test`/`delete-me` tags and reconcile the Marketing Pipeline naming as part of this work,
> not as a separate pass.

- [ ] **G1. Fully build the Locksmith Master Template** (L) — superseded by the sequencing
      decision above for the *current* build (now happening in CKK first). Original spec
      kept for reference / eventual reconciliation:
  - [ ] Verify/add the **"Unknown"** option on the **Entity Type** custom field (GHL UI).
  - [ ] Build the **6 SMS templates** (Missed Call Text-Back, Review Request — First Ask,
        Review Request — Follow-Up, New Inquiry Confirmation, Job Booking Confirmation,
        New Client Welcome).
  - [ ] Build the **5 workflows** (01 Missed Call Text-Back, 02 Review Request Sequence,
        03 New Inquiry Auto-Response, 04 New Client Welcome, 05 Monthly Reporting Reminder).
  - [ ] Build the **8-stage Locksmith Job Pipeline** (New Inquiry → Called Back → Quoted →
        Job Booked → Job Complete → Review Requested → Won → Lost).
  - [ ] **Create the Snapshot** ("Strath Locksmith V1 — May 2026") once the above is verified.
- [ ] **G2. Clone CKK → create/refresh the Locksmith Master Template** (M) — **reversed
      direction per the 17 Jun 2026 decision above.** Build and prove the agent swarm + SOPs
      in CKK first, incl. the premium site rebuild, then clone CKK into the Template as the
      reusable source for future clients (instead of Template → CKK as originally planned).
- [x] **G3. Prospect-report rebrand → Strath v2 brand package** — **DONE 9 Jun 2026.**
      `prospecting-engine/api/report.ts` restyled to the v2 brand in one pass, structure
      unchanged: Slate #15181C base (dark hero + close), Graphite surfaces, warm Stone/Paper
      body, British Racing Green CTA #1F4434 (hover #2E5C46), Honey #C19A52 as a single
      eyebrow highlight; Manrope (display/body) + JetBrains Mono (scores/labels) via Google
      Fonts; served **metallic 3D crest** at `public/strath-crest.png` (159×200, 50KB)
      + monogram favicon `public/strath-monogram.png` + wide-tracked STRATH wordmark. Data
      tiers + Leaflet map pins unified to earthy green #2F7A56 / amber #C19A52 / brick #A4502E
      (single `DATA_*` source). Typecheck clean. Deployed to prod via `vercel --prod` (the
      `git push` to main did NOT auto-deploy — see F6). Smoke-tested live for a populated
      prospect (presence score + rank map shown) and an un-scanned one (both sections hidden
      gracefully; listing card still shows). NOTE: this is the **first surface** of the v2
      brand package — the strathgrowth.com site itself is still to do (G3a).
- [ ] **G3a. strathgrowth.com site rebuild + GHL load + launch** (M) — the remainder of the
      original G3: apply the v2 brand package to the strathgrowth.com site, load into GHL, and
      launch. NOT done — strathgrowth.com is still not fully live (see §15 reality check).
- [ ] **G4. Refine the Tier A audit doc** (S–M) — the audit/report output a prospect receives.
- [ ] **G5. TEST outreach firing end-to-end** (M) — before connecting ANY prospect in GHL.
      Publish the 5-touch sequence / DNC handler only after this passes (today they're drafts;
      only "Strath - Response Handler" v6 is published).
- [ ] **G6. Harvest Car Key Kings as social proof → THEN scale** (S–M) — once CKK is live and
      producing results, capture the outcome (reviews lifted, calls/bookings) as the founder
      proof block (ties to E2) and the report's competitor/value framing. Only scale outreach
      after CKK has proven the end-to-end system. (Sequencing confirmed by Tyler.)
- [x] **G7. Agent swarm for client delivery — design** (L) — **DONE 17 Jun 2026.** Full design
      doc written: `docs/AGENT_SWARM_CLIENT_DELIVERY.md`. Defines the 5-phase post-conversion
      swarm (Trigger & Intake → Sub-Account Customization → Site & Funnel Rebuild → Activation
      → Retention Handoff), the trigger mechanism (`pipeline_stage_changed` → "Sold" stage in
      Strath Ops's Locksmith Prospect Pipeline), and the build blockers below. Tested against
      the CKK beta first per G6 sequencing. Implementation (the actual GHL trigger workflow)
      starts at G7a.
  - [ ] **G7a. Build the Phase 0 trigger workflow** (M) — in Strath Ops, on the **Locksmith
        Prospect Pipeline**, build the `pipeline_stage_changed` → "Sold" stage
        (`26313281-1d1b-417a-8194-9af5d778a9ff`) trigger workflow. On fire: read the contact
        record and write the new sub-account's Location ID into the "GHL Sub-Account ID" field,
        kicking off Phase 1 (Sub-Account Customization). Confirm Strath Ops is the active
        account (`get_active_account`) before any workflow writes.
        **BLOCKED — root cause confirmed 22 Jun 2026, two independent dead ends, no
        programmatic path exists today:**
        1. `mcp__ghl__ghl_create_workflow` → errors `Workflow builder not initialized:
           Workflow builder requires GHL_REFRESH_TOKEN (v2 JWT) or GHL_FIREBASE_API_KEY +
           GHL_FIREBASE_REFRESH_TOKEN`. This is a **separate credential type** from the
           three "active" PIT/Location vars documented in CLAUDE.md §2/§4 — none of
           `GHL_REFRESH_TOKEN`, `GHL_FIREBASE_API_KEY`, `GHL_FIREBASE_REFRESH_TOKEN` are
           in Railway's current var list. Workflow creation via this tool cannot proceed
           until Tyler adds one of these credential pairs to Railway and redeploys.
        2. Fallback attempted via the legacy `mcp__ghl__create_trigger` tool instead →
           errors `GHL API Error (404): Cannot POST /triggers/`. The legacy triggers REST
           endpoint is not available/enabled for this account, so it is not a viable
           workaround either. `get_trigger_types` independently 404s the same way
           (`Cannot GET /triggers/types`), confirming the legacy triggers API is dead for
           this location, not just one endpoint.
        **Net: building G7a requires Tyler to either (a) source/add `GHL_REFRESH_TOKEN` or
        the Firebase API key + refresh token pair to Railway for the workflow builder, or
        (b) build this one workflow manually in the GHL UI** (Automation → Workflows →
        Trigger: Pipeline/Opportunity stage changed → Locksmith Prospect Pipeline → "Sold";
        Action: Create Task assigned to contact owner, instructing the manual sub-account
        clone + "GHL Sub-Account ID" (`q2NZETtXLJT322J6SmAM`) field write-back). Until one
        of these happens, no GHL artifact for G7a/G7e can be created by Claude.
  - [ ] **G7b. "Sold" vs "Closed Won" reconciliation** (S, decision) — the Locksmith Prospect
        Pipeline's live trigger stage is named "Sold," but other docs/templates refer to
        "Closed Won" for the equivalent stage. Decide on one canonical name and reconcile
        references (pipeline stage labels, this doc, the agent-swarm design doc) so the trigger
        condition is unambiguous.
  - [ ] **G7c. Duplicate "Response Handler" workflow cleanup** (S) — more than one "Response
        Handler"-named workflow exists (only "Strath - Response Handler" v6 is published per
        G5). Audit all Response Handler workflows across Strath Ops/CKK/Template, confirm which
        is canonical, archive or delete the rest to avoid double-firing on prospect replies.
  - [ ] **G7d. "Marketing Pipeline" naming collision** (S) — both Strath Ops and CKK have a
        pipeline literally named "Marketing Pipeline," which is easy to confuse with the
        Locksmith Prospect Pipeline used for the G7a trigger. Rename for clarity (e.g.
        per-sub-account prefix) or document the distinction so automation always targets the
        right pipeline by ID, not by name lookup. **Correction — 19 Jun 2026 live check
        (`get_pipelines` in Strath Ops):** Strath Ops's "Marketing Pipeline" (`q4Nr0XPYzcKsWPlmFToJ`)
        actually has **6 stages** (New Lead → Contacted → Qualified → Proposal Sent →
        Negotiation → Closed), not the "9 stages each" recorded in the 17 Jun 2026 sequencing
        note above. CKK's Marketing Pipeline stage count still needs re-verification against
        live data (an earlier session observation also suggested 6, contradicting the 17 Jun
        note) — confirm with `get_pipelines` against the CKK location before relying on the
        9-stage figure anywhere else.
  - [ ] **G7e. Phase 0 trigger must explicitly carry the prospect's INPUT data, not just fire
        on a bare stage-change** (M, flagged 19 Jun 2026) — the `pipeline_stage_changed` →
        "Sold" trigger (G7a) cannot just be a bare event hook; per
        `docs/AGENT_SWARM_CLIENT_DELIVERY.md` Phase 0 ("Trigger & Intake"), the swarm needs
        the prospect's **full contact record (all 60+ custom fields confirmed live via
        `get_location_custom_fields` in Strath Ops on 19 Jun 2026 — e.g. Business Name,
        Website URL, ICP Score/Tier, GBP fields, Outreach Stage, Entity Type, Report
        engagement fields, etc.)** read and passed forward as the swarm's INPUT, with the
        "GHL Sub-Account ID" field (`contact.ghl_subaccount_id`, id `q2NZETtXLJT322J6SmAM`)
        written back as the join key. Build G7a with an explicit data-read/mapping action
        (not just a trigger + bare field write) so Phase 1 (Sub-Account Customization) has
        everything it needs on fire. Blocked on the same `ghl_create_workflow` connection
        issue as G7a — fold into the same workflow build once that tool is restored.

Tyler is signing up for a **WhatsApp Business number** this week. **GDPR/PECR boundary:**
**manual** outreach is OK; **automated** cold WhatsApp to individuals/sole traders is **not**
(most UK locksmiths are sole traders; ICO fines up to £17.5m). So **WhatsApp stays in the
prospecting/outreach workflow (manual, gated), NOT on the audit/report page.** Do not add
any WhatsApp automation to the audit flow.

- [x] **G8. Agent swarm Phases 1–4 built independently of the Phase 0 trigger** (L) —
      **DONE (code complete, UNTESTED live) 23 Jun 2026.** Per Tyler's instruction to keep
      building the swarm while he personally resolves the G7a credential blocker, all four
      post-"Sold" phases from `docs/AGENT_SWARM_CLIENT_DELIVERY.md` are now implemented as
      callable code, decoupled from the blocked GHL trigger:
  - `prospecting-engine/lib/ghl-client.ts` — added `genericRequest<T>()`, a generic escape
    hatch onto the existing private `request()` method, so swarm code can hit GHL REST
    endpoints (e.g. calendar activation) that don't have a dedicated wrapper yet, without
    growing `GhlClient` with one-off methods for rarely-used calls.
  - `prospecting-engine/lib/swarm-types.ts` (prior session) — shared `SwarmInput`/
    `SwarmPhaseResult`/`SwarmStepResult`/`SwarmRunResult` contracts. Steps use a 4-state
    status (`ok` / `skipped` / `manual_required` / `failed`) specifically so every
    automation gap (missing pipeline/stage/calendar-creation API, missing per-client
    workflow clone, missing Monthly Reporting Reminder workflow, missing CKK custom
    fields) is surfaced explicitly in the output instead of silently skipped.
  - `prospecting-engine/lib/swarm-client.ts` (prior session) — CKK ground-truth constants
    (`CKK_LOCATION_ID`, pipeline/stage/tag/calendar/custom-field IDs) + `createCkkClient()`.
  - `prospecting-engine/lib/swarm.ts` (NEW) — `runPhase1()` (upserts CKK contact, writes a
    delivery-start marker to CKK's one custom field, flags missing field provisioning as
    `manual_required`, creates a Marketing Pipeline opportunity), `runPhase2()` (flags the
    site/funnel rebuild itself as `manual_required` — no GHL API for this — and creates a
    3-day-due CKK task using the lite-audit findings as the brief), `runPhase3()` (activates
    CKK's 4 inactive service calendars via `genericRequest`, flags the 5 client-facing
    automations as `manual_required` since they're Template-level workflows with no
    per-client CKK clone yet, moves the opportunity to "Initial Contact"), `runPhase4()`
    (moves the opportunity to "Retention & Referral," flags the Monthly Reporting Reminder
    handoff as `manual_required` since that workflow doesn't exist anywhere yet), and
    `runSwarm()` (orchestrates 1→4, threading the CKK contact/opportunity IDs created in
    Phase 1 through to later phases via each step's `data` field).
  - `prospecting-engine/api/swarm-deliver.ts` (NEW) — `POST /api/swarm-deliver`, the
    intended call site once G7a's trigger is unblocked (point its webhook action here
    instead of duplicating logic). `CRON_SECRET`-protected, same convention as
    `api/prospect-audit.ts`. Returns 200 if `overallSuccess`, 207 if any step needed manual
    follow-up, 500 on a thrown error.
  - `prospecting-engine/scripts/test-swarm-ckk.mjs` (NEW) — manual test harness, same
    `.mjs` convention as `scripts/test-e2e-glasgow.mjs` (`VERCEL_URL`/`CRON_SECRET` env,
    `DRY_RUN` short-circuit, `log()`/`separator()` helpers). Posts a placeholder
    "sold" `SwarmInput` to `/api/swarm-deliver` and prints every phase/step/status.
  - **Verification done:** `npx tsc --noEmit` across the whole `prospecting-engine`
    package passes clean with all 4 new/edited files included — confirms type-correctness
    of every `GhlClient` call site, the `SwarmStepResult`/`SwarmPhaseResult` shapes, and the
    Vercel handler signature. **NOT done — live execution.** `GHL_CKK_PIT` (and optionally
    `GHL_CKK_LOCATION_ID`) is not present in Railway/Vercel env, so `createCkkClient()` will
    throw immediately if `runSwarm()` is actually invoked. No live GHL writes, no live
    Vercel/MCP test run, has occurred against this code. **Tyler must add `GHL_CKK_PIT`**
    (CKK sub-account → Settings → Integrations → Private Integrations) to Vercel/Railway env
    before `node scripts/test-swarm-ckk.mjs` (against a running `vercel dev`) can be run for
    real.
  - **Design note worth flagging:** `SwarmPhaseResult.success` is computed as
    `steps.every(s => s.status === 'ok' || s.status === 'skipped')`, so a phase containing
    any `manual_required` step reports `success: false` even though nothing actually failed.
    `overallSuccess` in `SwarmRunResult` will currently read `false` on every real run today,
    since every phase has at least one `manual_required` step by design (the automation gaps
    listed above). This is intentional (gaps must be visible) but means `overallSuccess`
    should NOT be read as a pass/fail gate as-is — Tyler should decide whether to (a) leave
    it as "fully clean, zero manual follow-up" semantics, or (b) split it into a separate
    `hasFailures` flag distinct from `hasManualSteps`, before this is wired to anything
    user-facing.
  - **Not yet built:** the real Phase 0 trigger handoff (still G7a, Tyler's side) calling
    `/api/swarm-deliver` instead of a manual test payload; per-client workflow cloning via
    `push_snapshot_to_subaccounts` (referenced but not invoked anywhere in `swarm.ts`); the
    Monthly Reporting Reminder workflow itself (Phase 4 handoff target).
  - [ ] **G7f. Webhook URL confirmed in code but deploy/payload status needs Tyler verification**
        (S, flagged 23 Jun 2026 — answering Tyler's "what's the webhook URL" question from a
        separate GHL workflow assistant) — the endpoint exists: `POST /api/swarm-deliver`
        (`prospecting-engine/api/swarm-deliver.ts`), almost certainly reachable at
        `https://strath-agency.vercel.app/api/swarm-deliver` per the F6 prod-alias convention,
        but this has NOT been confirmed live (G8 logged it as "code complete, UNTESTED live"
        the same day it was written). Two things to verify/fix before pointing a real GHL
        webhook action at it:
        1. **Confirm it's actually deployed** — `vercel --prod` must have been run since this
           file was added (per F6, `git push` alone does NOT deploy). Check Vercel dashboard or
           run `curl -X POST https://strath-agency.vercel.app/api/swarm-deliver` (expect 401,
           not 404) to confirm.
        2. **Payload shape mismatch with G7e — RESOLVED 23 Jun 2026 by reading `swarm.ts`
           directly.** `swarm-deliver.ts` only accepts/requires
           `{ strathContactId, businessName, contactEmail, contactPhone? }`, NOT the full 60+
           custom-field contact record G7e says Phase 0 needs. Confirmed by tracing
           `runPhase1()`–`runPhase4()`: they only ever read `businessName`/`contactEmail`/
           `contactPhone` from `input`. `strathContactId` is required by the endpoint's 400
           check but is NOT read anywhere downstream — no field lookup, no write-back. The
           "GHL Sub-Account ID" join-key write-back CLAUDE.md describes (§16) does not happen
           anywhere in this code path yet. `targetLocationId`/`targetPit` exist on the type but
           are unused too — CKK's location/PIT are hardcoded via `swarm-client.ts`'s `CKK`
           constants. **Action for G7a's webhook payload mapping: send only businessName,
           contactEmail, contactPhone, and the contact ID as strathContactId — not the full
           record.** If Tyler wants lite-audit findings (Observation 1/2, quick wins) flowing
           into Phase 2's task body, or a real join-key write-back, that's separate unbuilt
           work, not a payload-mapping fix.
        Auth for the GHL webhook action: header `Authorization: Bearer {CRON_SECRET}` — the
        `CRON_SECRET` value must exist in Vercel env (it currently gates the 401 check) and
        GHL's webhook action needs that exact secret value, not a guess. Also still blocked on
        `GHL_CKK_PIT` missing from Vercel/Railway (G8) — the endpoint will throw immediately on
        any real invocation until Tyler adds it.
  - [ ] **G7g. Sub-account provisioning (create location + clone template + PIT) — answering
        Tyler's "can a workflow create a new subaccount/PIT/clone the template?" question from
        the GHL workflow assistant** (M, flagged 23 Jun 2026). The assistant's answer that
        native GHL workflow action nodes cannot do this is correct — confirmed against CLAUDE.md
        §1 (sub-account creation, snapshot push, and PIT management are Agency-tier operations,
        not workflow actions) and against the full `mcp__ghl__*` tool list, which exposes
        `create_location` / `push_snapshot_to_subaccounts` only as direct agency-level API calls.
        Two corrections to the assistant's "practical pattern," both confirmed live this session:
        1. **The backend half is real and callable today** — `create_location` (agency-level,
           accepts an optional `snapshotId` to seed the new location) and
           `push_snapshot_to_subaccounts` (agency-level) both exist as working tools against the
           live Railway MCP server. This is the "your own provisioning API" the assistant
           described — we don't need to build a new API, we already have agency-tier access to
           the real one.
        2. **But there is currently nothing to clone.** Live-checked `get_snapshots` against
           Strath Agency's companyId (`p6AaPeH80XemmbgxdHWK`) on 23 Jun 2026 — returned zero
           snapshots. This matches CLAUDE.md §15 ("Strath Locksmith V1 — May 2026" snapshot still
           ⬜ pending) but is now confirmed live, not just doc-stated. `push_snapshot_to_subaccounts`
           and `create_location`'s `snapshotId` param have nothing to push until the Locksmith
           Master Template build finishes and a snapshot is actually created from it.
        3. **PIT creation/assignment has no API at all, in any tool list available to this
           project.** The assistant's step 1 phrase "create/assign the PIT" is not automatable —
           per CLAUDE.md §11, PITs are created manually in the GHL UI per sub-account, shown once,
           never retrievable again. Any provisioning flow we build still needs a manual,
           one-time human step (Tyler creates the PIT in GHL UI for the new location) before the
           PIT value can be stored into a custom value/field for Swarm to use. Drop "creates the
           PIT" from the backend's claimed scope — it can only store a PIT Tyler already created.
        4. **Architecture gap:** `lib/swarm.ts` Phase 1 does not do any cloning today — it only
           customizes the already-existing CKK location in place (CKK wasn't created by cloning,
           per the 17 Jun 2026 decision). For real future clients (Slot 3+), Phase 1 needs a fork
           or pre-step that runs `create_location` + `push_snapshot_to_subaccounts` *before* the
           current contact-upsert/opportunity logic — that pre-step doesn't exist in code yet.
           Recommend building it as a separate endpoint (e.g. `/api/provision-subaccount`) rather
           than folding into `swarm-deliver.ts`, since the CKK swarm code structurally assumes the
           sub-account already exists.
        **Net for the GHL build:** the Sold-stage workflow can call our webhook today (G7a), but
        the "create subaccount + clone + PIT" step for *new, non-CKK* clients is blocked on (a)
        finishing the Locksmith Master Template and creating its snapshot, and (b) accepting that
        PIT handoff will always have one manual click in it.
  - [x] **G9. Env var correction + failure/notification semantics fix + CKK swarm readiness
        check (23 Jun 2026, Tyler).** Tyler corrected G8's "missing GHL_CKK_PIT" framing: the
        var was never missing, it was never the right name. CLAUDE.md §2/§4 already documents
        the correct pair — `GHL_STRATH_CARKEY_KINGS` (Location ID) and
        `GHL_STRATH_CARKEY_KINGS_KEY` (PIT). Fixed in `lib/swarm-client.ts`'s `createCkkClient()`
        and in `api/swarm-deliver.ts`'s header comment (both previously referenced the invented
        `GHL_CKK_PIT`/`GHL_CKK_LOCATION_ID`).
        Also: Tyler confirmed the Phase 0 GHL "Sold" trigger workflow is now built and being
        tested in a separate thread — independent of this swarm-delivery code (G7a's blocker is
        being resolved on Tyler's side, not blocked on us).
        **Failure/notification semantics corrected per Tyler's explicit instruction** ("failure
        should mean failure and needs manual review should trigger notification to ME to
        review"). Previously `SwarmPhaseResult.success`/`SwarmRunResult.overallSuccess` were
        `false` whenever ANY step was `manual_required`, conflating "needs Tyler's review" with
        "actually broke." Changed in `lib/swarm-types.ts` + `lib/swarm.ts`:
        - `success` (per phase) and `overallSuccess` (whole run) now depend ONLY on whether any
          step has status `'failed'`. `manual_required` no longer flips these to false.
        - Added `hasManualSteps: boolean` to both `SwarmPhaseResult` and `SwarmRunResult` to
          surface manual-review gaps separately from pass/fail.
        - Added `notifyManualSteps()` in `lib/swarm.ts`, called at the end of `runSwarm()`: it
          collects every `manual_required` step across all 4 phases into one consolidated CKK
          contact task (`ckk.createContactTask`), titled `MANUAL REVIEW NEEDED — {business}
          swarm run (N items)`, due in 2 hours (same review-window convention as CLAUDE.md §16
          Phase 3's response handler). If notification creation itself fails, that IS a real
          failure (flips `overallSuccess` false) — losing the ability to alert Tyler is not an
          acceptable silent gap. Result is pushed into `phases[]` as an extra step so it's
          visible in the run output; `api/swarm-deliver.ts`'s 200/207 status-code split now
          means 200 = no real failures, 207 = something actually failed (not "needs review").
        Verified with `npx tsc --noEmit -p tsconfig.json` — clean, no errors.
        **Answering Tyler's "what needs to happen to fire up the Swarm on CKK" question:**
        1. Confirm `GHL_STRATH_CARKEY_KINGS_KEY` and `GHL_STRATH_CARKEY_KINGS` are actually set
           as **Vercel** env vars (not just Railway) — `createCkkClient()` reads
           `process.env`, which on Vercel is a separate var store from Railway's. This is the
           single remaining blocker confirmed in code; not yet verified against live Vercel
           settings in this session.
        2. Confirm `CRON_SECRET` is set in Vercel (gates `/api/swarm-deliver`'s 401 check) and
           that whatever calls the endpoint (today: `scripts/test-swarm-ckk.mjs` manually; later:
           the GHL trigger Tyler is testing) sends `Authorization: Bearer {CRON_SECRET}`.
        3. Run `scripts/test-swarm-ckk.mjs` once against CKK manually first — per the design
           doc's standing rule, don't wire automatic firing before one manual, phase-checked run
           against CKK. Expect 2 `manual_required` items every run regardless of success
           (CKK field provisioning, client automations needing the snapshot flow) plus a 3rd if
           triggered close to a Phase 4 run (Monthly Reporting workflow doesn't exist yet) — none
           of these block a real `overallSuccess: true`, but Tyler should see the consolidated
           CKK task they generate and confirm the notification task itself actually lands.
        4. No other code blocker — Phases 1-4 are built, typecheck clean, env-var names correct,
           and failure/notification semantics match Tyler's instruction.
- [x] **G9. Manual single-business trigger ("injection pathway") into the prospecting agent** —
      **DONE 30 Jun 2026.** Tyler's request: when a lead/customer reaches out directly for a
      manual review, we need a way to run them through scout → score → audit → GHL push
      on-demand, not wait for the next daily cron (`prospect-scout.ts` 08:00 UTC /
      `prospect-audit.ts` 08:30 UTC). Built as part of the same pass that extracted the shared
      `auditOneProspect()` engine (see G7's swarm work for unrelated context — this is a
      separate, smaller build):
  - `lib/audit-engine.ts` — new shared `auditOneProspect(prospect, ghl, apiKey)` extracted
    from the old inline `prospect-audit.ts` logic so it's callable from both the cron batch
    loop and a synchronous single-business call.
  - `api/prospect-audit.ts` — refactored to a thin batch-queue driver calling
    `auditOneProspect()` per prospect. No behavior change from the prior inline version.
  - `api/prospect-manual.ts` — **new endpoint**, `POST /api/prospect-manual`, manual-only (no
    cron schedule). Body: `{ businessName, city }` (or `{ placeId }` to skip the lookup).
    Same `Authorization: Bearer {CRON_SECRET}` auth pattern as the existing crons. Finds the
    business via Google Places Find Place + Details (single-business equivalent of the
    scout's Nearby Search), relaxes the `locksmith`-category gate since the business is
    explicitly named rather than discovered, runs the normal 3-way dedup
    (place_id/phone/domain) and re-audits in place if a record already exists, then resolves
    entity + scores **unforced** (`scoreProspect()`/`auditOneProspect()` run exactly as they
    would in the normal pipeline — no artificial A-tier), inserts the prospect, and **forces**
    the GHL contact push + a synchronous `auditOneProspect()` call regardless of the normal
    `raw_score >= 40` push threshold (this is an explicit manual review request, not a
    cold-discovery sweep, so the push isn't gated — only the score itself is left honest).
  - `vercel.json` — added a `functions` entry for `api/prospect-manual.ts` (`maxDuration: 60`).
    Deliberately **no** `crons` entry — this is on-demand only.
  - Build verified clean via `npx tsc --noEmit -p tsconfig.json`.
  - **Not yet done:** deploy (commit + push; Vercel prod deploy is manual via `vercel --prod`
    per F6 — a `git push` to `main` does not auto-deploy this project). `CRON_SECRET` must
    never be pasted into Claude chat — Tyler invokes the endpoint himself (e.g. a `curl`
    referencing `$CRON_SECRET` as a shell env var on his own machine) once deployed.
  - **Follow-up still open:** once deployed, run Car Key Kings (Ayr/Ayrshire/Kilmarnock)
    through this pathway with its real, unforced score — the original standing request
    ("run the scout + prospecting as is... I expect them to be an A tier lead but please run
    the scout + prospecting as is") that prompted this build in the first place.
