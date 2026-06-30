// Strath Agency — Shared Lite Audit Engine (Session 2: Claude Sonnet Engine)
//
// Extracted from api/prospect-audit.ts so the same per-prospect audit logic can be
// called from two places:
//   1. The Vercel cron batch endpoint (api/prospect-audit.ts) — DB-queue driven
//   2. The manual single-business trigger (api/prospect-manual.ts) — on-demand
//
// Behavior is unchanged from the original prospect-audit.ts loop body — this is a
// pure extraction, not a rewrite. See that file's history for the audit design notes.
//
// What auditOneProspect() does for a single prospect:
//   1. Fetches homepage HTML — up to 8000 chars passed to Claude Sonnet
//   2. Claude analyses: title, meta, H1, schema, mobile, FAQ, website status, AI visibility
//   3. Classifies website status (None / Basic/Old / Modern / Optimised)
//   4. Recovers phone/email from page contact links if missing
//   5. Detects franchise via homepage/privacy-policy scrape
//   6. Finds nearest competitor (top Google Maps result above this prospect)
//   7. Generates outreach observations + AI hook
//   8. Re-scores with refined signals
//   9. Writes results back to Neon DB and updates the GHL contact + opportunity
//
// Env vars required: ANTHROPIC_API_KEY, GOOGLE_PLACES_API_KEY, NEON_DATABASE_URL,
// GHL sub-account PIT (via createGhlClient()).

import { GHL, buildAuditCustomFields, type GhlClient } from './ghl-client.js';
import {
  updateProspectAudit,
  updateProspectOpportunityId,
  updateProspectGhlIds,
  updateProspectContactInfo,
} from './db.js';
import { scoreProspect, detectFranchiseFromText } from './scoring.js';
import { extractContactFromHtml } from './contact-extraction.js';
import type { WebsiteAuditResult, WebsiteStatus, GbpStatus, Prospect } from './types.js';

// ── Claude Sonnet audit engine ────────────────────────────────────────────────

interface ClaudeAuditJson {
  titleTag: string | null;
  hasTitleTag: boolean;
  titleTagQuality: 'Missing' | 'Generic' | 'Good' | 'Optimised';
  metaDescription: string | null;
  h1Tag: string | null;
  hasH1: boolean;
  hasSchema: boolean;
  schemaTypes: string[];
  hasFaqSection: boolean;
  mobileViewport: boolean;
  hasAddress: boolean;
  hasPhone: boolean;
  agencyWatermark: string | null;
  websiteStatus: 'Basic/Old' | 'Modern' | 'Optimised';
  aiVisibilityScore: number;
  aiVisibilityNotes: string;
}

