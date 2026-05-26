// Strath Agency — Lite Audit Function
// Vercel function: POST /api/prospect-audit
// Also callable internally by the scout cron for same-run auditing.
//
// What it does per prospect:
//   1. Fetches homepage HTML — checks title, meta, H1, schema, mobile viewport, FAQ signals
//   2. Classifies website status (None / Basic/Old / Modern / Optimised)
//   3. Derives AI visibility score (0–10) based on schema + FAQ + structured content
//   4. Finds nearest competitor (top Google Maps result above this prospect)
//   5. Generates observation_1 and observation_2 — the specific findings used in outreach Touch 1
//   6. Writes results back to Neon DB and updates the GHL contact custom fields
//
// Called by: Vercel cron (POST /api/prospect-audit?batch=10), or manually per prospect
// Protected: Authorization: Bearer {CRON_SECRET}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createGhlClient, buildProspectCustomFields } from '../lib/ghl-client.js';
import {
  getProspectsPendingAudit,
  updateProspectAudit,
} from '../lib/db.js';
import { scoreProspect } from '../lib/scoring.js';
import type { WebsiteAuditResult, WebsiteStatus, GbpStatus } from '../lib/types.js';

// ── Website fetcher and auditor ───────────────────────────────────────────────

async function auditWebsite(url: string): Promise<WebsiteAuditResult> {
  const defaultResult: WebsiteAuditResult = {
    url,
    reachable: false,
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
    // Ensure URL has protocol
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
    const rawHtmlSnapshot = html.substring(0, 5000);
    const lower = html.toLowerCase();

    // ── Title tag ──
    const titleMatch = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
    const titleTag = titleMatch?.[1]?.trim();
    const hasTitleTag = !!titleTag;

    // Title quality check
    let titleTagQuality = 'Missing';
    if (titleTag) {
      const tl = titleTag.toLowerCase();
      if (tl.includes('locksmith') && (tl.includes('emergency') || tl.includes('local') || tl.includes('near'))) {
        titleTagQuality = 'Optimised';
      } else if (tl.includes('locksmith')) {
        titleTagQuality = 'Good';
      } else if (tl.length > 5) {
        titleTagQuality = 'Generic';
      }
    }

    // ── Meta description ──
    const metaMatch = html.match(/<meta\s+name=["']description["'][^>]*content=["']([^"']{1,300})["']/i)
      ?? html.match(/<meta\s+content=["']([^"']{1,300})["'][^>]*name=["']description["']/i);
    const metaDescription = metaMatch?.[1]?.trim();

    // ── H1 ──
    const h1Match = html.match(/<h1[^>]*>([^<]{1,200})<\/h1>/i);
    const h1Tag = h1Match?.[1]?.replace(/<[^>]+>/g, '').trim();
    const hasH1 = !!h1Tag;

    // ── Schema markup ──
    const schemaMatches = html.matchAll(/"@type"\s*:\s*"([^"]+)"/g);
    const schemaTypes = [...schemaMatches].map(m => m[1]);
    const hasSchema = schemaTypes.length > 0;

    // ── FAQ section ──
    const hasFaqSection =
      lower.includes('faq') ||
      lower.includes('frequently asked') ||
      lower.includes('"faqpage"') ||
      lower.includes("'faqpage'");

    // ── Mobile viewport ──
    const mobileViewport =
      lower.includes('name="viewport"') ||
      lower.includes("name='viewport'");

    // ── Address / phone signals ──
    const hasAddress =
      lower.includes('street') ||
      lower.includes('postcode') ||
      lower.includes('address') ||
      /\b[a-z]{1,2}\d{1,2}\s*\d[a-z]{2}\b/i.test(html); // UK postcode pattern
    const hasPhone =
      /(\+44|0\d{4}|\d{5})\s*\d{3,6}\s*\d{3,4}/.test(html) ||
      lower.includes('tel:');

    // ── Agency watermark ──
    const agencyKeywords: Record<string, string> = {
      'checkatrade': 'Checkatrade',
      'yell.com': 'Yell',
      'bark.com': 'Bark',
      'rated people': 'RatedPeople',
      'mybuilder': 'MyBuilder',
      'local heroes': 'LocalHeroes',
      'taskrabbit': 'TaskRabbit',
    };
    let agencyWatermark: string | undefined;
    for (const [key, label] of Object.entries(agencyKeywords)) {
      if (lower.includes(key)) { agencyWatermark = label; break; }
    }

    // ── Classify website status ──
    let websiteStatus: WebsiteStatus;
    const hasModernSignals =
      lower.includes('react') ||
      lower.includes('vue') ||
      lower.includes('next.js') ||
      lower.includes('_next/') ||
      lower.includes('gatsby');
    const hasOptimisedSignals =
      hasSchema &&
      mobileViewport &&
      hasTitleTag &&
      titleTagQuality === 'Optimised' &&
      hasH1;

    if (!hasTitleTag && !hasH1 && !mobileViewport) {
      websiteStatus = 'Basic/Old';
    } else if (hasOptimisedSignals && hasFaqSection) {
      websiteStatus = 'Optimised';
    } else if (hasModernSignals || (mobileViewport && hasTitleTag && hasH1)) {
      websiteStatus = 'Modern';
    } else {
      websiteStatus = 'Basic/Old';
    }

    // ── AI visibility score (0–10) ──
    let aiScore = 0;
    const aiNotes: string[] = [];
    if (hasSchema) {
      aiScore += 3;
      aiNotes.push(`Has schema markup (${schemaTypes.slice(0, 3).join(', ')})`);
    } else {
      aiNotes.push('No schema markup — invisible to AI search');
    }
    if (hasFaqSection) { aiScore += 2; aiNotes.push('Has FAQ section'); }
    else aiNotes.push('No FAQ section');
    if (hasAddress && hasPhone) { aiScore += 2; aiNotes.push('Has NAP data'); }
    if (mobileViewport) aiScore += 1;
    if (metaDescription) aiScore += 1;
    if (titleTagQuality === 'Optimised') aiScore += 1;

    return {
      url: cleanUrl,
      reachable: true,
      titleTag,
      metaDescription,
      h1Tag,
      hasSchema,
      schemaTypes,
      hasFaqSection,
      mobileViewport,
      hasAddress,
      hasPhone,
      agencyWatermark,
      websiteStatus,
      aiVisibilityScore: Math.min(10, aiScore),
      aiVisibilityNotes: aiNotes.join('. '),
      rawHtmlSnapshot,
    };

  } catch (err) {
    return {
      ...defaultResult,
      aiVisibilityNotes: `Fetch error: ${err}`,
    };
  }
}

// ── Nearest competitor lookup ─────────────────────────────────────────────────
// Simple: search Google Places for "locksmith {city}" and take the #1 result
// that is NOT the prospect itself.

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
// Generates the two specific findings used in outreach Touch 1.
// Must be specific, never generic — these go straight into the email.

function generateObservations(
  audit: WebsiteAuditResult,
  gbpReviewCount?: number,
  gbpStatus?: GbpStatus
): { obs1: string; obs2: string } {
  const obs: string[] = [];

  // Website findings (most impactful first)
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

  // GBP findings
  if (gbpStatus === 'Unclaimed') {
    obs.push('your Google Business Profile does not appear to be claimed, which means you have no control over how you show up on Google Maps');
  } else if (gbpStatus === 'Claimed - Basic' && (gbpReviewCount ?? 0) < 15) {
    obs.push(`you have ${gbpReviewCount ?? 'very few'} Google reviews — most locksmiths who dominate their area have 40+`);
  } else if ((gbpReviewCount ?? 0) < 15) {
    obs.push(`your Google review count is low (${gbpReviewCount ?? 0}) — this is one of the strongest trust signals for emergency callouts`);
  }

  // Fallback if nothing specific found
  if (obs.length === 0) {
    obs.push('your online presence has room to improve in AI search visibility');
    obs.push('your local SEO signals could be stronger');
  }

  return {
    obs1: obs[0] ?? 'your website is missing key local SEO signals',
    obs2: obs[1] ?? obs[0] ?? 'your Google Business Profile could be better optimised',
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers['authorization'];
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const batchSize = parseInt(String(req.query.batch ?? '5'), 10);
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? '';

  console.log(`[audit] Starting batch of ${batchSize}`);

  const prospects = await getProspectsPendingAudit(batchSize);
  const results: { id: string; name: string; tier: string; obs1: string }[] = [];

  const ghl = createGhlClient();

  for (const prospect of prospects) {
    try {
      console.log(`[audit] Auditing: ${prospect.businessName}`);

      // Website audit
      const websiteAudit = prospect.websiteUrl
        ? await auditWebsite(prospect.websiteUrl)
        : null;

      // Nearest competitor
      const nearestCompetitor = await findNearestCompetitor(
        prospect.businessName,
        prospect.city,
        apiKey
      );

      // Generate observations
      const { obs1, obs2 } = generateObservations(
        websiteAudit ?? {
          url: '',
          reachable: false,
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

      // Re-score with refined website status
      const { score, tier, breakdown } = scoreProspect({
        gbpReviewCount: prospect.gbpReviewCount,
        websiteStatus: websiteAudit?.websiteStatus ?? prospect.websiteStatus,
        gbpStatus: prospect.gbpStatus,
        entityType: prospect.entityType,
        isUrban: true,
        franchiseFlag: prospect.franchiseFlag,
      });

      // Update Neon DB
      await updateProspectAudit(prospect.id!, {
        websiteStatus: websiteAudit?.websiteStatus,
        hasSchema: websiteAudit?.hasSchema,
        hasTitleTag: !!websiteAudit?.titleTag,
        titleTagQuality: websiteAudit
          ? (websiteAudit.titleTag
              ? (websiteAudit.titleTag.toLowerCase().includes('locksmith') ? 'Good' : 'Generic')
              : 'Missing')
          : undefined,
        mobileOptimised: websiteAudit?.mobileViewport,
        hasH1: websiteAudit?.hasH1,
        hasFaq: websiteAudit?.hasFaqSection,
        agencyWatermark: websiteAudit?.agencyWatermark,
        nearestCompetitor,
        observation1: obs1,
        observation2: obs2,
        icpScore: score,
        icpTier: tier,
        scoreBreakdown: breakdown,
        status: 'audited',
      });

      // Push refined audit data to GHL contact
      if (prospect.ghlContactId) {
        const customFields = buildProspectCustomFields({
          icpScore: score,
          icpTier: tier,
          websiteStatus: websiteAudit?.websiteStatus,
          gbpStatus: prospect.gbpStatus,
          gbpRating: prospect.gbpRating,
          gbpReviewCount: prospect.gbpReviewCount,
          entityType: prospect.entityType,
          companiesHouseNumber: prospect.companiesHouseNumber,
          observation1: obs1,
          observation2: obs2,
          nearestCompetitor,
          city: prospect.city,
        });

        await ghl.updateContactFields(prospect.ghlContactId, customFields);
        console.log(`[audit] Updated GHL contact ${prospect.ghlContactId}`);
      }

      results.push({
        id: prospect.id!,
        name: prospect.businessName,
        tier,
        obs1,
      });

    } catch (err) {
      console.error(`[audit] Error auditing ${prospect.businessName}:`, err);
    }
  }

  return res.status(200).json({
    audited: results.length,
    results,
  });
}
