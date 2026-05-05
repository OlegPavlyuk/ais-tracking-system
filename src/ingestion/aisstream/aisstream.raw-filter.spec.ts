import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AISSTREAM_ACCEPTED_MESSAGE_TYPES } from './aisstream.message-types';
import { AisStreamRawFilter } from './aisstream.raw-filter';

function loadFixture(): unknown[] {
  const path = join(__dirname, '..', '..', '..', 'aisstream', 'raw-api-response.jsonl');
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

describe('AisStreamRawFilter', () => {
  const filter = new AisStreamRawFilter();
  const acceptedMmsi = 241935000;

  function makeMessage(messageType: string, mmsi: number | string = acceptedMmsi) {
    return {
      MessageType: messageType,
      Message: { [messageType]: { UserID: Number(mmsi) } },
      MetaData: { MMSI: mmsi },
    };
  }

  it('accepts PositionReport with 9-digit MMSI', () => {
    const msg = makeMessage('PositionReport');
    expect(filter.accept(msg)).toEqual({ accepted: true });
  });

  it('accepts StandardClassBPositionReport with 9-digit MMSI', () => {
    const msg = makeMessage('StandardClassBPositionReport', 213049000);
    expect(filter.accept(msg)).toEqual({ accepted: true });
  });

  it('rejects BaseStationReport (non-vessel)', () => {
    const msg = makeMessage('BaseStationReport', 2130100);
    expect(filter.accept(msg)).toEqual({ accepted: false, reason: 'non_vessel_mmsi' });
  });

  it('accepts ShipStaticData with 9-digit MMSI', () => {
    const msg = makeMessage('ShipStaticData', 210098000);
    expect(filter.accept(msg)).toEqual({ accepted: true });
  });

  it('accepts ExtendedClassBPositionReport with 9-digit MMSI', () => {
    const msg = makeMessage('ExtendedClassBPositionReport', 257786070);
    expect(filter.accept(msg)).toEqual({ accepted: true });
  });

  it('rejects DataLinkManagementMessage', () => {
    const msg = makeMessage('DataLinkManagementMessage', 2130201);
    expect(filter.accept(msg)).toEqual({ accepted: false, reason: 'non_vessel_mmsi' });
  });

  it('rejects LongRangeAisBroadcastMessage (type 27 remains unsupported)', () => {
    const msg = makeMessage('LongRangeAisBroadcastMessage', 235123456);
    expect(filter.accept(msg)).toEqual({ accepted: false, reason: 'non_vessel_mmsi' });
  });

  it('rejects messages with non-9-digit MMSI', () => {
    const msg = makeMessage('PositionReport', 2130100);
    expect(filter.accept(msg)).toEqual({ accepted: false, reason: 'non_vessel_mmsi' });
  });

  it('rejects messages without MessageType', () => {
    expect(filter.accept({ MetaData: { MMSI: 241935000 } })).toEqual({
      accepted: false,
      reason: 'invalid',
    });
  });

  it('rejects null/non-object inputs as invalid', () => {
    expect(filter.accept(null)).toEqual({ accepted: false, reason: 'invalid' });
    expect(filter.accept(42)).toEqual({ accepted: false, reason: 'invalid' });
  });

  it('rejects messages without Message as invalid', () => {
    expect(
      filter.accept({
        MessageType: 'PositionReport',
        MetaData: { MMSI: 241935000 },
      }),
    ).toEqual({ accepted: false, reason: 'invalid' });
  });

  it('rejects messages with non-object Message as invalid', () => {
    expect(
      filter.accept({
        MessageType: 'PositionReport',
        Message: 'bad',
        MetaData: { MMSI: 241935000 },
      }),
    ).toEqual({ accepted: false, reason: 'invalid' });
  });

  it('rejects messages without Message[MessageType] as invalid', () => {
    expect(
      filter.accept({
        MessageType: 'PositionReport',
        Message: { ShipStaticData: { UserID: 241935000 } },
        MetaData: { MMSI: 241935000 },
      }),
    ).toEqual({ accepted: false, reason: 'invalid' });
  });

  it('accepts all configured AISStream message types from the fixture when MMSI is valid', () => {
    const fixture = loadFixture();
    const accepted = fixture.filter((m) => filter.accept(m).accepted);
    for (const m of accepted) {
      const mt = (m as { MessageType?: string }).MessageType;
      expect(AISSTREAM_ACCEPTED_MESSAGE_TYPES).toContain(mt as (typeof AISSTREAM_ACCEPTED_MESSAGE_TYPES)[number]);
      const mmsi = String((m as { MetaData?: { MMSI?: number } }).MetaData?.MMSI ?? '');
      expect(mmsi).toMatch(/^\d{9}$/);
    }
    expect(accepted.length).toBeGreaterThan(0);
  });
});
