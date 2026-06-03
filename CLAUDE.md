# STRATH AGENCY — Claude Operational Instructions

## CRITICAL: Read this before touching anything in GHL.

---

## 1. GHL Authentication — Two Entirely Separate Tiers

GHL has two API access tiers that use different credentials and different endpoint paths.
Getting this wrong causes 401 errors. Every time.

---

### TIER 1 — Agency Level (25 endpoints)

**What it is:** Agency-wide operations. Manages the agency account itself, not individual sub-accounts.

**Credentials required:**
- Agency-level Private Integration Token (PIT) — generated at agency level, not inside any sub-account
- No Location ID needed for most agency endpoints

**What you can do at this tier:**
- Create, list, and manage sub-accounts
- Push and manage Snapshots
- Manage agency users
- View SaaS plan data and billing
- Access agency-wide reports

**How to identify an agency-level endpoint:**
The API path contains `/companies/` or `/locations/` with a sub-account creation context.
GHL docs label these as "Agency API" endpoints.

**Auth header:** `Authorization: Bearer {AGENCY_PIT}`

---

### TIER 2 — Sub-Account Level (100+ endpoints)

**What it is:** Everything inside a specific sub-account. Contacts, conversations, workflows,
pipelines, opportunities, calendars, forms, blogs, media, invoices — all of it.

**Credentials required:**
- Sub-account Private Integration Token (PIT) — generated INSIDE the specific sub-account
- Location ID of that sub-account — passed as a path parameter or header in API calls

**IMPORTANT:** Each sub-account has its own PIT. A PIT generated in Strath Ops will 401
if used against Car Key Kings. They are not interchangeable.

**Auth header:** `Authorization: Bearer {SUBACCOUNT_PIT}`
**Location header or path param:** `{LOCATION_ID}`

---

## 2. Railway Env Var Naming Convention

All credentials live in Railway (project: zesty-achievement, service: web, Variables tab).
**Never stored in GitHub, Google Drive, or Claude chat.**

### The three "active" vars — what the MCP server code actually reads on every API call:

**CRITICAL: These three names are hardcoded in the BusyBee MCP server. Do not rename them in Railway or the server will stop finding credentials and break. Only their VALUES change when switching accounts.**

| Var | Role | Notes |
|-----|------|-------|
| `GHL_API_KEY` | Active PIT | Copy from the appropriate stored var below when switching accounts |
| `GHL_BASE_URL` | API base URL | Fixed: `https://services.leadconnectorhq.com` — never change |
| `GHL_LOCATION_ID` | Active Location ID | Copy from the appropriate stored var below — leave blank for agency-level calls |

### The "stored" credential vars — parked in Railway, copied into the active vars when switching accounts:

| Railway Var Name | Type | Account | Tier |
|-----------------|------|---------|------|
| `GHL_AGENCY_KEY` | PIT only | Strath Agency (agency-level access) | AGENCY — 25 endpoints only |
| `GHL_STRATH_STRATHOPS` | Location ID | Strath Agency Ops sub-account | SUBACCOUNT — 100+ endpoints |
| `GHL_STRATH_STRATHOPS_KEY` | PIT | Strath Agency Ops sub-account | SUBACCOUNT — 100+ endpoints |
| `GHL_STRATH_CARKEY_KINGS` | Location ID | Car Key Kings (known value: `6D4IPXvCT5SOEct8ah0O`) | SUBACCOUNT — 100+ endpoints |
| `GHL_STRATH_CARKEY_KINGS_KEY` | PIT | Car Key Kings | SUBACCOUNT — 100+ endpoints |
| `GHL_STRATH_TEMPLATE` | Location ID | Locksmith Master Template | SUBACCOUNT — 100+ endpoints |
| `GHL_STRATH_TEMPLATE_KEY` | PIT | Locksmith Master Template | SUBACCOUNT — 100+ endpoints |

**`GHL_AGENCY_KEY` has no paired location var** — agency-level endpoints do not use a Location ID.

**Naming pattern for future sub-accounts:** `GHL_STRATH_{SUBACCOUNTNAME}` = Location ID, `GHL_STRATH_{SUBACCOUNTNAME}_KEY` = PIT.

### The full account map is in `ghl-account-map.json` in this folder.
That file contains aliases (so "Tony's account" → Car Key Kings), tier classification, var names, and switch instructions. Always check it when resolving an account name.

---

## 3. Known Sub-Accounts and Location IDs

| Sub-Account | Known Location ID | Railway Location Var | Railway PIT Var |
|-------------|-------------------|----------------------|-----------------|
| Strath Agency Ops | See `GHL_STRATH_STRATHOPS` | `GHL_STRATH_STRATHOPS` | `GHL_STRATH_STRATHOPS_KEY` |
| Car Key Kings | `6D4IPXvCT5SOEct8ah0O` | `GHL_STRATH_CARKEY_KINGS` | `GHL_STRATH_CARKEY_KINGS_KEY` |
| Locksmith Master Template | See `GHL_STRATH_TEMPLATE` | `GHL_STRATH_TEMPLATE` | `GHL_STRATH_TEMPLATE_KEY` |
| Client Slot 3+ | Assigned when created | New var per client | New var per client |

**WARNING — Car Key Kings is a live client account.** Do not test automations there. Use Locksmith Master Template for all testing.

**To find a Location ID:** Log into GHL, navigate into the sub-account. The URL reads:
`app.gohighlevel.com/location/{LOCATION_ID}/dashboard`
The string after `/location/` is the Location ID.

---

## 4. Railway MCP Server — What Is Running and What It Knows

**Railway project:** zesty-achievement
**Service URL:** `https://web-production-9311e.up.railway.app`
**GitHub repo (forked MCP):** `https://github.com/tylerspeer-beep/Go-High-Level-MCP-2026-Complete`
**Based on:** BusyBee3333/Go-High-Level-MCP-2026-Complete (563+ GHL tools)

