import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RawFilter } from './raw-filter';

function loadFixture(): unknown[] {
  const path = join(__dirname, '..', '..', 'aisstream', 'raw-api-response.jsonl');
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

describe('RawFilter', () => {
  const filter = new RawFilter();

  it('accepts PositionReport with 9-digit MMSI', () => {
    const msg = {
      MessageType: 'PositionReport',
      Message: { PositionReport: { UserID: 241935000 } },
      MetaData: { MMSI: 241935000 },
    };
    expect(filter.accept(msg)).toBe(true);
  });

  it('accepts StandardClassBPositionReport with 9-digit MMSI', () => {
    const msg = {
      MessageType: 'StandardClassBPositionReport',
      Message: { StandardClassBPositionReport: { UserID: 213049000 } },
      MetaData: { MMSI: 213049000 },
    };
    expect(filter.accept(msg)).toBe(true);
  });

  it('rejects BaseStationReport (non-vessel)', () => {
    const msg = {
      MessageType: 'BaseStationReport',
      Message: { BaseStationReport: { UserID: 2130100 } },
      MetaData: { MMSI: 2130100 },
    };
    expect(filter.accept(msg)).toBe(false);
  });

  it('accepts ShipStaticData with 9-digit MMSI', () => {
    const msg = {
      MessageType: 'ShipStaticData',
      Message: { ShipStaticData: { UserID: 210098000 } },
      MetaData: { MMSI: 210098000 },
    };
    expect(filter.accept(msg)).toBe(true);
  });

  it('rejects ExtendedClassBPositionReport (Type 19, intentionally deferred)', () => {
    const msg = {
      MessageType: 'ExtendedClassBPositionReport',
      Message: { ExtendedClassBPositionReport: { UserID: 257786070 } },
      MetaData: { MMSI: 257786070 },
    };
    expect(filter.accept(msg)).toBe(false);
  });

  it('rejects DataLinkManagementMessage', () => {
    const msg = {
      MessageType: 'DataLinkManagementMessage',
      Message: { DataLinkManagementMessage: {} },
      MetaData: { MMSI: 2130201 },
    };
    expect(filter.accept(msg)).toBe(false);
  });

  it('rejects messages with non-9-digit MMSI', () => {
    const msg = {
      MessageType: 'PositionReport',
      Message: { PositionReport: { UserID: 2130100 } },
      MetaData: { MMSI: 2130100 },
    };
    expect(filter.accept(msg)).toBe(false);
  });

  it('rejects messages without MessageType', () => {
    expect(filter.accept({ MetaData: { MMSI: 241935000 } })).toBe(false);
  });

  it('classifies fixture file: only Position* with 9-digit MMSI pass', () => {
    const fixture = loadFixture();
    const accepted = fixture.filter((m) => filter.accept(m));
    for (const m of accepted) {
      const mt = (m as { MessageType?: string }).MessageType;
      expect([
        'PositionReport',
        'StandardClassBPositionReport',
        'StaticDataReport',
        'ShipStaticData',
      ]).toContain(mt);
      const mmsi = String((m as { MetaData?: { MMSI?: number } }).MetaData?.MMSI ?? '');
      expect(mmsi).toMatch(/^\d{9}$/);
    }
    expect(accepted.length).toBeGreaterThan(0);
  });
});
