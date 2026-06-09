# Archive & Reconcile Log

**Date:** 9 June 2026
**Scope:** Documentation reconciliation + archive pass per Tyler's decisions. Worked in the
local master folder (Drive-synced). **Rule honoured:** archived files were **moved** (never
copied) into the existing `ARCHIVE/`; Google-native files were **not touched** (flagged for
Tyler). Docs-only changes — safe to deploy.

> Note on git: `ARCHIVE/`, `*.docx`, `*.gdoc`, `*.xlsx`, `*.pdf` are **gitignored**. So .docx
> moves are filesystem/Drive operations (recorded here, not in the repo), and archiving a
> *tracked* `.md` shows in git as a deletion from the repo while the file persists in the
> Drive-synced `ARCHIVE/`.

---

## 1. Files MOVED to ARCHIVE/ (done)

| File | From → To | Git effect |
|------|-----------|------------|
| `SESSION_2_DEBRIEF.md` | root → `ARCHIVE/` | tracked → **removed from repo**, preserved in ARCHIVE/ |
| `SESSION_3_PROMPT.md` | root → `ARCHIVE/` | tracked → **removed from repo**, preserved in ARCHIVE/ |
| `Strath Implementation Roadmap - 5 May 2026.docx` | root → `ARCHIVE/` | gitignored (fs/Drive move only) |
| `Strath GHL Setup Brief — 27 April 2026.docx` | root → `ARCHIVE/` | gitignored (fs/Drive move only) |
| `Strath_GHL_Execution_Guide_V1 (1).docx` | root → `ARCHIVE/` | gitignored; **reviewed first** (see §5) |

## 2. Files DELETED (done)

| File | Reason |
|------|--------|
| `~$rath GHL Workflow Build Guide — Prospecting Engine — 23 May 2026.docx` (162 B) | Word lock artifact, not a document. |

## 3. Could NOT move — needs Tyler (Google-native)

| File | Why | Action for Tyler |
|------|-----|------------------|
| `CLAUDE.md.gdoc` (180 B) | Google-native stub for the **older, diverged ~26 KB "Google Docs copy" of CLAUDE.md** (stops ~V6/V7). Touching/deleting it on a Drive-synced folder would move/trash the cloud Google Doc. | In Google Drive, **remove or archive the old Google-Docs CLAUDE.md** so only the local plain `CLAUDE.md` (46 KB, canonical) remains. The working folder now has exactly one real `CLAUDE.md`; the `.gdoc` stub is the only remaining pointer to the stale cloud copy. |

## 4. Files UPDATED in place (canonical = local plain `CLAUDE.md`)

| File | Change |
|------|--------|
| `CLAUDE.md` (top) | Added a **`JOBS_TO_BE_DONE.md` pointer** instructing every session to consult + append deferred work. |
| `CLAUDE.md` §9 | **Fixed Drive folder ID** `1ByZ8ApEnaZrglsE0zWT-U0irwiq8Zw82` → `1O8KrLET7vbPsMJw3OpRYT9dAaRtoTwEF` (working Computers-sync folder). |
| `CLAUDE.md` §16 | Reframed the entity protocol: removed the stale **"ICP score +15"**; stated the entity signal's purpose is **compliance/contactability (WhatsApp/text eligibility under PECR), not desirability**; noted code currently uses a +5 delta and the proposed move is pending sign-off. |
| `CLAUDE.md` §17 | Entity-Type rationale reframed to compliance/contactability; documented the **proposed** removal from the 0–100 score (max 100→90 / redistribute), flagged as tier-math-shifting and **not yet applied**. |
| `CLAUDE.md` §10 + 2× warnings | **Build-status reality:** Car Key Kings is **NOT built/live** — it's the first beta, created by cloning the Template once built. Softened the two "live client account" warnings accordingly (kept the don't-build/test-there safety). |
| `CLAUDE.md` §15 | Added a **Reality check (9 Jun 2026)** block: CKK not built/live; strathgrowth.com not fully live (needs branding package + GHL load + launch); outreach intentionally DRAFT (only "Strath - Response Handler" v6 published). |
| `prospecting-engine/lib/scoring.ts` | **Comment-only** reframe of the entity category (compliance/contactability + proposed-move note). **No scoring math changed** (awaiting sign-off). |
| `JOBS_TO_BE_DONE.md` | Added items C2 (entity-signal reframe — exact proposed change), C3 (Companies House contactability assessment), E1 (confirmed visual-proof approach), F3 (pre-go-live hardening), the **G build sequence** (template → CKK beta → strathgrowth → Tier A audit doc → test outreach → agent swarm), and confirmed D1 guarantee removal. |
| `docs/AUDIT_RECONCILIATION.md` | (Earlier in this branch) §C1a page-selection method; §A10 GHL ground-truth. |

## 5. Execution Guide V1 — review before archive (done)