### Environment variables currently in Railway:

| Variable | What it holds | Notes |
|----------|--------------|-------|
| `GHL_API_KEY` | The PIT currently active — set by copying from a stored var | MCP server reads this — name must not change |
| `GHL_BASE_URL` | GHL API base URL | Fixed: `https://services.leadconnectorhq.com` |
| `GHL_LOCATION_ID` | Location ID of the currently active sub-account | MCP server reads this — name must not change |
| `GHL_AGENCY_KEY` | Agency-level PIT (stored reference) | Copy into `GHL_API_KEY` for agency-level work |
| `GHL_STRATH_STRATHOPS` | Strath Agency Ops Location ID (stored reference) | Copy into `GHL_LOCATION_ID` to activate |
| `GHL_STRATH_STRATHOPS_KEY` | Strath Agency Ops PIT (stored reference) | Copy into `GHL_API_KEY` to activate |
| `GHL_STRATH_CARKEY_KINGS` | Car Key Kings Location ID (stored reference) | Copy into `GHL_LOCATION_ID` to activate |
| `GHL_STRATH_CARKEY_KINGS_KEY` | Car Key Kings PIT (stored reference) | Copy into `GHL_API_KEY` to activate |
| `GHL_STRATH_TEMPLATE` | Locksmith Master Template Location ID (stored reference) | Copy into `GHL_LOCATION_ID` to activate |
| `GHL_STRATH_TEMPLATE_KEY` | Locksmith Master Template PIT (stored reference) | Copy into `GHL_API_KEY` to activate |
| `NIXPACKS_NODE_VERSION` | Node.js version for Railway build system | Build config only — not a GHL credential |

**The server only ever operates on ONE account at a time** — whichever values are currently
in `GHL_API_KEY` and `GHL_LOCATION_ID`.

### How to check which sub-account is active:
Railway dashboard → project zesty-achievement → service web → Variables tab.

---

## 5. Decision Tree — Which Credentials Apply to Which Request

When Tyler says anything like "access [account] and do [thing]" or just gives a GHL instruction,
follow this decision tree before calling any tools:

### Step 0: Resolve the account name
Look up Tyler's phrasing against the `aliases` in `ghl-account-map.json` to confirm which
account is being requested. Common aliases: "Strath"/"my account" → Strath Ops,
"Tony"/"Car Key Kings"/"CKK" → Car Key Kings, "template"/"master template" → Locksmith Template.

### Step 1: Check which account is currently active

Call `mcp__ghl__get_active_account` (or `get_active_account`). This returns the active account
name, tier, and Location ID — without revealing any API key values. Always do this before
any GHL tool call unless you are certain the right account is already active.

### Step 2: Is this an agency-level action or a sub-account action?

**Agency-level** (use Agency PIT, no Location ID):
- Creating a new sub-account
- Cloning a Snapshot to a sub-account
- Managing GHL agency users
- Viewing all sub-accounts
- Managing SaaS plans or billing

**Sub-account level** (use sub-account PIT + Location ID) — everything else:
- Contacts, conversations, SMS, email, WhatsApp
- Pipelines and opportunities
- Workflows and automations
- Calendars and appointments
- Forms, funnels, websites
- Blogs, media, invoices, products

### Step 3: Switch if needed — Claude does this, no Railway required

If the active account is not what the request needs, call `switch_account` with the target
account name or alias. The switch takes effect immediately on the next tool call — no Railway
redeploy, no manual copy-paste.

Examples:
- `switch_account({ account: "strath_ops" })` — switch to Strath Agency Ops
- `switch_account({ account: "tony" })` — switch to Car Key Kings
- `switch_account({ account: "agency" })` — switch to agency-level
- `switch_account({ account: "template" })` — switch to Locksmith Master Template

**WARNING:** `car_key_kings` is a live client account. State this clearly to Tyler before
switching to it, and do not test automations there.

### Step 4: Confirm and proceed

After switching, state which account is now active and proceed with the GHL tool calls.
If `switch_account` returns an error (credential not found in Railway), tell Tyler exactly
which Railway env var needs to be added.

---

## 6. Switching Between Sub-Accounts — Claude Does This

The Railway MCP server loads all stored credentials at startup and exposes two account tools:

### `get_active_account`
Returns the currently active account name, tier, and Location ID. Call this to confirm before
any GHL tool call. Never returns raw API key values.

### `switch_account`
Accepts an account key or alias. Updates the active credentials in-memory — the next GHL tool
call immediately uses the new account. No Railway redeploy needed.

**Account keys and accepted aliases:**

| Key | Display Name | Tier | Aliases |
|-----|-------------|------|---------|
| `agency` | Strath Agency (Agency Level) | AGENCY | agency, agency level, company level |
| `strath_ops` | Strath Agency Ops | SUBACCOUNT | strath, strath ops, agency ops, my account, main account |
| `car_key_kings` | Car Key Kings | SUBACCOUNT | ckk, tony, tony's account, car key kings |
| `locksmith_template` | Locksmith Master Template | SUBACCOUNT | template, master template, locksmith template, snapshot source |

**How it works technically:** `createFreshServer()` in `main.ts` reads the module-level
`activeGhlConfig` object at the start of every `/mcp` request. `switch_account` updates that
object. So the switch takes effect on the request immediately following the `switch_account` call.

**What Tyler needs to do instead:** Nothing for in-session switching. If a credential is
missing from Railway entirely (e.g. a new sub-account), Tyler must add that Railway var and
redeploy once. After that, Claude handles all subsequent switching automatically.