async function callClaudeAudit(htmlSnapshot: string, url: string): Promise<ClaudeAuditJson | null> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.warn('[audit] ANTHROPIC_API_KEY not set — falling back to rules-based audit');
    return null;
  }

  const prompt = `You are auditing a UK locksmith's website to identify weaknesses that Strath Agency can fix.

WEBSITE URL: ${url}

HOMEPAGE HTML (first 8000 chars):
\`\`\`html
${htmlSnapshot}
\`\`\`

Analyse the HTML and return a JSON object with EXACTLY these keys. No markdown, no explanation — pure JSON only.

{
  "titleTag": "<the exact text content of the <title> tag, or null if missing>",
  "hasTitleTag": <true if a non-empty title tag exists>,
  "titleTagQuality": "<one of: Missing | Generic | Good | Optimised>",
  "metaDescription": "<the meta description content, or null if missing>",
  "h1Tag": "<the first H1 text, or null if missing>",
  "hasH1": <true if a non-empty H1 exists>,
  "hasSchema": <true if any JSON-LD or microdata schema markup exists>,
  "schemaTypes": ["<list of @type values found, e.g. LocalBusiness, LocksmithService>"],
  "hasFaqSection": <true if there is an FAQ section OR FAQPage schema>,
  "mobileViewport": <true if a viewport meta tag is present>,
  "hasAddress": <true if a physical address or UK postcode is present on the page>,
  "hasPhone": <true if a UK phone number is present>,
  "agencyWatermark": "<name of lead-gen platform watermark if present (Checkatrade, Yell, Bark, RatedPeople, MyBuilder, LocalHeroes, TaskRabbit), or null>",
  "websiteStatus": "<one of: Basic/Old | Modern | Optimised>",
  "aiVisibilityScore": <integer 0-10 — how well this site would appear in AI-generated answers>,
  "aiVisibilityNotes": "<2-3 sentence explanation of the AI visibility score>"
}

Scoring guide for titleTagQuality:
- Missing: no title tag or empty
- Generic: title exists but doesn't mention locksmith or location
- Good: mentions locksmith but not a specific location or service
- Optimised: mentions locksmith AND a location or service (e.g. "Emergency Locksmith Glasgow")

Scoring guide for websiteStatus:
- Basic/Old: missing most SEO basics (no viewport, no title, no H1, or site looks like a 2010-era template)
- Modern: mobile-friendly, has title and H1, but weak on SEO/AI signals (no schema, no FAQ)
- Optimised: has schema markup, optimised title, H1, mobile viewport, FAQ section, and NAP data

Scoring guide for aiVisibilityScore (0-10):
- +3 if hasSchema (AI engines index structured data)
- +2 if hasFaqSection (FAQ content is the primary way AI answers local queries)
- +2 if hasAddress AND hasPhone (NAP completeness)
- +1 if mobileViewport
- +1 if metaDescription exists
- +1 if titleTagQuality is Optimised

Return ONLY the JSON object. No markdown fences. No explanation.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`[audit] Claude API error ${response.status}: ${text}`);
      return null;
    }

    const data = (await response.json()) as {
      content: { type: string; text: string }[];
    };

    const text = data.content?.[0]?.text?.trim() ?? '';
    const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(clean) as ClaudeAuditJson;

  } catch (err) {
    console.error('[audit] Claude audit call failed:', err);
    return null;
  }
}

// ── Rules-based fallback audit ────────────────────────────────────────────────

function rulesBasedAudit(html: string, url: string): Omit<ClaudeAuditJson, 'websiteStatus'> & { websiteStatus: WebsiteStatus } {
  const lower = html.toLowerCase();

  const titleMatch = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  const titleTag = titleMatch?.[1]?.trim() ?? null;
  const hasTitleTag = !!titleTag;

  let titleTagQuality: 'Missing' | 'Generic' | 'Good' | 'Optimised' = 'Missing';
  if (titleTag) {
    const tl = titleTag.toLowerCase();
    if (tl.includes('locksmith') && (tl.includes('emergency') || tl.includes('local') || tl.includes('near') || /[a-z]{3,}/.test(tl.replace('locksmith', '')))) {
      titleTagQuality = 'Optimised';
    } else if (tl.includes('locksmith')) {
      titleTagQuality = 'Good';
    } else if (tl.length > 5) {
      titleTagQuality = 'Generic';
    }
  }

  const metaMatch = html.match(/<meta\s+name=["']description["'][^>]*content=["']([^"']{1,300})["']/i)
    ?? html.match(/<meta\s+content=["']([^"']{1,300})["'][^>]*name=["']description["']/i);
  const metaDescription = metaMatch?.[1]?.trim() ?? null;

  const h1Match = html.match(/<h1[^>]*>([^<]{1,200})<\/h1>/i);
  const h1Tag = h1Match?.[1]?.replace(/<[^>]+>/g, '').trim() ?? null;
  const hasH1 = !!h1Tag;

  const schemaMatches = [...html.matchAll(/"@type"\s*:\s*"([^"]+)"/g)];
  const schemaTypes = schemaMatches.map(m => m[1]);
  const hasSchema = schemaTypes.length > 0;

  const hasFaqSection = lower.includes('faq') || lower.includes('frequently asked') || lower.includes('"faqpage"');
  const mobileViewport = lower.includes('name="viewport"') || lower.includes("name='viewport'");
  const hasAddress = lower.includes('street') || lower.includes('postcode') || lower.includes('address') || /\b[a-z]{1,2}\d{1,2}\s*\d[a-z]{2}\b/i.test(html);
  const hasPhone = /(\+44|0\d{4}|\d{5})\s*\d{3,6}\s*\d{3,4}/.test(html) || lower.includes('tel:');

  const agencyMap: Record<string, string> = { 'checkatrade': 'Checkatrade', 'yell.com': 'Yell', 'bark.com': 'Bark', 'rated people': 'RatedPeople', 'mybuilder': 'MyBuilder', 'local heroes': 'LocalHeroes', 'taskrabbit': 'TaskRabbit' };
  let agencyWatermark: string | null = null;
  for (const [key, label] of Object.entries(agencyMap)) {
    if (lower.includes(key)) { agencyWatermark = label; break; }
  }

  let websiteStatus: WebsiteStatus;
  const hasModernSignals = lower.includes('_next/') || lower.includes('gatsby') || lower.includes('nuxt');
  if (!hasTitleTag && !hasH1 && !mobileViewport) websiteStatus = 'Basic/Old';
  else if (hasSchema && mobileViewport && hasTitleTag && titleTagQuality === 'Optimised' && hasH1 && hasFaqSection) websiteStatus = 'Optimised';
  else if (hasModernSignals || (mobileViewport && hasTitleTag && hasH1)) websiteStatus = 'Modern';
  else websiteStatus = 'Basic/Old';

  let aiScore = 0;
  const aiNotes: string[] = [];
  if (hasSchema) { aiScore += 3; aiNotes.push(`Has schema markup (${schemaTypes.slice(0, 3).join(', ')})`); } else aiNotes.push('No schema markup');
  if (hasFaqSection) { aiScore += 2; aiNotes.push('Has FAQ section'); } else aiNotes.push('No FAQ section');
  if (hasAddress && hasPhone) { aiScore += 2; aiNotes.push('Has NAP data'); }
  if (mobileViewport) aiScore += 1;
  if (metaDescription) aiScore += 1;
  if (titleTagQuality === 'Optimised') aiScore += 1;

  return { titleTag, hasTitleTag, titleTagQuality, metaDescription, h1Tag, hasH1, hasSchema, schemaTypes, hasFaqSection, mobileViewport, hasAddress, hasPhone, agencyWatermark, websiteStatus, aiVisibilityScore: Math.min(10, aiScore), aiVisibilityNotes: aiNotes.join('. ') };
}

// ── Website fetcher and auditor ───────────────────────────────────────────────

async function auditWebsite(url: string): Promise<WebsiteAuditResult> {
  const defaultResult: WebsiteAuditResult = {
    url,
    reachable: false,
    hasTitleTag: false,
    titleTagQuality: 'Missing',
    hasH1: false,
    hasSchema: false,
    schemaTypes: [],
    hasFaqSection: false,
    mobileViewport: false,
    hasAddress: false,
    hasPhone: false,
    websiteStatus: 'None',
    aiVisibilityScore: 0,
    aiVisibilityNotes: 'Website unreachable',
  };

  try {
    const cleanUrl = url.startsWith('http') ? url : `https://${url}`;

    const res = await fetch(cleanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StrathAuditBot/1.0)',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return defaultResult;

    const html = await res.text();
    const rawHtmlSnapshot = html.substring(0, 8000);

    const claudeResult = await callClaudeAudit(rawHtmlSnapshot, cleanUrl);
    const analysis = claudeResult ?? rulesBasedAudit(html, cleanUrl);

    if (claudeResult) {
      console.log(`[audit] Claude engine used for ${cleanUrl} — AI score: ${claudeResult.aiVisibilityScore}`);
    } else {
      console.log(`[audit] Rules-based fallback used for ${cleanUrl}`);
    }

    return {
      url: cleanUrl,
      reachable: true,
      titleTag: analysis.titleTag ?? undefined,
      hasTitleTag: analysis.hasTitleTag,
      titleTagQuality: analysis.titleTagQuality,
      metaDescription: analysis.metaDescription ?? undefined,
      h1Tag: analysis.h1Tag ?? undefined,
      hasH1: analysis.hasH1,
      hasSchema: analysis.hasSchema,
      schemaTypes: analysis.schemaTypes,
      hasFaqSection: analysis.hasFaqSection,
      mobileViewport: analysis.mobileViewport,
      hasAddress: analysis.hasAddress,
      hasPhone: analysis.hasPhone,
      agencyWatermark: analysis.agencyWatermark ?? undefined,
      websiteStatus: analysis.websiteStatus as WebsiteStatus,
      aiVisibilityScore: Math.min(10, analysis.aiVisibilityScore),
      aiVisibilityNotes: analysis.aiVisibilityNotes,
      rawHtmlSnapshot,
    };

  } catch (err) {
    return {
      ...defaultResult,
      aiVisibilityNotes: `Fetch error: ${err}`,
    };
  }
}