Reviewed `Strath_GHL_Execution_Guide_V1 (1).docx` (566 KB) before moving. It is a historical
step-by-step infra-setup log (Railway/Vercel/Neon/GHL MCP). Substantive content is **already
captured** in `CLAUDE.md` §4 (Railway/MCP) and §13 (MCP schema). The one forward-looking item
not clearly captured — **pre-go-live hardening** (`npm audit fix` on the MCP server; add
`@types/node` so `tsc` runs clean) — was pulled into **`JOBS_TO_BE_DONE.md` F3**. Safe to archive.

## 6. Stale strings — FIXED to canonical (Tyler approved)

| File | Was | Now |
|------|-----|-----|
| `locksmith-template-config.json` entity field | **"Business Entity Type"** / `contact.business_entity_type` / **"Ltd Company"** | **"Entity Type"** / `contact.entity_type` / **"Ltd"** (+ note reframed to compliance/contactability) |
| `locksmith-template-config.json` trade-type note | **"Private Individual"** / **"Commerce"** | **"Private Individuals"** / **"Commercial"** (picklist options were already canonical) |
| `Strath Agency Playbook V2.0.docx` | companion **"Strath Outreach Sequences V1"** | **"…Sequences V2"** — done via targeted in-place docx edit (single contiguous string; zip integrity verified) |

Both files are gitignored (Drive master only) — edits land on Drive, not GitHub.

## 7. Dangling references to moved files (informational — files persist in ARCHIVE/)

Historical citations to the now-archived `SESSION_2_DEBRIEF.md` / `SESSION_3_PROMPT.md` /
Setup Brief / Execution Guide remain in: `docs/AUDIT_RECONCILIATION.md` (§A10.3),
`prospecting-engine/lib/ghl-client.ts`, `prospecting-engine/api/backfill-ghl-contacts.ts`,
`CLAUDE.md` provenance footer. Content stays accurate and the files still exist in `ARCHIVE/`,
so nothing is broken — left as-is to avoid churn.

## 8. Archive candidates — Tyler's decision: KEEP all (do NOT archive)

Tyler ruled these stay in place — they describe value not yet implemented and will be
referenced during the Template + CKK builds, **then** archived (JTBD **F4**).

| File | Decision |
|------|----------|
| `tool-registry-patch.md` (root) | **Keep** — mine during builds, then archive (F4) |
| `deploy-locksmith-template.md` (root) | **Keep** — mine during builds, then archive (F4) |
| `Car Key Kings — Workflow Build Guide.md` (root) | **Keep** — CKK build reference, then archive (F4) |
| `Strath GHL Workflow Build Guide — Prospecting Engine — 23 May 2026.docx` (root) | **Keep** — build reference, then archive (F4) |
| `Strath_Cloud_Architecture_V1.1 (1).docx` (root) | **Keep, do NOT archive.** ⚠️ **CLAUDE.md §9 is the canonical infrastructure map** — reconcile this docx to §9 (or note the contradictions). Tracked as JTBD **F5**. |

**Kept (not proposed):** `Strath Agency Playbook V2.0.docx` (current offer doc — V1 outreach
reference fixed to V2 this pass), `Strath Research Foundation — 27 April 2026.docx` (market data),
`Strath Outreach Sequences V2 - 27 April 2026.docx` (canonical outreach).

---

## 9. Scoring change APPLIED (Tyler approved) — entity → compliance/contactability

Implemented the C2 reframe in code + docs (commit this pass):
- `scoring.ts`: removed `entity` from the score; the 6 remaining categories (raw max **90**)
  are normalised `round(raw/90×100)` → 0–100, tiers/labels unchanged. Added `isWhatsappEligible()`.
- `scout` + `backfill`: set `whatsappEligible` from `entityType` → GHL **"WhatsApp Eligible"**
  (`s9lNKRXq6aVdriqzVxlP`, CHECKBOX "Yes"); persisted to Neon `whatsapp_eligible` (insertProspect).
- `audit`: dropped `entityType` from its re-score.
- `types.ts`/CLAUDE.md §16–17/AUDIT_RECONCILIATION §B updated.
- **Tier-math before/after:** all five documented example profiles stay in the same tier;
  Ltd businesses just lose the old +5 desirability edge. Not material. Typecheck clean
  (only the pre-existing scout `companiesHouseNumber` errors remain — JTBD F2).

## Resolutions (this round)

1. **Entity-signal scoring change** — ✅ APPROVED & **implemented** (see §9).
2. **Archive candidates** (§8) — ✅ Tyler: **keep all**; mine during builds then archive (JTBD F4);
   Cloud Architecture reconciled to §9, not archived (JTBD F5).
3. **Config string fixes** (§6) — ✅ **done** (config + Playbook).
4. **Google-native `CLAUDE.md.gdoc`** (§3) — Tyler will remove the stale cloud copy in Drive himself. **Left untouched.**