**Legacy fallback — if the switch_account tool is not available** (e.g. the patch has not
been deployed yet), Tyler must still do it manually:
1. Go to railway.app → project zesty-achievement → service web → Variables tab
2. Copy the stored Location ID value into `GHL_LOCATION_ID`
3. Copy the stored PIT value into `GHL_API_KEY`
4. Wait for green "Deployed" status (~60-90 seconds)
5. Confirm to Claude and proceed

---

## 7. The GHL MCP Tools Available in This Session

The MCP tools connected to this Cowork session are the `mcp__ghl__*` tools (also visible as
`mcp__9fcb691e-9963-4cf6-8175-5dc3385bfc96__*` — same tools, two references). They connect
to the Railway-hosted MCP server at `https://web-production-9311e.up.railway.app`.

These tools are deferred — load them via ToolSearch before calling. Example:
`ToolSearch("select:mcp__ghl__search_contacts")` before calling `mcp__ghl__search_contacts`.

### Account tools — always available, call these first:
- `mcp__ghl__get_active_account` — check which sub-account is currently active
- `mcp__ghl__switch_account` — switch to any sub-account by key or alias (no Railway redeploy)

### Common GHL tool groupings:
- Contacts: `mcp__ghl__search_contacts`, `mcp__ghl__get_contact`, `mcp__ghl__create_contact`, `mcp__ghl__update_contact`
- Conversations: `mcp__ghl__search_conversations`, `mcp__ghl__get_conversation`, `mcp__ghl__send_sms`, `mcp__ghl__send_email`
- Pipelines: `mcp__ghl__get_pipelines`, `mcp__ghl__get_opportunity`, `mcp__ghl__create_opportunity`, `mcp__ghl__update_opportunity`
- Workflows: `mcp__ghl__ghl_get_workflows`, `mcp__ghl__ghl_get_workflow_full`, `mcp__ghl__ghl_trigger_workflow`
- Calendars: `mcp__ghl__get_calendars`, `mcp__ghl__get_calendar_events`, `mcp__ghl__create_appointment`
- Sub-accounts: `mcp__ghl__get_location`, `mcp__ghl__search_locations`

---

## 8. Why You Are Getting 401 Errors — Root Cause Summary

A 401 from GHL means one of three things:

1. **Wrong sub-account:** Railway `GHL_LOCATION_ID` is set to Strath Ops but you are calling
   a Car Key Kings endpoint or vice versa. The PIT is not authorized for that location.

2. **Wrong tier:** You are using a sub-account PIT to call an agency-level endpoint, or
   an agency PIT to call a sub-account endpoint.

3. **Expired or invalid PIT:** PITs can be regenerated in GHL and the old one stops working.
   If all three env vars look correct and still 401, Tyler needs to regenerate the PIT in GHL
   and update Railway.

**Never retry a 401 call without identifying which of these three applies first.**

---

## 9. Full Infrastructure Map

| Layer | Tool | URL / Location | Purpose |
|-------|------|----------------|---------|
| CRM | GoHighLevel | app.gohighlevel.com | All sub-accounts, automations, conversations |
| MCP Server | Railway (zesty-achievement) | https://web-production-9311e.up.railway.app | Exposes GHL tools to Claude |
| MCP Repo | GitHub | https://github.com/tylerspeer-beep/Go-High-Level-MCP-2026-Complete | Railway deploys from here |
| Frontend / Serverless | Vercel (strath-agency) | strath-agency-8bbpoiyp5-tylerspeer-7800s-projects.vercel.app | Client sites, cron jobs, reporting |
| Database | Neon Postgres | strath-agency-db (London, lhr1) | Prospects, audits, client data |
| Documents | Google Drive | Folder ID: 1ByZ8ApEnaZrglsE0zWT-U0irwiq8Zw82 | All SOPs and docs |

---

## 10. Sub-Account Reference (What Each Is For)

**Strath Agency Ops**
Tyler's operational base. All prospects and outreach live here. The Locksmith Prospect Pipeline
(10 stages) lives here. Outreach sequences fire from here.

**Car Key Kings (Location ID: 6D4IPXvCT5SOEct8ah0O)**
Tony, Ayrshire/Glasgow. First live client. Missed call text-back, review request automations,
and client website. Automations were built and tested here first per the Strath process.

**Locksmith Master Template**
The Snapshot source. Every new locksmith client gets their sub-account cloned from this.
NEVER use this for real client data. Build here, test here, create Snapshot, then clone.
Snapshot name: "Strath Locksmith V1 — May 2026"

**Client Slots 3+**
Each new client after Car Key Kings gets a fresh sub-account cloned from the Snapshot.
Setup time approximately 20 minutes per client.

---

## 11. GHL Private Integrations — Where to Find Credentials

**For sub-account PITs:**
Log into GHL → navigate into the specific sub-account → Settings → Integrations → Private Integrations

**For agency-level PITs:**
Log into GHL at agency level (not inside a sub-account) → Settings → Integrations → Private Integrations

PITs are shown once on creation and never again. If lost, regenerate — the old one is immediately
invalidated. Update Railway env vars immediately after regeneration.

---

## 13. MCP Tool Schema Architecture — How It Works and What Broke

This section documents the root cause of a two-day debugging session (May 2026) and how
it was resolved. Read this if GHL tools are failing with "received undefined" errors or if
Claude appears to have no knowledge of a tool's parameters.

---

### How tool parameters reach Claude — the full pipeline

```
contact-tools.ts       →  tool-registry.ts          →  MCP SDK           →  Cowork proxy  →  Claude
(JSON Schema defined)     (jsonSchemaToZodShape)        (ZodRawShape         (tools/list      (ToolSearch
                          converts to Zod types)         → JSON Schema)       response)        shows params)
```

1. Every tool file (e.g. `src/tools/contact-tools.ts`) defines `inputSchema` as a plain
   JSON Schema object with `properties`, `required`, etc.

