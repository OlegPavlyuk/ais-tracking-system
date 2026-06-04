import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OfacAdapter } from './ofac.adapter';
import { VesselEntity } from './sanctions-source.adapter';

const FIXTURE_PATH = resolve(__dirname, '../../../test/fixtures/sanctions/ofac-sdn-sample.xml');

async function collect(adapter: OfacAdapter): Promise<VesselEntity[]> {
  const out: VesselEntity[] = [];
  for await (const v of adapter.fetchAll()) out.push(v);
  return out;
}

async function collectFromXml(xml: string): Promise<VesselEntity[]> {
  return collect(OfacAdapter.fromString(xml));
}

describe('OfacAdapter', () => {
  let adapter: OfacAdapter;
  let entities: VesselEntity[];
  let byUid: Map<string, VesselEntity>;

  beforeAll(async () => {
    const xml = readFileSync(FIXTURE_PATH, 'utf-8');
    adapter = OfacAdapter.fromString(xml);
    entities = await collect(adapter);
    byUid = new Map(entities.map((e) => [e.sourceEntityId, e]));
  });

  it('exposes the OFAC source id', () => {
    expect(adapter.source).toBe('ofac');
  });

  it('filters out non-Vessel sdnType entries', () => {
    expect(byUid.has('36')).toBe(false);
    expect(entities.every((e) => e.sourceEntityId !== '36')).toBe(true);
  });

  it('returns every Vessel entry from the fixture', () => {
    expect(entities).toHaveLength(7);
    expect(entities.map((e) => e.sourceEntityId).sort()).toEqual(
      ['15036', '15049', '17104', '17105', '4238', '4243', '4249'].sort(),
    );
  });

  it('uses uid as sourceEntityId and lastName as name', () => {
    expect(byUid.get('4238')!.name).toBe('MAR AZUL');
    expect(byUid.get('15036')!.name).toBe('ARTAVIL');
  });

  it('strips "IMO " prefix and accepts bare digits', () => {
    expect(byUid.get('15036')!.imo).toBe('9187629');
    expect(byUid.get('17104')!.imo).toBe('8606173');
    expect(byUid.get('4243')!.imo).toBe('7406784');
  });

  it('returns null IMO when no Vessel Registration Identification is present', () => {
    expect(byUid.get('4238')!.imo).toBeNull();
  });

  it('extracts MMSI from idList', () => {
    expect(byUid.get('15036')!.mmsi).toBe('572469210');
    expect(byUid.get('15049')!.mmsi).toBe('572438210');
  });

  it('extracts a valid 9-digit MMSI', async () => {
    const entities = await collectFromXml(`
      <sdnList>
        <sdnEntry>
          <uid>9001</uid>
          <lastName>VALID MMSI</lastName>
          <sdnType>Vessel</sdnType>
          <idList>
            <id>
              <idType>MMSI</idType>
              <idNumber>123456789</idNumber>
            </id>
          </idList>
        </sdnEntry>
      </sdnList>
    `);

    expect(entities).toHaveLength(1);
    const entity = entities[0]!;
    expect(entity.mmsi).toBe('123456789');
  });

  it('returns null for a non-9-digit MMSI and still yields the vessel', async () => {
    const entities = await collectFromXml(`
      <sdnList>
        <sdnEntry>
          <uid>9002</uid>
          <lastName>INVALID MMSI</lastName>
          <sdnType>Vessel</sdnType>
          <idList>
            <id>
              <idType>MMSI</idType>
              <idNumber>3708590000</idNumber>
            </id>
          </idList>
        </sdnEntry>
      </sdnList>
    `);

    expect(entities).toHaveLength(1);
    const entity = entities[0]!;
    expect(entity).toMatchObject({
      sourceEntityId: '9002',
      name: 'INVALID MMSI',
      mmsi: null,
    });
    expect(entity.rawPayload).toMatchObject({
      idList: {
        id: {
          idType: 'MMSI',
          idNumber: '3708590000',
        },
      },
    });
  });

  it('returns null MMSI when no MMSI id entry is present', () => {
    expect(byUid.get('4238')!.mmsi).toBeNull();
    expect(byUid.get('17104')!.mmsi).toBeNull();
  });

  it('extracts a valid 7-digit IMO from both prefixed and bare forms', async () => {
    const entities = await collectFromXml(`
      <sdnList>
        <sdnEntry>
          <uid>9003</uid>
          <lastName>PREFIXED IMO</lastName>
          <sdnType>Vessel</sdnType>
          <idList>
            <id>
              <idType>Vessel Registration Identification</idType>
              <idNumber>IMO 1234567</idNumber>
            </id>
          </idList>
        </sdnEntry>
        <sdnEntry>
          <uid>9004</uid>
          <lastName>BARE IMO</lastName>
          <sdnType>Vessel</sdnType>
          <idList>
            <id>
              <idType>Vessel Registration Identification</idType>
              <idNumber>1234567</idNumber>
            </id>
          </idList>
        </sdnEntry>
      </sdnList>
    `);

    expect(entities.map((entity) => entity.imo)).toEqual(['1234567', '1234567']);
  });

  it('returns null for a non-7-digit IMO and still yields the vessel', async () => {
    const entities = await collectFromXml(`
      <sdnList>
        <sdnEntry>
          <uid>9005</uid>
          <lastName>INVALID IMO</lastName>
          <sdnType>Vessel</sdnType>
          <idList>
            <id>
              <idType>Vessel Registration Identification</idType>
              <idNumber>IMO 12345678</idNumber>
            </id>
          </idList>
        </sdnEntry>
      </sdnList>
    `);

    expect(entities).toHaveLength(1);
    const entity = entities[0]!;
    expect(entity).toMatchObject({
      sourceEntityId: '9005',
      name: 'INVALID IMO',
      imo: null,
    });
    expect(entity.rawPayload).toMatchObject({
      idList: {
        id: {
          idType: 'Vessel Registration Identification',
          idNumber: 'IMO 12345678',
        },
      },
    });
  });

  it('keeps only strong-category aliases in the structured aliases array', () => {
    const artavil = byUid.get('15036')!;
    expect(artavil.aliases.sort()).toEqual(['ABADAN', 'SHONA'].sort());
    const ebano = byUid.get('4243')!;
    expect(ebano.aliases).toEqual([]);
    const forest = byUid.get('15049')!;
    expect(forest.aliases.sort()).toEqual(['FAEZ', 'SATEEN', 'MAESTRO', 'FIANGA'].sort());
  });

  it('extracts flag from vesselInfo', () => {
    expect(byUid.get('15036')!.flag).toBe('Iran');
    expect(byUid.get('4238')!.flag).toBe('Cuba');
    expect(byUid.get('17104')!.flag).toBe("Democratic People's Republic of Korea");
  });

  it('extracts the program list', () => {
    expect(byUid.get('15036')!.programs).toEqual(['IRAN']);
    expect(byUid.get('4238')!.programs).toEqual(['CUBA']);
  });

  it('preserves the full sdnEntry as rawPayload', () => {
    const raw = byUid.get('15036')!.rawPayload;
    expect(raw).toMatchObject({ uid: '15036', lastName: 'ARTAVIL', sdnType: 'Vessel' });
    expect(raw).toHaveProperty('akaList');
    expect(raw).toHaveProperty('idList');
    expect(raw).toHaveProperty('vesselInfo');
  });

  it('listingDate is null when sdnEntry carries no listing date', () => {
    expect(byUid.get('15036')!.listingDate).toBeNull();
  });

  it('handles single-element idList / akaList without array wrapping', () => {
    const ebano = byUid.get('4243')!;
    expect(ebano.imo).toBe('7406784');
  });
});