// ── Franchise detection (audit-time, privacy-policy scrape) ──────────────────

const PRIVACY_LINK_REGEX =
  /<a[^>]+href=["']([^"']+)["'][^>]*>\s*[^<]*\b(privacy|terms|legal|t&cs?)\b/gi;

function resolvePrivacyUrl(homepageHtml: string, homepageUrl: string): string | null {
  const m = PRIVACY_LINK_REGEX.exec(homepageHtml);
  if (!m) return null;
  const href = m[1];
  try {
    return new URL(href, homepageUrl).toString();
  } catch {
    return null;
  }
}

async function detectFranchiseFromSite(
  homepageHtml: string,
  homepageUrl: string
): Promise<{ isFranchise: boolean; matchedTerm: string | null; source: 'homepage' | 'privacy_policy' | 'none' }> {
  const homepageHit = detectFranchiseFromText(homepageHtml);
  if (homepageHit) {
    return { isFranchise: true, matchedTerm: homepageHit, source: 'homepage' };
  }

  const privacyUrl = resolvePrivacyUrl(homepageHtml, homepageUrl);
  if (!privacyUrl) {
    return { isFranchise: false, matchedTerm: null, source: 'none' };
  }

  try {
    const res = await fetch(privacyUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StrathAuditBot/1.0)', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { isFranchise: false, matchedTerm: null, source: 'none' };
    const text = (await res.text()).slice(0, 12000);
    const hit = detectFranchiseFromText(text);
    if (hit) {
      console.log(`[audit] Franchise indicator "${hit}" in privacy policy: ${privacyUrl}`);
      return { isFranchise: true, matchedTerm: hit, source: 'privacy_policy' };
    }
  } catch (err) {
    console.warn(`[audit] Privacy policy fetch failed: ${err}`);
  }
  return { isFranchise: false, matchedTerm: null, source: 'none' };
}