2. `ToolRegistry.registerAll()` in `src/tool-registry.ts` calls `server.registerTool()` for
   each tool. The fix adds `inputSchema: jsonSchemaToZodShape(tool.inputSchema)` to that call.
   `jsonSchemaToZodShape` converts the JSON Schema properties into a Zod ZodRawShape
   (e.g. `{ email: z.string(), firstName: z.string().optional() }`).

3. The MCP SDK receives the ZodRawShape and generates JSON Schema from it for the `tools/list`
   MCP protocol response.

4. The Cowork proxy fetches `tools/list` from Railway at session start and caches it.

5. When Claude calls `ToolSearch("select:mcp__ghl__create_contact")`, it gets the schema
   from that cache.

### What was broken before the fix

The original `src/tool-registry.ts` had a stub function `makeZodSchema` that was never
called. `registerTool()` was called without `inputSchema`. The MCP SDK therefore exposed
`{}` (empty schema) for every GHL tool. Claude saw no parameters, sent an empty body, and
GHL rejected the call with a 400 or "received undefined" error.

The `switch_account` and `get_active_account` tools were NOT affected because they are
registered directly in `main.ts` with explicit Zod schemas, bypassing `registerAll()`.

### The fix — two lines in one file

File: `src/tool-registry.ts` in the GitHub repo.

1. Replace `makeZodSchema` (~line 129) with `jsonSchemaToZodShape` (full implementation is in
   `tool-registry-schema-patch/tool-registry.ts` in this workspace folder).

2. Add `inputSchema: jsonSchemaToZodShape(tool.inputSchema)` inside `registerAll()` where
   `server.registerTool()` is called (~line 335).

See `tool-registry-schema-patch/DEPLOY.md` for step-by-step deploy instructions.
See `tool-registry-schema-patch/tool-registry.ts` for the complete patched file.

**Verified working: 22 May 2026.** Test contact created in Car Key Kings:
- Contact ID: `Fj9dUgNYfXll6iSvcRGm`
- Email: `test.mcp@strathagency.com`
- Tags: `mcp-test`, `delete-me`

---

### The Cowork proxy cache issue — and how to fix it

**Symptom:** Claude's `ToolSearch` returns `"properties": {}` for GHL tools even though
Railway is running the correct patched code and the Railway logs show tools registered.

**What's happening:** The Cowork proxy fetches `tools/list` from Railway once at session
start and caches that schema list for the duration of the session. If the Railway schema
patch was deployed AFTER the current Cowork session started, the proxy still serves the
old cached schemas (empty `{}`).

**The fix is one step: start a fresh Cowork session.**

Opening a new Cowork conversation forces the proxy to make a fresh `tools/list` request
to Railway. If Railway is running the patched code, the new session will receive the correct
schemas and all 550+ GHL tools will have their full parameter lists.

**How to confirm schemas are working in the current session:**

```
ToolSearch("select:mcp__ghl__create_contact")
```

If the result shows `"email"`, `"firstName"`, `"lastName"` etc. in properties — schemas
are correct. If it shows `"properties": {}` — start a fresh Cowork session and check again.

**If a fresh session still shows empty schemas**, the patch has not been deployed to Railway.
Check that `src/tool-registry.ts` in the GitHub repo contains `jsonSchemaToZodShape` and
that Railway shows a successful recent deploy.

---

### Diagnostic checklist if GHL tools stop working

1. Check for 401 → see Section 8 (wrong credentials or expired PIT)
2. Check for "received undefined" on tool params → tool schema is empty. Run ToolSearch
   on the failing tool. If `properties: {}`, start a fresh Cowork session.
3. If fresh session still empty → `src/tool-registry.ts` patch is not deployed. See
   `tool-registry-schema-patch/DEPLOY.md`.
4. If schemas look correct but call still fails → verify the correct account is active
   (`get_active_account`) and that the API key hasn't expired.

---

## 12. Compliance Notes (Always Apply)

- Cold email to Ltd companies: OK under PECR
- Cold email to sole traders: requires opt-out and legitimate interest basis
- Cold WhatsApp to anyone without prior contact: HIGH RISK — do not do this
- WhatsApp only after email engagement OR confirmed Ltd company
- Every outreach message must include: Strath identity, opt-out mechanism, business contact
- Tyler's personal number must NEVER be used for any Strath or client outreach
- All outreach must go through GHL-tracked numbers

---

## 14. Backlog — Features and Architectures to Explore

These are ideas uncovered during the build that have real value but were consciously deferred.
Pick these up when the core system is running and there's bandwidth to experiment.

---

### [TBD-001] Webhook Architecture for SMS Automation — Replace GHL SMS Actions

**Context:** The GHL SMS Templates API (`/templates/sms`) is deprecated — returns 404.
The snippets API (`/templates/snippets`) also returns 404. There is NO programmatic way
to create or retrieve stored SMS templates via the GHL REST API. The only option is GHL UI:
Marketing → Templates → SMS.

**What the Messages API IS:** `POST /conversations/messages` sends inline SMS content without
needing a template ID. This is NOT a template management endpoint — it sends a one-off message.
It is the correct API to use when firing SMS from code (Vercel functions, Railway) but cannot
replace stored GHL workflow templates that are referenced by ID inside workflow nodes.

**Better long-term path:** Replace GHL-native SMS workflow actions with a webhook architecture:
1. GHL Trigger fires (missed call, form submit, etc.)
2. Webhook fires to Vercel serverless function (or Railway endpoint)
3. Function calls `POST /conversations/messages` (Messages API) with inline SMS content
4. No template IDs needed. Message content lives in code, not GHL UI.

**Why this is better at scale:** Content changes don't require logging into GHL per client.
Same function handles all clients — just swap Location ID and contact ID. Fully testable
via `mcp__ghl__add_inbound_message` to simulate replies.

