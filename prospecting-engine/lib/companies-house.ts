// Strath Agency — Companies House API Client
// UK Companies House: https://api.company-information.service.gov.uk
// Free tier: 600 requests/5 min. No key required for search (key improves rate limits).
//
// Entity logic per CLAUDE.md Section 18:
// - Website/GBP name, trading name, Privacy Policy name can all differ.
// - Only Companies House confirms "Ltd". If not found → treat as Sole Trader / Unknown.
// - Match outcome written to entityType and companiesHouseNumber fields in GHL/Neon.
//
// Name variants tried (in order):
//   1. businessName (GBP listing name, as-is)
//   2. businessName + ' Ltd' (handles GBP "Smith Locksmiths" vs CH "Smith Locksmiths Ltd")
//   3. businessName with trade words stripped (handles "Smith Locksmiths" → "Smith")
//   4. tradingName if different from businessName
//   5. websiteExtractedNames[] — additional names found by the audit cron from
//      Privacy Policy, T&C, or operator disclosures on the website
//
// The audit cron is responsible for passing websiteExtractedNames when available.
// The scout passes only businessName and tradingName (no website fetch at scout time).

import type { CompaniesHouseSearchResult, CompaniesHouseItem, EntityType } from './types.js';

const CH_BASE = 'https://api.company-information.service.gov.uk';

// Trade words stripped when building the simplified name variant.
// These appear at the end of trading names but not necessarily in CH records.
const TRADE_WORDS = [
  'locksmiths', 'locksmith', 'locks', 'security', 'locksmithing',
  'services', 'service', 'solutions', 'group', 'company', 'co',
];

export interface EntityResolution {
  entityType: EntityType;
  companiesHouseNumber?: string;
  companiesHouseName?: string;
  confidence: 'confirmed' | 'likely' | 'not_found';
  matchedOn?: string; // which name variant triggered the match
}

// ── Search Companies House ────────────────────────────────────────────────────

async function searchCompaniesHouse(
  query: string,
  apiKey?: string
): Promise<CompaniesHouseItem[]> {
  const url = `${CH_BASE}/search/companies?q=${encodeURIComponent(query)}&items_per_page=5`;
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  // CH accepts API key via Basic Auth with key as username, blank password
  if (apiKey) {
    headers['Authorization'] = `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
  }

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const data = (await res.json()) as CompaniesHouseSearchResult;
    return data.items ?? [];
  } catch {
    return [];
  }
}

// ── Name normaliser ───────────────────────────────────────────────────────────
// Strips legal suffixes, punctuation, and filler words for comparison.

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(ltd|limited|plc|llp|co|company|the|and|&)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesSimilar(a: string, b: string): boolean {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // One is a substring of the other
  // e.g. "Jones Locksmiths" vs "Jones Locksmith Services Ltd"
  if (na.includes(nb) || nb.includes(na)) return true;
  // Word overlap: 2+ significant words (>3 chars) match
  const wordsA = new Set(na.split(' ').filter(w => w.length > 3));
  const wordsB = nb.split(' ').filter(w => w.length > 3);
  const overlap = wordsB.filter(w => wordsA.has(w));
  return overlap.length >= 2;
}

// ── Name variant builder ──────────────────────────────────────────────────────
// Returns deduped list of name strings to try against CH, in priority order.

function buildNameVariants(
  businessName: string,
  tradingName?: string,
  websiteExtractedNames?: string[]
): string[] {
  const variants: string[] = [];
  const seen = new Set<string>();

  const add = (name: string) => {
    const clean = name.trim();
    const key = clean.toLowerCase();
    if (clean && !seen.has(key)) {
      seen.add(key);
      variants.push(clean);
    }
  };

  // 1. GBP name as-is
  add(businessName);

  // 2. GBP name + ' Ltd' (very common: GBP uses trading name, CH has registered name with Ltd)
  if (!/\b(ltd|limited|llp|plc)\b/i.test(businessName)) {
    add(`${businessName} Ltd`);
  }

  // 3. GBP name with trailing trade word stripped
  // e.g. "Smith Locksmiths" → "Smith", "ABC Security Services" → "ABC Security"
  const lower = businessName.toLowerCase();
  for (const word of TRADE_WORDS) {
    const suffix = ` ${word}`;
    if (lower.endsWith(suffix)) {
      const stripped = businessName.slice(0, businessName.length - suffix.length).trim();
      if (stripped.length > 2) {
        add(stripped);
        add(`${stripped} Ltd`);
      }
      break; // only strip the last trade word
    }
  }

  // 4. Trading name if different
  if (tradingName && tradingName.toLowerCase() !== businessName.toLowerCase()) {
    add(tradingName);
    if (!/\b(ltd|limited|llp|plc)\b/i.test(tradingName)) {
      add(`${tradingName} Ltd`);
    }
  }

  // 5. Website-extracted names (from audit cron — Privacy Policy, T&C, operator disclosure)
  for (const name of websiteExtractedNames ?? []) {
    add(name);
    if (!/\b(ltd|limited|llp|plc)\b/i.test(name)) {
      add(`${name} Ltd`);
    }
  }

  return variants;
}

// ── Main resolver ─────────────────────────────────────────────────────────────
// Tries each name variant in order, returns on first confirmed Ltd match.
// If no match found across all variants, returns Unknown.

export async function resolveEntity(
  businessName: string,
  tradingName?: string,
  city?: string,
  apiKey?: string,
  websiteExtractedNames?: string[]
): Promise<EntityResolution> {
  const variants = buildNameVariants(businessName, tradingName, websiteExtractedNames);

  for (const nameVariant of variants) {
    const results = await searchCompaniesHouse(nameVariant, apiKey);

    for (const item of results) {
      // Only active companies
      if (item.company_status !== 'active') continue;

      // Must be a Ltd or LLP type
      const isLimitedType =
        item.company_type.includes('ltd') ||
        item.company_type.includes('limited') ||
        item.company_type.includes('llp') ||
        item.company_type === 'private-limited-company' ||
        item.company_type === 'limited-liability-partnership';

      if (!isLimitedType) continue;

      // Name similarity check
      if (!namesSimilar(item.title, nameVariant)) continue;

      // City validation — loosely reject clear mismatches, don't reject on ambiguity
      if (city && item.address?.locality) {
        const cityLower = city.toLowerCase();
        const addrLower = item.address.locality.toLowerCase();
        if (
          cityLower.length > 3 &&
          addrLower.length > 3 &&
          !addrLower.includes(cityLower) &&
          !cityLower.includes(addrLower)
        ) {
          continue;
        }
      }

      return {
        entityType: 'Ltd',
        companiesHouseNumber: item.company_number,
        companiesHouseName: item.title,
        confidence: 'confirmed',
        matchedOn: nameVariant,
      };
    }

    // CH returned results but none matched — no need to try more variants for this name
    // unless the next variant is substantially different (we still loop to try websiteExtractedNames)
  }

  // No confirmed Ltd match across any variant
  return {
    entityType: 'Unknown',
    confidence: 'not_found',
  };
}

// ── Derive final entity type ──────────────────────────────────────────────────
// Per CLAUDE.md Section 18: if not confirmed Ltd → treat as Unknown for PECR purposes.
// Unknown = email-only outreach. WhatsApp only after Ltd confirmed.

export function deriveEntityType(resolution: EntityResolution): EntityType {
  if (resolution.confidence === 'confirmed') return 'Ltd';
  return 'Unknown';
}
