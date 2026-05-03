import { AisStreamNormalizer } from './aisstream.normalizer';
import { PositionEventSchema, StaticEventSchema, SCHEMA_VERSION } from '../../contracts';

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
    if (event?.kind !== 'position') throw new Error('expected position event');
    expect(event.mmsi).toBe('213049000');
    expect(event.navStatus).toBeNull();
    expect(event.trueHeading).toBe(511);
    expect(event.shipName).toBe('MEDEA');
  });

  it('normalizes StaticDataReport with only Part A (Name) populated', () => {
    const raw = {
      MessageType: 'StaticDataReport',
      Message: {
        StaticDataReport: {
          MessageID: 24,
          PartNumber: false,
          ReportA: { Name: 'DAGNY', Valid: true },
          ReportB: {
            CallSign: '',
            Dimension: { A: 0, B: 0, C: 0, D: 0 },
            ShipType: 0,
            Valid: false,
          },
          UserID: 244060009,
          Valid: true,
        },
      },
      MetaData: {
        MMSI: 244060009,
        ShipName: 'DAGNY',
        time_utc: '2026-04-30 06:29:18.890334620 +0000 UTC',
      },
    };

    const event = normalizer.normalize(
      { provider: 'aisstream', receivedAt: fixedNow.toISOString(), payload: raw },
      fixedNow,
    );

    expect(event).not.toBeNull();
    expect(StaticEventSchema.safeParse(event).success).toBe(true);
    expect(event).toMatchObject({
      schemaVersion: SCHEMA_VERSION,
      kind: 'static',
      mmsi: '244060009',
      name: 'DAGNY',
      callSign: null,
      shipType: null,
      dimensionToBow: null,
      dimensionToStern: null,
      dimensionToPort: null,
      dimensionToStarboard: null,
      imo: null,
      destination: null,
      provider: 'aisstream',
    });
  });

  it('normalizes ShipStaticData with full profile fields', () => {
    const raw = {
      MessageType: 'ShipStaticData',
      Message: {
        ShipStaticData: {
          AisVersion: 2,
          CallSign: '5BQA5',
          Destination: 'BELFAST<>BIRKINHEAD',
          Dimension: { A: 55, B: 160, C: 3, D: 25 },
          FixType: 3,
          ImoNumber: 9807322,
          MaximumStaticDraught: 6.3,
          MessageID: 5,
          Name: 'STENA EMBLA',
          Type: 61,
          UserID: 210098000,
          Valid: true,
        },
      },
      MetaData: {
        MMSI: 210098000,
        ShipName: 'STENA EMBLA',
        time_utc: '2026-04-30 06:29:19.087628565 +0000 UTC',
      },
    };

    const event = normalizer.normalize(
      { provider: 'aisstream', receivedAt: fixedNow.toISOString(), payload: raw },
      fixedNow,
    );

    expect(event).not.toBeNull();
    expect(StaticEventSchema.safeParse(event).success).toBe(true);
    expect(event).toMatchObject({
      kind: 'static',
      mmsi: '210098000',
      name: 'STENA EMBLA',
      callSign: '5BQA5',
      shipType: 61,
      imo: '9807322',
      destination: 'BELFAST<>BIRKINHEAD',
      dimensionToBow: 55,
      dimensionToStern: 160,
      dimensionToPort: 3,
      dimensionToStarboard: 25,
    });
  });

  it('treats ShipStaticData ImoNumber=0 as null', () => {
    const raw = {
      MessageType: 'ShipStaticData',
      Message: {
        ShipStaticData: {
          CallSign: 'PH3644',
          Destination: 'BOUWDOK',
          Dimension: { A: 74, B: 12, C: 3, D: 8 },
          ImoNumber: 0,
          Name: 'BRISANI',
          Type: 79,
          UserID: 244002007,
          Valid: true,
        },
      },
      MetaData: { MMSI: 244002007, time_utc: '2026-04-30 06:29:19.086812228 +0000 UTC' },
    };
    const event = normalizer.normalize(
      { provider: 'aisstream', receivedAt: fixedNow.toISOString(), payload: raw },
      fixedNow,
    );
    expect(event).not.toBeNull();
    expect(event!.kind).toBe('static');
    expect((event as { imo: string | null }).imo).toBeNull();
  });

  it('trims padded ShipStaticData strings (CallSign, Name)', () => {
    const raw = {
      MessageType: 'ShipStaticData',
      Message: {
        ShipStaticData: {
          CallSign: 'KOAP   ',
          Destination: 'XX XXX>?? ???       ',
          Dimension: { A: 18, B: 60, C: 9, D: 9 },
          ImoNumber: 9163348,
          Name: 'ATLANTIC POWER      ',
          Type: 90,
          UserID: 338649000,
          Valid: true,
        },
      },
      MetaData: { MMSI: 338649000, time_utc: '2026-04-30 06:29:19.119666386 +0000 UTC' },
    };
    const event = normalizer.normalize(
      { provider: 'aisstream', receivedAt: fixedNow.toISOString(), payload: raw },
      fixedNow,
    );
    expect(event).toMatchObject({
      kind: 'static',
      name: 'ATLANTIC POWER',
      callSign: 'KOAP',
      destination: 'XX XXX>?? ???',
      imo: '9163348',
    });
  });

  it('returns null for StaticDataReport with both reports invalid', () => {
    const raw = {
      MessageType: 'StaticDataReport',
      Message: {
        StaticDataReport: {
          ReportA: { Name: '', Valid: false },
          ReportB: { CallSign: '', Dimension: { A: 0, B: 0, C: 0, D: 0 }, ShipType: 0, Valid: false },
          UserID: 244060009,
          Valid: true,
        },
      },
      MetaData: { MMSI: 244060009, time_utc: '2026-04-30 06:29:18.890334620 +0000 UTC' },
    };
    expect(
      normalizer.normalize(
        { provider: 'aisstream', receivedAt: fixedNow.toISOString(), payload: raw },
        fixedNow,
      ),
    ).toBeNull();
  });

  it('falls back to Message.*.UserID for static MMSI when MetaData.MMSI is missing', () => {
    const raw = {
      MessageType: 'ShipStaticData',
      Message: {
        ShipStaticData: {
          CallSign: '5BQA5',
          Dimension: { A: 1, B: 1, C: 1, D: 1 },
          ImoNumber: 9807322,
          Name: 'STENA EMBLA',
          Type: 61,
          UserID: 210098000,
          Valid: true,
        },
      },
      MetaData: { time_utc: '2026-04-30 06:29:19.087628565 +0000 UTC' },
    };
    const event = normalizer.normalize(
      { provider: 'aisstream', receivedAt: fixedNow.toISOString(), payload: raw },
      fixedNow,
    );
    expect(event).not.toBeNull();
    expect(event!.mmsi).toBe('210098000');
  });

  it('treats all-zero ShipStaticData dimensions as null', () => {
    const raw = {
      MessageType: 'ShipStaticData',
      Message: {
        ShipStaticData: {
          Dimension: { A: 0, B: 0, C: 0, D: 0 },
          ImoNumber: 9807322,
          Name: 'NO DIMS',
          Type: 70,
          UserID: 210098000,
          Valid: true,
        },
      },
      MetaData: { MMSI: 210098000, time_utc: '2026-04-30 06:29:19.087628565 +0000 UTC' },
    };
    const event = normalizer.normalize(
      { provider: 'aisstream', receivedAt: fixedNow.toISOString(), payload: raw },
      fixedNow,
    );
    expect(event).toMatchObject({
      kind: 'static',
      dimensionToBow: null,
      dimensionToStern: null,
      dimensionToPort: null,
      dimensionToStarboard: null,
    });
  });

  it('rejects 6-digit ImoNumber as invalid (only 7-digit IMOs accepted)', () => {
    const raw = {
      MessageType: 'ShipStaticData',
      Message: {
        ShipStaticData: {
          ImoNumber: 123456,
          Name: 'BAD IMO',
          Type: 70,
          UserID: 210098000,
          Valid: true,
        },
      },
      MetaData: { MMSI: 210098000, time_utc: '2026-04-30 06:29:19.087628565 +0000 UTC' },
    };
    const event = normalizer.normalize(
      { provider: 'aisstream', receivedAt: fixedNow.toISOString(), payload: raw },
      fixedNow,
    );
    expect(event).not.toBeNull();
    expect((event as { imo: string | null }).imo).toBeNull();
  });

  it('returns null for unsupported message types (e.g. ExtendedClassBPositionReport)', () => {
    const raw = {
      MessageType: 'ExtendedClassBPositionReport',
      Message: { ExtendedClassBPositionReport: { UserID: 257786070, Valid: true } },
      MetaData: { MMSI: 257786070, time_utc: '2026-04-30 06:32:17.022814111 +0000 UTC' },
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