**What to explore:**
- Set up a Vercel function that accepts a GHL webhook payload and fires an SMS via Messages API
- Test full outbound → inbound → reply flow using `send_sms` + `add_inbound_message` MCP tools
- Evaluate whether this replaces the workflow SMS action entirely or sits alongside it

**Pre-requisites:** Vercel already provisioned (strath-agency project). Neon DB available.
GHL webhook setup is trivial via `create_webhook` MCP tool.

**Logged:** 22 May 2026

---

### [TBD-002] Custom Field Split — Strath Ops vs. Locksmith Template

**Context:** 7 dropdown/checkbox custom fields were originally specced for the Locksmith Template
but on review most belong in Strath Ops (prospect intelligence) not client sub-accounts.

**Confirmed ownership split:**
- Strath Ops only: Website Status, GBP Status, Business Entity Type, ICP Tier, Outreach Stage
- Locksmith Template only: Active Services
- Both accounts: Business Trade Type (MULTIPLE_OPTIONS — Private Individual, Commerce, Automotive, Residential, Emergency, All/General)

**Action when revisiting:** Verify Strath Ops doesn't already have duplicates of the 5 Ops-only
fields before creating them. Search existing fields via `get_location_custom_fields` on Strath Ops.

**Logged:** 22 May 2026

---

## 15. Build Status Tracker

Current as of 23 May 2026. Update this section as steps are completed.
Legend: ✅ Done | ⏳ In Progress / Needs Verify | ⬜ Pending

---

### Locksmith Master Template (Location ID: AIpGr6E5flDNeru0DH9Z)

**Custom Fields**
- ✅ Business Trade Type — MULTIPLE_OPTIONS, created in Template (Contact object)
- ✅ Active Services — CHECKBOX, created in Template (Contact object, General Info folder)
- ✅ All other template-only fields (Service Area, Avg Job Value, Monthly Call Volume, Google Review Count, Google Review Rating, Monthly Retainer, Billing Day, Client Since, Last Report Sent, Google Review Link) — created in prior sessions

**Location Tags**
- ✅ All 20 tags created

**Pipelines**
- ⬜ Locksmith Job Pipeline — 8 stages (New Inquiry → Called Back → Quoted → Job Booked → Job Complete → Review Requested → Won → Lost)
- NOTE: Locksmith Client Pipeline dropped — redundant with Strath Ops Locksmith Prospect Pipeline

**SMS Templates (6 in Template)**
- ⏳ Missed Call Text-Back — in progress via GHL UI (confirm complete)
- ⏳ Review Request — First Ask — in progress via GHL UI (confirm complete)
- ⏳ Review Request — Follow-Up — in progress via GHL UI (confirm complete)
- ⏳ New Inquiry Confirmation — in progress via GHL UI (confirm complete)
- ⏳ Job Booking Confirmation — in progress via GHL UI (confirm complete)
- ⏳ New Client Welcome — in progress via GHL UI (confirm complete)

**Workflows (5 in Template) — preferred path: GHL AI Workflow Builder**
- ⬜ 01 — Missed Call Text-Back
- ⬜ 02 — Review Request Sequence
- ⬜ 03 — New Inquiry Auto-Response
- ⬜ 04 — New Client Welcome
- ⬜ 05 — Monthly Reporting Reminder

**Snapshot**
- ⬜ "Strath Locksmith V1 — May 2026" — create once all above are done

---

### Strath Agency Ops

**Custom Fields — 43 fields confirmed in Strath Ops as of 23 May 2026**
- ✅ Website Status — SINGLE_OPTIONS [None, Basic/Old, Modern, Optimised]
- ✅ GBP Status — SINGLE_OPTIONS [Unclaimed, Claimed - Basic, Claimed - Optimised]
- ✅ Entity Type — SINGLE_OPTIONS [Ltd, Sole Trader, Partnership, Unknown]
  - NOTE: Named "Entity Type" not "Business Entity Type". Option is "Ltd" not "Ltd Company".
    PECR logic in the agent must check for "Ltd" (not "Ltd Company"). "Unknown" added 23 May 2026.
  - ⚠️ "Unknown" option must be added manually in GHL UI: Settings → Custom Fields → Entity Type → Edit
  - Entity ID complexity: Companies House is the only reliable verification. Trading name, website
    name, operator name, T&C name, and Privacy Policy name can all differ. Agent must cross-reference
    all identifiers. If not found on Companies House, treat as Sole Trader until confirmed.
- ✅ ICP Tier — SINGLE_OPTIONS [A - Hot (70+), B - Warm (40-69), C - Cold (<40)]
- ✅ Outreach Stage — SINGLE_OPTIONS [Not Contacted, In-Sequence, Contacted - No Reply,
    Replied - Positive, Replied - Negative, Booked Call, Proposal Sent, Closed Won,
    Closed Lost, Do Not Contact]
  - NOTE: Better than original spec. Individual email stages tracked via Email 1-5 Sent Date fields.
- ✅ GHL Sub-Account ID — TEXT (created 23 May 2026, fieldKey: contact.ghl_subaccount_id)
- ✅ Notes — LARGE_TEXT (covers Prospect Notes)
- ✅ Companies House Number — TEXT
- ✅ ICP Score — NUMERICAL
- ✅ Business Trade Type — MULTIPLE_OPTIONS [Private Individuals, Commercial, Automotive,
    Residential, Emergency, All/General]
  - NOTE: GHL has "Private Individuals" (plural) and "Commercial" (not "Commerce").
    All docs and agent prompts must use GHL's actual option strings.
