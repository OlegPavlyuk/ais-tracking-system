import { correlationFromPayload } from './correlation';

describe('correlationFromPayload', () => {
  it('extracts traceId, mmsi, vesselId, provider when present', () => {
    const out = correlationFromPayload({
      traceId: '11111111-2222-3333-4444-555555555555',
      mmsi: '123456789',
      vesselId: 'v-1',
      provider: 'aisstream',
      kind: 'position',
    });
    expect(out).toEqual({
      traceId: '11111111-2222-3333-4444-555555555555',
      mmsi: '123456789',
      vesselId: 'v-1',
      provider: 'aisstream',
    });
  });

  it('coerces numeric mmsi to string and skips missing fields', () => {
    expect(correlationFromPayload({ mmsi: 123456789 })).toEqual({ mmsi: '123456789' });
  });

  it('returns an empty object for non-objects', () => {
    expect(correlationFromPayload(null)).toEqual({});
    expect(correlationFromPayload(undefined)).toEqual({});
    expect(correlationFromPayload('string')).toEqual({});
  });

  it('ignores fields with the wrong type', () => {
    expect(correlationFromPayload({ traceId: 42, vesselId: null, mmsi: true })).toEqual({});
  });
});
