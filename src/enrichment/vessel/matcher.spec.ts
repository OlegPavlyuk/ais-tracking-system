import {
  match,
  normalizeName,
  MatchInput,
  SanctionCandidate,
  MatchResult,
} from './matcher';

const baseRow = (over: Partial<SanctionCandidate>): SanctionCandidate => ({
  entityId: 'e-default',
  source: 'ofac',
  sourceEntityId: 'sid-default',
  name: 'DEFAULT',
  imo: null,
  mmsi: null,
  aliases: [],
  flag: null,
  listingDate: null,
  ...over,
});

describe('normalizeName', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeName('M/V "Artavil"')).toBe('m v artavil');
  });

  it('strips diacritics', () => {
    expect(normalizeName('Cañón Búho')).toBe('canon buho');
  });

  it('returns empty string for null/undefined/whitespace', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
    expect(normalizeName('   ')).toBe('');
  });
});

describe('match', () => {
  it('returns clear with no matches when input has nothing identifying', () => {
    const result = match({ imo: null, mmsi: null, name: null }, []);
    expect(result).toEqual<MatchResult>({ status: 'clear', matches: [] });
  });

  it('returns clear when sanctions table is empty even with full input', () => {
    const result = match({ imo: '9187629', mmsi: '572469210', name: 'Artavil' }, []);
    expect(result.status).toBe('clear');
    expect(result.matches).toEqual([]);
  });

  it('flags sanctioned on exact IMO match', () => {
    const row = baseRow({ entityId: 'e1', sourceEntityId: '15036', name: 'ARTAVIL', imo: '9187629' });
    const result = match({ imo: '9187629', mmsi: null, name: null }, [row]);
    expect(result.status).toBe('sanctioned');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      entityId: 'e1',
      source: 'ofac',
      sourceEntityId: '15036',
      name: 'ARTAVIL',
      matchMethod: 'imo',
    });
  });

  it('flags sanctioned on exact MMSI match', () => {
    const row = baseRow({ entityId: 'e2', sourceEntityId: '15036', mmsi: '572469210', name: 'ARTAVIL' });
    const result = match({ imo: null, mmsi: '572469210', name: null }, [row]);
    expect(result.status).toBe('sanctioned');
    expect(result.matches[0]).toMatchObject({ matchMethod: 'mmsi', entityId: 'e2' });
  });

  it('does not match when input IMO is null even if a row has null IMO', () => {
    const row = baseRow({ imo: null, mmsi: null, name: 'OTHER' });
    const result = match({ imo: null, mmsi: null, name: null }, [row]);
    expect(result.status).toBe('clear');
  });

  it('does not match when input MMSI is null', () => {
    const row = baseRow({ mmsi: null });
    const result = match({ imo: null, mmsi: null, name: null }, [row]);
    expect(result.status).toBe('clear');
  });

  it('orders multiple IMO matches deterministically by sourceEntityId', () => {
    const a = baseRow({ entityId: 'a', sourceEntityId: 'B', imo: '9187629', name: 'X' });
    const b = baseRow({ entityId: 'b', sourceEntityId: 'A', imo: '9187629', name: 'Y' });
    const result = match({ imo: '9187629', mmsi: null, name: null }, [a, b]);
    expect(result.matches.map((m) => m.sourceEntityId)).toEqual(['A', 'B']);
  });

  it('dedupes when same entity matches by both IMO and MMSI, keeping IMO method', () => {
    const row = baseRow({ entityId: 'e3', sourceEntityId: '15036', imo: '9187629', mmsi: '572469210' });
    const result = match({ imo: '9187629', mmsi: '572469210', name: null }, [row]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.matchMethod).toBe('imo');
  });

  it('returns IMO before MMSI when they match different entities', () => {
    const imoRow = baseRow({ entityId: 'imo-row', sourceEntityId: '1', imo: '9187629' });
    const mmsiRow = baseRow({ entityId: 'mmsi-row', sourceEntityId: '2', mmsi: '572469210' });
    const result = match({ imo: '9187629', mmsi: '572469210', name: null }, [imoRow, mmsiRow]);
    expect(result.status).toBe('sanctioned');
    expect(result.matches.map((m) => m.matchMethod)).toEqual(['imo', 'mmsi']);
  });

  it('returns name_candidate as candidate when no exact identifier match', () => {
    const row = baseRow({ entityId: 'e4', sourceEntityId: '15036', name: 'ARTAVIL' });
    const result = match({ imo: null, mmsi: null, name: 'Artavil' }, [row]);
    expect(result.status).toBe('candidate');
    expect(result.matches[0]).toMatchObject({ matchMethod: 'name_candidate', name: 'ARTAVIL' });
  });

  it('matches name via aliases using normalizeName on both sides', () => {
    const row = baseRow({ entityId: 'e5', sourceEntityId: '15036', name: 'ARTAVIL', aliases: ['ABADAN', 'SHONA'] });
    const result = match({ imo: null, mmsi: null, name: 'abadan' }, [row]);
    expect(result.status).toBe('candidate');
    expect(result.matches[0]?.sourceEntityId).toBe('15036');
  });

  it('does not surface name candidates when an exact identifier match already fires', () => {
    const imoRow = baseRow({ entityId: 'imo-row', sourceEntityId: '1', imo: '9187629', name: 'OTHER' });
    const nameRow = baseRow({ entityId: 'name-row', sourceEntityId: '2', name: 'ARTAVIL' });
    const result = match(
      { imo: '9187629', mmsi: null, name: 'Artavil' },
      [imoRow, nameRow],
    );
    expect(result.status).toBe('sanctioned');
    expect(result.matches.every((m) => m.matchMethod !== 'name_candidate')).toBe(true);
  });

  it('returns clear when only an empty-string name would normalize to empty', () => {
    const row = baseRow({ name: '' });
    const result = match({ imo: null, mmsi: null, name: '' }, [row]);
    expect(result.status).toBe('clear');
  });

  it('preserves display fields (aliases, flag, listingDate) in match payload', () => {
    const row = baseRow({
      entityId: 'e6',
      sourceEntityId: '15036',
      name: 'ARTAVIL',
      imo: '9187629',
      aliases: ['ABADAN'],
      flag: 'Iran',
      listingDate: '2020-01-15',
    });
    const result = match({ imo: '9187629', mmsi: null, name: null }, [row]);
    expect(result.matches[0]).toMatchObject({
      aliases: ['ABADAN'],
      flag: 'Iran',
      listingDate: '2020-01-15',
    });
  });
});

// Type check: MatchInput is exported and minimal.
const _typeCheck: MatchInput = { imo: null, mmsi: null, name: null };
void _typeCheck;