- ✅ Additional fields beyond spec: Website URL, GBP URL, GBP Rating, GBP Review Count,
    Has Website, Has Schema, Mobile Optimised, Title Tag Quality, Agency Watermark,
    Franchise Flag, Owner Name, Owner Name Confidence, TPS/CTPS Status, Primary Phone,
    Service Radius, Location/City, Source, Date Identified, WhatsApp Eligible,
    Email 1-5 Sent Date, Last Outreach Date, WhatsApp 1 Sent Date, Response Date,
    Response Channel, Response Type, Sequence Status, Opt Out Date, Business Name,
    Trading Name

**SMS Templates (1 in Strath Ops)**
- ⚠️ Missed Call Text-Back — Strath Outreach — cannot verify via API (deprecated). Manual confirm in GHL UI: Marketing → Templates → SMS

**Email Templates (5-email sequence over 17 days — see Section 16 and locksmith-template-config.json)**
- ⬜ Touch 1 (Day 0): "Quick one about [Business Name]"
- ⬜ Touch 2 (Day 3): "Re: [Business Name]" — short follow-up
- ⬜ Touch 3a (Day 7): "Something changing fast for locksmiths on Google" — email for sole traders/unknown
- ⬜ Touch 4 (Day 10): "Why [Business Name] does not show up when people ask ChatGPT" — AEO one-pager attached
- ⬜ Touch 5 (Day 17): "Closing the loop - [Business Name]" — final, case study reference

**Prospecting Workflows (future build — separate from Template)**
- ⬜ Prospect discovery + grading (see Section 16)
- ⬜ Outreach sequence (5-email + WhatsApp for Ltd companies) — see Section 16
- ⬜ Response handler (fires on any reply — pauses sequence, classifies, notifies Tyler)

---

### Prospecting Agent Prerequisites (what must be done before agents can run)

The following must be complete before the prospecting agent sequence can execute:

1. ✅ GHL MCP tool schemas working (verified 22 May 2026)
2. ✅ Locksmith Template custom fields done
3. ⬜ Strath Ops prospect intelligence fields created and verified
4. ⬜ Strath Ops Outreach Stage field confirmed
5. ⬜ Strath Ops SMS template (Strath Outreach version)
6. ⬜ Strath Ops cold email templates (3 emails — already in config, need to create in GHL)
7. ⬜ Strath Ops prospecting workflows (ingestion, outreach sequence, response handler)
8. ⬜ Snapshot created from Template (needed for client onboarding, not for prospecting itself)

**Immediate unblock:** Custom fields are done. Email templates (5) are the primary build task.
Response handler workflow must exist before any outreach fires.

---

## 16. Prospecting Engine Architecture

This section documents the full prospecting and sales system as designed by Tyler.
This is the north star for all agent builds. Do not deviate without Tyler's sign-off.

---

### Phase 1 — Prospect Discovery (Scheduled Agent)

The prospecting agent runs on a schedule. It is not a basic web scraper — it is an AI
agent using tools (search, scraping, GBP lookup, Companies House) to efficiently source
and evaluate prospects at low to zero cost.

**Flow:**
1. Agent targets a source city (UK locksmith market)
2. Finds ICPs matching criteria (independent locksmiths — not chains, not aggregators)
3. Scores and grades each prospect: A (70+), B (40–69), C (<40) using the ICP Score field
4. Logs every graded prospect to GHL Strath Ops + Google Drive as fallback backup
5. B and C leads: logged and clearly labelled. Held until A leads are exhausted or grading
   is revised. Do not repeat the sourcing work — use what is already there.

**Initial phase (current):** Tyler reviews all A-level leads before outreach fires.
This manual review gate exists to calibrate the model. As confidence grows, Tyler removes
himself from the approval step.

**Future state:** The system operates autonomously once confidence thresholds are met.
No Tyler review needed before outreach. The grading system earns its own trust.

**If A-level leads are insufficient:** Rework the grading criteria — do not lower the bar.
If the pool is too shallow, the ICP definition or geography needs adjustment.

---

### Phase 2 — Lite Audit (A-Level Prospects Only)

Before outreach is approved, every A-level prospect gets a "lite audit."

**What it covers:**
- Website quality: title tags, mobile optimisation, schema, service area pages, page speed
- GBP presence: claimed status, review count and rating, post frequency, categories
- AI search visibility: schema, FAQ, structured data that feeds ChatGPT/Perplexity answers
- Competitive position: who is ranking above them and why

**Output:** A clear, concise audit report written in Tyler's voice. Tyler has direct input
into the AI prompting that generates this report — it is not generic. When we build this
together, Tyler reviews and refines the output on Car Key Kings first.

**Post-audit:** Once approved for outreach, the audit findings populate OBSERVATION_1 and
OBSERVATION_2 in the outreach sequence. The full audit PDF is attached to Touch 4 or
sent on the sales call.

---

### Phase 3 — Outreach Pipeline (5 Emails + WhatsApp for Ltd)

The authoritative sequence is Strath Outreach Sequences V2 (27 April 2026). Summary:

| Touch | Channel | Day | Trigger condition |
|-------|---------|-----|-------------------|
| 1 | Email | Day 0 (Mon 09:00) | All approved prospects |
| 2 | Email | Day 3 (Wed 09:00) | No reply to Touch 1 |
| 3a | Email | Day 7 (09:00) | Sole Traders / Unknown entity |
| 3b | WhatsApp | Day 7 (09:30) | Confirmed Ltd/LLP + CTPS clean only |
| 4 | Email | Day 10 (09:00) | No reply — AEO one-pager attached |
| 5 | Email | Day 17 (09:00) | Final touch — case study reference |
| WA-1 | WhatsApp | 24hr after cold reply | Re-engagement only — NOT cold |

No personal names used in any message (V2 compliance gate). All messages address the
business name. Every message includes identity disclosure (Tyler Speer, Strath) and opt-out.

