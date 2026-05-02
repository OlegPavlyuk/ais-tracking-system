export type MatchMethod = 'imo' | 'mmsi' | 'name_candidate';

export type SanctionsStatus = 'clear' | 'candidate' | 'sanctioned';

export interface SanctionCandidate {
  entityId: string;
  source: string;
  sourceEntityId: string;
  name: string;
  imo: string | null;
  mmsi: string | null;
  aliases: string[];
  flag: string | null;
  listingDate: string | null;
}

export interface MatchInput {
  imo: string | null;
  mmsi: string | null;
  name: string | null;
}

export interface SanctionMatch {
  entityId: string;
  source: string;
  sourceEntityId: string;
  name: string;
  matchMethod: MatchMethod;
  aliases: string[];
  flag: string | null;
  listingDate: string | null;
}

export interface MatchResult {
  status: SanctionsStatus;
  matches: SanctionMatch[];
}

export function normalizeName(input: string | null | undefined): string {
  if (!input) return '';
  const stripped = input.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const cleaned = stripped.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return cleaned;
}

const toMatch = (row: SanctionCandidate, method: MatchMethod): SanctionMatch => ({
  entityId: row.entityId,
  source: row.source,
  sourceEntityId: row.sourceEntityId,
  name: row.name,
  matchMethod: method,
  aliases: row.aliases,
  flag: row.flag,
  listingDate: row.listingDate,
});

const compareStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const byMatchOrder = (a: SanctionMatch, b: SanctionMatch): number =>
  compareStr(a.source, b.source) ||
  compareStr(a.sourceEntityId, b.sourceEntityId) ||
  compareStr(a.entityId, b.entityId);

export function match(input: MatchInput, candidates: SanctionCandidate[]): MatchResult {
  const seen = new Set<string>();
  const out: SanctionMatch[] = [];

  if (input.imo) {
    const imoMatches = candidates
      .filter((c) => c.imo !== null && c.imo === input.imo)
      .map((c) => toMatch(c, 'imo'))
      .sort(byMatchOrder);
    for (const m of imoMatches) {
      if (!seen.has(m.entityId)) {
        seen.add(m.entityId);
        out.push(m);
      }
    }
  }

  if (input.mmsi) {
    const mmsiMatches = candidates
      .filter((c) => c.mmsi !== null && c.mmsi === input.mmsi)
      .map((c) => toMatch(c, 'mmsi'))
      .sort(byMatchOrder);
    for (const m of mmsiMatches) {
      if (!seen.has(m.entityId)) {
        seen.add(m.entityId);
        out.push(m);
      }
    }
  }

  if (out.length > 0) {
    return { status: 'sanctioned', matches: out };
  }

  const normalized = normalizeName(input.name);
  if (normalized.length > 0) {
    const nameMatches = candidates
      .filter((c) => {
        if (normalizeName(c.name) === normalized) return true;
        return c.aliases.some((a) => normalizeName(a) === normalized);
      })
      .map((c) => toMatch(c, 'name_candidate'))
      .sort(byMatchOrder);
    for (const m of nameMatches) {
      if (!seen.has(m.entityId)) {
        seen.add(m.entityId);
        out.push(m);
      }
    }
  }

  if (out.length === 0) return { status: 'clear', matches: [] };
  return { status: 'candidate', matches: out };
}
