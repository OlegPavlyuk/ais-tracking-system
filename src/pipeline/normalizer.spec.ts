import { AisStreamNormalizer } from './normalizer';
import { PositionEventSchema, SCHEMA_VERSION } from '../contracts';

describe('AisStreamNormalizer', () => {
  const normalizer = new AisStreamNormalizer();
  const fixedNow = new Date('2026-04-28T05:00:00.000Z');

  it('normalizes a PositionReport into a canonical position event', () => {
    const raw = {
      MessageType: 'PositionReport',
      Message: {
        PositionReport: {
          Cog: 26.9,
          Latitude: 41.647641666666665,
          Longitude: 41.651916666666665,
          NavigationalStatus: 5,
          RateOfTurn: 0,
          Sog: 0.1,
          TrueHeading: 261,
          UserID: 241935000,
          Valid: true,
        },
      },
      MetaData: {
        MMSI: 241935000,
        ShipName: 'SEA MOON            ',
        latitude: 41.64764,
        longitude: 41.65192,
        time_utc: '2026-04-28 04:52:17.518241663 +0000 UTC',
      },
    };

    const event = normalizer.normalize(
      { provider: 'aisstream', receivedAt: fixedNow.toISOString(), payload: raw },
      fixedNow,
    );

    expect(event).not.toBeNull();
    expect(PositionEventSchema.safeParse(event).success).toBe(true);
    expect(event).toMatchObject({
      schemaVersion: SCHEMA_VERSION,
      kind: 'position',
      mmsi: '241935000',
      lat: 41.647641666666665,
      lon: 41.651916666666665,
      sog: 0.1,
      cog: 26.9,
      trueHeading: 261,
      navStatus: 5,
      rateOfTurn: 0,
      shipName: 'SEA MOON',
      provider: 'aisstream',
    });
    expect(event!.occurredAt).toBe('2026-04-28T04:52:17.518Z');
  });

  it('normalizes a StandardClassBPositionReport (no NavigationalStatus)', () => {
    const raw = {
      MessageType: 'StandardClassBPositionReport',
      Message: {
        StandardClassBPositionReport: {
          Cog: 201.9,
          Latitude: 41.64928666666666,
          Longitude: 41.64527,
          Sog: 0.2,
          TrueHeading: 511,
          UserID: 213049000,
          Valid: true,
        },
      },
      MetaData: {
        MMSI: 213049000,
        ShipName: 'MEDEA',
        time_utc: '2026-04-28 04:52:00.798410265 +0000 UTC',
      },
    };

    const event = normalizer.normalize(
      { provider: 'aisstream', receivedAt: fixedNow.toISOString(), payload: raw },
      fixedNow,
    );
    expect(event).not.toBeNull();
    expect(event!.mmsi).toBe('213049000');
    expect(event!.navStatus).toBeNull();
    expect(event!.trueHeading).toBe(511);
    expect(event!.shipName).toBe('MEDEA');
  });

  it('returns null for unsupported message types (e.g. StaticDataReport in slice #2)', () => {
    const raw = {
      MessageType: 'StaticDataReport',
      Message: { StaticDataReport: { UserID: 213049000 } },
      MetaData: { MMSI: 213049000, time_utc: '2026-04-28 04:52:00 +0000 UTC' },
    };
    expect(
      normalizer.normalize(
        { provider: 'aisstream', receivedAt: fixedNow.toISOString(), payload: raw },
        fixedNow,
      ),
    ).toBeNull();
  });

  it('returns null when AISStream marks the report Valid: false', () => {
    const raw = {
      MessageType: 'PositionReport',
      Message: {
        PositionReport: {
          Cog: 26.9,
          Latitude: 41.647641666666665,
          Longitude: 41.651916666666665,
          Sog: 0.1,
          UserID: 241935000,
          Valid: false,
        },
      },
      MetaData: { MMSI: 241935000, time_utc: '2026-04-28 04:52:17.518241663 +0000 UTC' },
    };
    expect(
      normalizer.normalize(
        { provider: 'aisstream', receivedAt: fixedNow.toISOString(), payload: raw },
        fixedNow,
      ),
    ).toBeNull();
  });

  it('returns null for messages with invalid coordinates', () => {
    const raw = {
      MessageType: 'PositionReport',
      Message: { PositionReport: { UserID: 241935000, Latitude: 91, Longitude: 0, Valid: true } },
      MetaData: { MMSI: 241935000, time_utc: '2026-04-28 04:52:00 +0000 UTC' },
    };
    expect(
      normalizer.normalize(
        { provider: 'aisstream', receivedAt: fixedNow.toISOString(), payload: raw },
        fixedNow,
      ),
    ).toBeNull();
  });
});
