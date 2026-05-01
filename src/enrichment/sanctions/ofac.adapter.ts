import { readFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import { SanctionsSourceAdapter, VesselEntity } from './sanctions-source.adapter';

interface RawSdnEntry {
  uid: number | string;
  lastName?: string;
  sdnType?: string;
  programList?: { program: string | string[] };
  idList?: { id: RawId | RawId[] };
  akaList?: { aka: RawAka | RawAka[] };
  vesselInfo?: { vesselFlag?: string };
  [k: string]: unknown;
}

interface RawId {
  idType: string;
  idNumber: string | number;
}

interface RawAka {
  category?: string;
  lastName?: string;
}

interface RawSdnList {
  sdnList: { sdnEntry: RawSdnEntry | RawSdnEntry[] };
}

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  removeNSPrefix: true,
  trimValues: true,
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function extractImo(entry: RawSdnEntry): string | null {
  const ids = asArray(entry.idList?.id);
  for (const id of ids) {
    if (id.idType === 'Vessel Registration Identification') {
      const raw = String(id.idNumber).trim();
      const stripped = raw.replace(/^IMO\s+/i, '').trim();
      if (/^\d+$/.test(stripped)) return stripped;
    }
  }
  return null;
}

function extractMmsi(entry: RawSdnEntry): string | null {
  const ids = asArray(entry.idList?.id);
  for (const id of ids) {
    if (id.idType === 'MMSI') {
      const raw = String(id.idNumber).trim();
      if (/^\d+$/.test(raw)) return raw;
    }
  }
  return null;
}

function extractStrongAliases(entry: RawSdnEntry): string[] {
  const akas = asArray(entry.akaList?.aka);
  return akas
    .filter((a) => a.category === 'strong' && typeof a.lastName === 'string' && a.lastName.length > 0)
    .map((a) => a.lastName as string);
}

function extractPrograms(entry: RawSdnEntry): string[] {
  return asArray(entry.programList?.program).map(String);
}

function toVesselEntity(entry: RawSdnEntry): VesselEntity {
  return {
    sourceEntityId: String(entry.uid),
    name: String(entry.lastName ?? ''),
    imo: extractImo(entry),
    mmsi: extractMmsi(entry),
    aliases: extractStrongAliases(entry),
    flag: entry.vesselInfo?.vesselFlag ?? null,
    listingDate: null,
    programs: extractPrograms(entry),
    rawPayload: entry as unknown as Record<string, unknown>,
  };
}

export class OfacAdapter implements SanctionsSourceAdapter {
  readonly source = 'ofac';

  private constructor(private readonly load: () => Promise<string>) {}

  static fromUrl(url: string): OfacAdapter {
    return new OfacAdapter(async () => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`OFAC SDN download failed: ${res.status} ${res.statusText}`);
      }
      return res.text();
    });
  }

  static fromFile(path: string): OfacAdapter {
    return new OfacAdapter(() => readFile(path, 'utf-8'));
  }

  static fromString(xml: string): OfacAdapter {
    return new OfacAdapter(async () => xml);
  }

  async *fetchAll(): AsyncIterable<VesselEntity> {
    const xml = await this.load();
    const parsed = parser.parse(xml) as RawSdnList;
    const entries = asArray(parsed.sdnList?.sdnEntry);
    for (const entry of entries) {
      if (entry.sdnType !== 'Vessel') continue;
      yield toVesselEntity(entry);
    }
  }
}