**Response handler (must exist before outreach starts):**
- Any reply on any channel → immediately pause all sequences for that contact
- Classify: Positive / Neutral / Negative / Unsubscribe
- Positive or Neutral → notify Tyler (push + email) + task due in 2 hours. No auto-reply.
- Negative / Unsubscribe → tag Do Not Contact, remove from all sequences permanently.
  Tyler's personal 2-hour response window is the single biggest conversion variable.

---

### Phase 4 — Sales Process and Pipeline Fork

**On positive response → call booked:**
- Tyler presents the PDF audit findings
- Asks for the sale — aim to close on the call

**Pipeline fork (two distinct stages, not one):**
1. "Interested — closing now or shortly": active pursuit. Tyler follows up within agreed
   timeframe. Pipeline stage: Call Booked → Proposal Sent → Closed Won.
2. "Interested — not now": prospect showed genuine interest but timing is wrong.
   These leads are kept warm — not abandoned. Periodic light-touch nurture (not automated
   spray). Stage: Warm Lead — Not Now. Review monthly.

Both forks must be distinct pipeline stages in GHL so they are never confused.

**Post-close (paid to start):**
- Agent swarm spins up for client delivery (still to be built and tested with Car Key Kings)
- Clone Locksmith Master Template → new sub-account → customise for client
- 20-minute setup target per client once snapshot is proven

---

### Phase 5 — Improvement Cycle

Strath audits its own outreach performance on a defined cadence before making changes.
Work the current flow for a meaningful period before revamping. Decisions are based on
actual data, not instinct.

**Performance gates to track:**
- Open rate by touch (target: Touch 1 > 40%)
- Reply rate by touch (target: Touch 1 > 3%, sequence total > 8%)
- Positive reply rate (target: > 30% of all replies)
- Call booking rate from positive replies (target: > 60%)
- Close rate on calls (target: > 40%)

**If outreach is not converting after meaningful volume (50+ sends per touch):**
- Rotate observations — check for observation fatigue
- Test subject line variants (A/B in GHL)
- Consider a Loom video or Tyler short-form video for Touch 4 or 5 — adds human proof
  without disrupting the current sequence structure
- Document every change and the data that drove it

**If A-level lead volume drops below sustainable levels:**
- Audit ICP scoring criteria — are the weights right?
- Expand geography before lowering the ICP bar
- Review whether specific audit findings (schema, GBP) are better predictors than others

---

### Entity Identification Protocol (for Prospect Agent)

When scoring and logging a prospect, the agent must resolve the entity carefully.
A website claiming to be "Ltd" or "limited" is not sufficient — Companies House is the
only reliable verification. The following identifiers may all differ:

- Website trading name
- Operator name on website
- Privacy Policy / T&C registered company name
- Companies House registered name
- GBP listing name

The agent must attempt to match across all of these. If a Companies House match is found:
tag "Confirmed Ltd", ICP score +15. If not found: tag "Entity Unverified", treat as
Sole Trader, email only. The `Entity Type` field in GHL holds the outcome. The
`Companies House Number` field holds the SC/number if confirmed.

---

---

## 17. ICP Scoring Rubric

Source of truth: `prospecting-engine/lib/scoring.ts`. Do not deviate from these weights without updating both the code and this section.

**Maximum score: 100 points across 6 signal categories.**

---

### Google Review Count (max 25 pts)

| Reviews | Points | Rationale |
|---------|--------|-----------|
| < 15 | 25 | Few reviews = weak reputation = high improvement gap = strong ICP |
| 15 – 40 | 15 | Moderate reviews = some digital maturity |
| 40+ | 5 | Strong review count = already digitally capable, less need for Strath |

---

### Website Status (max 25 pts)

| Status | Points | Rationale |
|--------|--------|-----------|
| None | 25 | No website = maximum opportunity |
| Basic/Old | 20 | Poor website = clear upgrade sell |
| Modern | 10 | Functional but weak SEO/AI signals |
| Optimised | 2 | Already competitive — low conversion likelihood |

Website status is set to `Basic/Old` at scout time (Places API gives no page content). The audit cron upgrades it to `Modern` or `Optimised` after fetching and analysing the homepage.

---

### GBP Status (max 20 pts)

| Status | Points | Rationale |
|--------|--------|-----------|
| Unclaimed | 20 | No control over Maps presence = major pain point |
| Claimed — Basic | 15 | Listed but not optimised |
| Claimed — Optimised | 5 | Already working GBP — less pain |

GBP status is inferred from Places API data completeness at scout time (true "claimed" status is not exposed by the API).

---

### Entity Type (max 10 pts)

| Entity | Points | Notes |
|--------|--------|-------|
| Ltd | 10 | Confirmed via Companies House = WhatsApp eligible, higher commitment |
| Sole Trader / Partnership / Unknown | 5 | Email only per PECR. Unknown is the default until CH confirms. |

**Important:** This is a 5-point delta (10 vs 5), not a 15-point bonus. An earlier version of the spec described "+15 for confirmed Ltd" — that was aspirational and does not match the implemented formula. The confirmed delta is +5.

---

### Urban / Suburban Location (max 10 pts)

| City type | Points |
|-----------|--------|
| Urban (population > ~50k, see `URBAN_CITIES` set in scoring.ts) | 10 |
| Not in urban list | 0 |

The urban city list is hardcoded in `scoring.ts`. Add cities to `URBAN_CITIES` as the geography expands.

---

### Not a Franchise (max 10 pts)

| Flag | Points |
|------|--------|
| Independent (franchiseFlag = false) | 10 |
| Franchise / aggregator detected | 0 |

Franchise detection runs via `detectFranchise()` in `scoring.ts` using a hardcoded keyword list. Prospect filters (`prospect_filters` table) provide a separate, DB-managed suppression layer added in Session 1.

---

### Tier thresholds