// ── Outreach hook generator ───────────────────────────────────────────────────

async function generateOutreachHook(
  businessName: string,
  city: string,
  obs1: string,
  obs2: string
): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return `I came across ${businessName} while researching locksmiths in ${city}.`;

  const prompt = `Write ONE punchy opening sentence (max 20 words) for a cold outreach email to a locksmith business named "${businessName}" in ${city}, UK.

The email will go on to mention these two specific audit findings:
1. ${obs1}
2. ${obs2}

Rules:
- Sound like a human who noticed something specific — not a bot
- Do NOT use the word "I noticed" — it's overused
- Do NOT use emojis
- Do NOT mention Strath Agency yet
- Sentence must stand alone — the next line will name the findings
- Examples of good style: "Quick question about ${businessName}'s Google presence." / "Something caught my eye on ${businessName}'s website." / "Came across ${businessName} while doing some research in ${city}."

Return only the sentence. No explanation. No quotes.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return `I came across ${businessName} while researching locksmiths in ${city}.`;

    const data = (await response.json()) as { content: { type: string; text: string }[] };
    return data.content?.[0]?.text?.trim() ?? `I came across ${businessName} while researching locksmiths in ${city}.`;
  } catch {
    return `I came across ${businessName} while researching locksmiths in ${city}.`;
  }
}

// ── Nearest competitor lookup ─────────────────────────────────────────────────

async function findNearestCompetitor(
  prospectName: string,
  city: string,
  apiKey: string
): Promise<string | undefined> {
  if (!apiKey) return undefined;
  try {
    const url =
      `https://maps.googleapis.com/maps/api/place/textsearch/json` +
      `?query=locksmith+in+${encodeURIComponent(city)}` +
      `&key=${apiKey}`;
    const res = await fetch(url);
    const data = (await res.json()) as { results: { name: string }[]; status: string };
    if (data.status !== 'OK') return undefined;

    const competitor = data.results.find(
      r => r.name.toLowerCase() !== prospectName.toLowerCase()
    );
    return competitor?.name;
  } catch {
    return undefined;
  }
}

// ── Observation generator ─────────────────────────────────────────────────────

