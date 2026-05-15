import { SCHEMA_VERSION, VesselPersistedEvent, VesselPersistedEventSchema } from './index';

const validEvent = (): VesselPersistedEvent => ({
  schemaVersion: SCHEMA_VERSION,
  kind: 'vessel.persisted',
  vesselId: '0b92162b-9a33-482d-a4d3-8f86a63d9d52',
  mmsi: '572469210',
  imo: '9187629',
  name: 'ARTAVIL',
  sourceEventKind: 'static',
  persistedAt: '2026-05-02T00:00:00.000Z',
  traceId: '18b53d83-b0a9-4b14-9f8f-c6a1ec1e8cf8',
});

describe('VesselPersistedEventSchema', () => {
  it('accepts the post-persistence vessel summary contract', () => {
    expect(VesselPersistedEventSchema.parse(validEvent())).toEqual(validEvent());
  });

  it('allows nullable profile fields', () => {
    const event = validEvent();
    event.imo = null;
    event.name = null;

    expect(VesselPersistedEventSchema.parse(event)).toEqual(event);
  });

  it('rejects invalid vessel identifiers', () => {
    expect(
      VesselPersistedEventSchema.safeParse({
        ...validEvent(),
        mmsi: 'bad',
      }).success,
    ).toBe(false);
    expect(
      VesselPersistedEventSchema.safeParse({
        ...validEvent(),
        imo: '123',
      }).success,
    ).toBe(false);
  });
});