| Tier | Score range | Label in GHL / Neon |
|------|-------------|---------------------|
| A — Hot | 70 – 100 | `A - Hot (70+)` |
| B — Warm | 40 – 69 | `B - Warm (40-69)` |
| C — Cold | 0 – 39 | `C - Cold (<40)` |

**Session 1 change:** The scout no longer assigns a real tier at discovery. It stores `raw_score` and sets `icp_tier = 'ungraded'`. The audit cron assigns the confirmed tier after full website analysis. GHL contacts show `Pending Audit` in the ICP Tier field until the audit runs. See `SESSION_1_DEBRIEF.md` for full detail.

---

### Typical score examples

| Profile | Score | Tier |
|---------|-------|------|
| No website, unclaimed GBP, 8 reviews, Ltd, Glasgow | 25+20+20+10+10+10 = **95** | A |
| Basic website, claimed basic GBP, 22 reviews, Unknown, Edinburgh | 15+20+15+5+10+10 = **75** | A |
| Modern website, claimed basic GBP, 30 reviews, Unknown, Aberdeen | 15+10+15+5+10+10 = **65** | B |
| Optimised website, claimed optimised GBP, 60 reviews, Ltd, Glasgow | 5+2+5+10+10+10 = **42** | B |
| Optimised website, claimed optimised GBP, 80 reviews, Ltd, rural | 5+2+5+10+0+10 = **32** | C |

---

## 18. Companies House Multi-Name Lookup

Source of truth: `prospecting-engine/lib/companies-house.ts`. The entity resolution protocol exists because trading names, GBP names, website names, and Privacy Policy names for the same business can all differ. Companies House is the only authoritative source of confirmation.

---

### Why multiple name variants

A locksmith trading as "Smith's Locksmiths" on Google may be registered at Companies House as:
- "S J Smith Ltd"
- "Smith Locksmiths Ltd"
- "Smith Security Services Ltd"

A single-name search misses all of these. The multi-name lookup builds a list of plausible variants and tries each.

---

### Name variants tried (in order)

| Priority | Variant | Example |
|----------|---------|---------|
| 1 | GBP name as-is | `Smith's Locksmiths` |
| 2 | GBP name + ' Ltd' | `Smith's Locksmiths Ltd` |
| 3 | GBP name with trailing trade word stripped | `Smith's` |
| 4 | Stripped name + ' Ltd' | `Smith's Ltd` |
| 5 | Trading name (if different from GBP name) | `Smith Security` |
| 6 | Trading name + ' Ltd' | `Smith Security Ltd` |
| 7+ | Website-extracted names (audit phase only) | `S J Smith Ltd` (from Privacy Policy) |

Trade words stripped from variant 3: `locksmiths`, `locksmith`, `locks`, `security`, `locksmithing`, `services`, `service`, `solutions`, `group`, `company`, `co`. Only the last trade word is stripped per call.

---

### Name similarity algorithm

Two names are considered a match if any of the following is true:

1. **Exact match** after normalisation (lowercase, strip legal suffixes and filler words, strip punctuation)
2. **Substring match** — one normalised name contains the other (handles "Jones Locksmiths" vs "Jones Locksmith Services Ltd")
3. **Word overlap** — 2 or more significant words (> 3 characters) appear in both names

---

### City validation

If a city is provided, the matched CH record's registered address locality is compared loosely. A mismatch is only rejected if both strings are > 3 characters and neither contains the other. Ambiguous or blank address data is not treated as a rejection — the name match takes precedence.

---

### Match outcomes

| Outcome | `entityType` | `confidence` | Behaviour |
|---------|-------------|--------------|-----------|
| Active Ltd/LLP found with name match | `Ltd` | `confirmed` | WhatsApp eligible. 10 pts in ICP score. CH number written to `companies_house_number` field. |
| Results returned but no name match | `Unknown` | `not_found` | Email only. Treat as Sole Trader per PECR. |
| No CH results at all | `Unknown` | `not_found` | Email only. Entity re-evaluated if more name data arrives from audit. |

---

### When website-extracted names are used

The scout runs `resolveEntity()` with only `businessName` and `tradingName` — no website fetch at scout time. The audit cron is responsible for:

1. Fetching the homepage and Privacy Policy page
2. Extracting any company name found in legal disclosures (e.g. "Operated by Smith Security Services Ltd")
3. Passing those names as `websiteExtractedNames[]` to a second call to `resolveEntity()`
4. Updating `entity_type`, `companies_house_number`, and `companies_house_name` in Neon and GHL if a confirmed match is found

**This website-extraction step is not yet implemented in the audit cron.** It is the Session 2 entity enrichment target. Until then, all entities found only by website name remain `Unknown`.

---

### Adding new name variants without a code change

Pass additional names via the `websiteExtractedNames` parameter. The function deduplicates all variants internally. Variants are tried in order, stopping at the first confirmed match.

---

*Last updated: 1 June 2026 — V7 adds Section 17 (ICP Scoring Rubric derived from scoring.ts) and Section 18 (Companies House Multi-Name Lookup). Corrects "+15 for Ltd" to the actual "+5 delta". Documents Session 1 raw_score / ungraded tier separation. Updates CH lookup to try 4+ name variants per prospect (was 2). Adds websiteExtractedNames param for audit-phase entity enrichment.*
*V6 adds Section 16: Prospecting Engine Architecture,*
*updates Section 15 with full Strath Ops field audit (43 fields confirmed), adds Entity Type*
*protocol, fixes SMS API documentation (both /templates/sms and /templates/snippets are 404),*
*updates email sequence to correct 5-email/17-day V2 spec. V5 adds Section 15 Build Status.*
*V4 adds Section 14 Backlog. V3 adds Section 13 MCP schema architecture. V2 adds switch_account.*
*Original sources: Strath GHL Setup Brief, Cloud Architecture V1.1, GHL Execution Guide V1,*
*Car Key Kings Workflow Build Guide.*
