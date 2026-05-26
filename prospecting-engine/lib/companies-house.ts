// Strath Agency — Companies House API Client
// UK Companies House: https://api.company-information.service.gov.uk
// Free tier: 600 requests/5 min. No key required for search (key improves rate limits).
//
// Entity logic per CLAUDE.md Section 16:
// - Website/GBP name, trading name, Privacy Policy name can all differ.
// - Only Companies House confirms "Ltd". If not found → treat as Sole Trader.
// - Match outcome written to entityType and companiesHouseNumber fields.

import type { CompaniesHouseSearchResult, CompaniesHouseItem, EntityType } from './types.js';

const CH_BASE = 'https://api.company-information.service.gov.uk';

export interface EntityResolution {
  entityType: EntityType;
  companiesHouseNumber?: string;
  companiesHouseName?: string;
  confidence: 'confirmed' | 'likely' | 'not_found';
  matchedOn?: string; // which name variant matched
}

// ── Search Companies House ──────────────────────────────────────────────────

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

// ── Name normaliser ──────────────────────────────────────────────────────────

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
  if (na === nb) return true;
  // One is a substring of the other (handles "Jones Locksmiths" vs "Jones Locksmith Services Ltd")
  if (na.includes(nb) || nb.includes(na)) return true;
  // Simple word overlap: if 2+ significant words match
  const wordsA = new Set(na.split(' ').filter(w => w.length > 3));
  const wordsB = nb.split(' ').filter(w => w.length > 3);
  const overlap = wordsB.filter(w => wordsA.has(w));
  return overlap.length >= 2;
}

// ── Main resolver ─────────────────────────────────────────────────────────────

export async function resolveEntity(
  businessName: string,
  tradingName?: string,
  city?: string,
  apiKey?: string
): Promise<EntityResolution> {
  // Build list of name variants to try
  const namesToTry = [businessName];
  if (tradingName && tradingName !== businessName) namesToTry.push(tradingName);

  for (const nameVariant of namesToTry) {
    const results = await searchCompaniesHouse(nameVariant, apiKey);

    for (const item of results) {
      // Only active companies
      if (item.company_status !== 'active') continue;

      // Must be Ltd or LLP type
      const isLimitedType =
        item.company_type.includes('ltd') ||
        item.company_type.includes('limited') ||
        item.company_type.includes('llp') ||
        item.company_type === 'private-limited-company' ||
        item.company_type === 'limited-liability-partnership';

      if (!isLimitedType) continue;

      // Name similarity check
      if (namesSimilar(item.title, nameVariant)) {
        // If city provided, loosely verify address
        if (city && item.address?.locality) {
          const cityLower = city.toLowerCase();
          const addrLower = item.address.locality.toLowerCase();
          // If cities are clearly different, skip (but don't reject on ambiguity)
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
    }

    // If we got results but no exact match, flag as "likely" sole trader
    if (results.length > 0) {
      return {
        entityType: 'Unknown',
        confidence: 'not_found',
        matchedOn: nameVariant,
      };
    }
  }

  // No results at all — treat as Unknown (conservative)
  return {
    entityType: 'Unknown',
    confidence: 'not_found',
  };
}

// ── Derive final entity type ──────────────────────────────────────────────────
// Per CLAUDE.md: if not confirmed Ltd → treat as Sole Trader for PECR purposes.

export function deriveEntityType(resolution: EntityResolution): EntityType {
  if (resolution.confidence === 'confirmed') return 'Ltd';
  return 'Unknown'; // email-only outreach, no WhatsApp
}