function generateObservations(
  audit: WebsiteAuditResult,
  gbpReviewCount?: number,
  gbpStatus?: GbpStatus
): { obs1: string; obs2: string } {
  const obs: string[] = [];

  if (!audit.reachable) {
    obs.push('your website appears to be down or unreachable');
  } else {
    if (!audit.hasSchema) {
      obs.push('your website has no structured data (schema markup), which means it is invisible to AI search engines like ChatGPT and Google AI');
    }
    if (!audit.mobileViewport) {
      obs.push('your website is not set up for mobile — which is where most emergency locksmith searches happen');
    }
    if (!audit.hasTitleTag || audit.titleTagQuality === 'Missing' || audit.titleTagQuality === 'Generic') {
      obs.push('your page title is not optimised for local locksmith searches');
    }
    if (!audit.hasH1) {
      obs.push('your homepage is missing a main heading (H1), which affects both Google ranking and AI visibility');
    }
    if (!audit.hasFaqSection) {
      obs.push('there is no FAQ section, which is one of the main ways AI tools find and recommend local tradespeople');
    }
    if (audit.agencyWatermark) {
      obs.push(`your website carries a ${audit.agencyWatermark} watermark, which can undermine trust with new customers`);
    }
  }

  if (gbpStatus === 'Unclaimed') {
    obs.push('your Google Business Profile does not appear to be claimed, which means you have no control over how you show up on Google Maps');
  } else if (gbpStatus === 'Claimed - Basic' && (gbpReviewCount ?? 0) < 15) {
    obs.push(`you have ${gbpReviewCount ?? 'very few'} Google reviews — most locksmiths who dominate their area have 40+`);
  } else if ((gbpReviewCount ?? 0) < 15) {
    obs.push(`your Google review count is low (${gbpReviewCount ?? 0}) — this is one of the strongest trust signals for emergency callouts`);
  }

  if (obs.length === 0) {
    obs.push('your online presence has room to improve in AI search visibility');
    obs.push('your local SEO signals could be stronger');
  }

  return {
    obs1: obs[0] ?? 'your website is missing key local SEO signals',
    obs2: obs[1] ?? obs[0] ?? 'your Google Business Profile could be better optimised',
  };
}

// ── Main exported per-prospect audit function ─────────────────────────────────
// Identical behavior to the original prospect-audit.ts loop body. Throws on
// unexpected errors — callers are responsible for catching and persisting
// auditError, matching the original cron's try/catch pattern.

export interface AuditOneResult {
  id: string;
  name: string;
  tier: string;
  obs1: string;
}

export async function auditOneProspect(
  prospect: Prospect,
  ghl: GhlClient,
  apiKey: string
): Promise<AuditOneResult> {
  console.log(`[audit] Auditing: ${prospect.businessName}`);

  const websiteAudit = prospect.websiteUrl
    ? await auditWebsite(prospect.websiteUrl)
    : null;

  let recoveredPhone: string | undefined;
  if (websiteAudit?.reachable && websiteAudit.rawHtmlSnapshot && (!prospect.phone || !prospect.email)) {
    const recovered = extractContactFromHtml(websiteAudit.rawHtmlSnapshot);
    recoveredPhone = recovered.phone ?? undefined;
    if (recovered.phone || recovered.email) {
      await updateProspectContactInfo(prospect.id!, {
        phone: !prospect.phone ? recovered.phone : undefined,
        email: !prospect.email ? recovered.email : undefined,
      });
      console.log(
        `[audit] Contact recovered for ${prospect.businessName} — ` +
        `phone:${recovered.phone ?? '-'} (${recovered.source.phone ?? 'none'}) ` +
        `email:${recovered.email ?? '-'} (${recovered.source.email ?? 'none'})`
      );
    }
  }

  let franchiseFlag: boolean | undefined = prospect.franchiseFlag;
  let franchiseDetectedBy: string | undefined;
  if (websiteAudit?.reachable && websiteAudit.rawHtmlSnapshot && prospect.websiteUrl) {
    const fr = await detectFranchiseFromSite(
      websiteAudit.rawHtmlSnapshot,
      prospect.websiteUrl
    );
    if (fr.isFranchise) {
      franchiseFlag = true;
      franchiseDetectedBy = fr.source === 'privacy_policy' ? 'privacy_policy' : 'homepage_text';
      console.log(`[audit] Franchise detected for ${prospect.businessName} via ${fr.source} ("${fr.matchedTerm}")`);
    }
  }

  const nearestCompetitor = await findNearestCompetitor(
    prospect.businessName,
    prospect.city,
    apiKey
  );

  const { obs1, obs2 } = generateObservations(
    websiteAudit ?? {
      url: '',
      reachable: false,
      hasTitleTag: false,
      titleTagQuality: 'Missing',
      hasH1: false,
      hasSchema: false,
      schemaTypes: [],
      hasFaqSection: false,
      mobileViewport: false,
      hasAddress: false,
      hasPhone: false,
      websiteStatus: 'None',
      aiVisibilityScore: 0,
      aiVisibilityNotes: 'No website',
    },
    prospect.gbpReviewCount,
    prospect.gbpStatus
  );

  const outreachHook = await generateOutreachHook(
    prospect.businessName,
    prospect.city,
    obs1,
    obs2
  );

  const { score, tier, breakdown } = scoreProspect({
    gbpReviewCount: prospect.gbpReviewCount,
    websiteStatus: websiteAudit?.websiteStatus ?? prospect.websiteStatus,
    gbpStatus: prospect.gbpStatus,
    isUrban: true,
    franchiseFlag,
    hasPhone: !!(prospect.phone || recoveredPhone),
  });

  const finalStatus = franchiseFlag && franchiseDetectedBy ? 'flagged' : 'audited';

  await updateProspectAudit(prospect.id!, {
    websiteStatus: websiteAudit?.websiteStatus,
    hasSchema: websiteAudit?.hasSchema,
    hasTitleTag: websiteAudit?.hasTitleTag,
    titleTagQuality: websiteAudit?.titleTagQuality,
    mobileOptimised: websiteAudit?.mobileViewport,
    hasH1: websiteAudit?.hasH1,
    hasFaq: websiteAudit?.hasFaqSection,
    agencyWatermark: websiteAudit?.agencyWatermark,
    nearestCompetitor,
    observation1: obs1,
    observation2: obs2,
    outreachHook,
    icpScore: score,
    icpTier: tier,
    scoreBreakdown: breakdown,
    status: finalStatus,
    franchiseFlag,
    franchiseDetectedBy,
  });

  let ghlContactId = prospect.ghlContactId;
  if (!ghlContactId && prospect.phone) {
    const found = await ghl.findContact(prospect.phone);
    if (found) {
      ghlContactId = found.id;
      await updateProspectGhlIds(prospect.id!, ghlContactId);
      console.log(`[audit] Backfilled ghl_contact_id for ${prospect.businessName}: ${ghlContactId}`);
    }
  }

  if (ghlContactId) {
    const reportBaseUrl = process.env.REPORT_BASE_URL
      ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : 'https://strath-agency.vercel.app');
    const reportUrl = `${reportBaseUrl}/api/report?id=${prospect.id}`;

    const tierTag =
      tier === 'A - Hot (70+)'   ? GHL.TAGS.tierA :
      tier === 'B - Warm (40-69)' ? GHL.TAGS.tierB :
                                    GHL.TAGS.tierC;

    const customFields = buildAuditCustomFields({
      icpScore: score,
      icpTier: tier,
      websiteStatus: websiteAudit?.websiteStatus,
      gbpStatus: prospect.gbpStatus,
      gbpRating: prospect.gbpRating,
      gbpReviewCount: prospect.gbpReviewCount,
      gbpUrl: prospect.gbpUrl,
      entityType: prospect.entityType,
      companiesHouseNumber: prospect.companiesHouseNumber,
      businessName: prospect.businessName,
      websiteUrl: prospect.websiteUrl,
      observation1: obs1,
      observation2: obs2,
      outreachHook,
      nearestCompetitor,
      aiVisibilityScore: websiteAudit?.aiVisibilityScore,
      titleTagQuality: websiteAudit?.titleTagQuality,
      reportUrl,
    });

    await ghl.updateContactFields(ghlContactId, customFields);
    await ghl.addTags(ghlContactId, [tierTag]);
    console.log(`[audit] Updated GHL contact ${ghlContactId} — tier: ${tier}`);

    if (
      (tier === 'A - Hot (70+)' || tier === 'B - Warm (40-69)') &&
      !prospect.ghlOpportunityId
    ) {
      try {
        const ghlOppId = await ghl.createOpportunity({
          name: `${prospect.businessName} — ${prospect.city}`,
          pipelineId: GHL.PIPELINE_ID,
          pipelineStageId: GHL.STAGES.identified,
          contactId: ghlContactId,
          status: 'open',
        });
        await updateProspectOpportunityId(prospect.id!, ghlOppId);
        console.log(`[audit] Created GHL opportunity ${ghlOppId} for ${prospect.businessName}`);
      } catch (oppErr) {
        const errMsg = String(oppErr);
        const existingIdMatch = errMsg.match(/"existingId"\s*:\s*"([^"]+)"/);
        if (existingIdMatch?.[1]) {
          await updateProspectOpportunityId(prospect.id!, existingIdMatch[1]);
          console.log(`[audit] Duplicate opp — backfilled existingId ${existingIdMatch[1]} for ${prospect.businessName}`);
        } else {
          console.error(`[audit] Opportunity creation failed for ${prospect.businessName}:`, oppErr);
        }
      }
    }
  }

  return {
    id: prospect.id!,
    name: prospect.businessName,
    tier,
    obs1,
  };
}
