import { Injectable, Logger } from '@nestjs/common';
import {
  CanonicalEvent,
  CanonicalEventSchema,
  PositionEvent,
  RawProviderMessage,
  SCHEMA_VERSION,
  StaticEvent,
} from '../../contracts';
import { ProviderNormalizer } from '../provider';

interface AisStreamPositionReport {
  Cog?: number;
  Latitude?: number;
  Longitude?: number;
  NavigationalStatus?: number;
  RateOfTurn?: number;
  Sog?: number;
  TrueHeading?: number;
  UserID?: number;
  Valid?: boolean;
}

interface AisStreamDimension {
  A?: number;
  B?: number;
  C?: number;
  D?: number;
}

interface AisStreamStaticDataReport {
  ReportA?: { Name?: string; Valid?: boolean };
  ReportB?: {
    CallSign?: string;
    Dimension?: AisStreamDimension;
    ShipType?: number;
    Valid?: boolean;
  };
  UserID?: number;
  Valid?: boolean;
}

interface AisStreamShipStaticData {
  CallSign?: string;
  Destination?: string;
  Dimension?: AisStreamDimension;
  ImoNumber?: number;
  Name?: string;
  Type?: number;
  UserID?: number;
  Valid?: boolean;
}

interface AisStreamMessage {
  MessageType?: string;
  Message?: Record<string, unknown>;
  MetaData?: {
    MMSI?: number | string;
    ShipName?: string;
    time_utc?: string;
  };
}

const POSITION_TYPES = new Set(['PositionReport', 'StandardClassBPositionReport']);
const STATIC_TYPES = new Set(['StaticDataReport', 'ShipStaticData']);

/** Parse `2026-04-28 04:52:17.518241663 +0000 UTC` → ISO string. */
function parseAisStreamTimestamp(s: string | undefined): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se, frac] = m;
  const ms = frac ? frac.slice(0, 3).padEnd(3, '0') : '000';
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${se}.${ms}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** AIS strings arrive padded with spaces and sometimes `@`. Trim, truncate, collapse empties. */
function cleanString(s: string | undefined, maxLen: number): string | null {
  if (typeof s !== 'string') return null;
  const trimmed = s.replace(/[\s@]+$/u, '').replace(/^[\s@]+/u, '');
  if (trimmed.length === 0) return null;
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

/** AIS Type 5/24 sends {A:0,B:0,C:0,D:0} when dimensions are unknown. */
function dimensionsOrNull(d: AisStreamDimension | undefined): {
  bow: number | null;
  stern: number | null;
  port: number | null;
  starboard: number | null;
} {
  const a = d?.A ?? null;
  const b = d?.B ?? null;
  const c = d?.C ?? null;
  const dd = d?.D ?? null;
  if (a === 0 && b === 0 && c === 0 && dd === 0) {
    return { bow: null, stern: null, port: null, starboard: null };
  }
  return { bow: a, stern: b, port: c, starboard: dd };
}

@Injectable()
export class AisStreamNormalizer implements ProviderNormalizer {
  private readonly logger = new Logger(AisStreamNormalizer.name);
  readonly provider = 'aisstream';

  normalize(raw: RawProviderMessage<unknown>, now: Date = new Date()): CanonicalEvent | null {
    const msg = raw.payload as AisStreamMessage;
    const type = msg.MessageType;
    if (!type) return null;
    if (POSITION_TYPES.has(type)) return this.normalizePosition(raw, msg, type, now);
    if (STATIC_TYPES.has(type)) return this.normalizeStatic(raw, msg, type, now);
    return null;
  }

  private normalizePosition(
    raw: RawProviderMessage<unknown>,
    msg: AisStreamMessage,
    type: string,
    now: Date,
  ): PositionEvent | null {
    const report = msg.Message?.[type] as AisStreamPositionReport | undefined;
    if (!report) return null;
    if (report.Valid === false) return null;

    const occurredAt = parseAisStreamTimestamp(msg.MetaData?.time_utc) ?? raw.receivedAt;
    const shipName = cleanString(msg.MetaData?.ShipName, 255);

    const candidate: Partial<PositionEvent> = {
      schemaVersion: SCHEMA_VERSION,
      kind: 'position',
      mmsi: String(msg.MetaData?.MMSI ?? report.UserID ?? ''),
      lat: report.Latitude as number,
      lon: report.Longitude as number,
      sog: report.Sog ?? null,
      cog: report.Cog ?? null,
      trueHeading: report.TrueHeading ?? null,
      navStatus: report.NavigationalStatus ?? null,
      rateOfTurn: report.RateOfTurn ?? null,
      shipName,
      occurredAt,
      provider: raw.provider,
      ingestedAt: now.toISOString(),
    };

    const parsed = CanonicalEventSchema.safeParse(candidate);
    if (!parsed.success) {
      this.logger.debug(`drop invalid position event: ${parsed.error.issues[0]?.message}`);
      return null;
    }
    return parsed.data as PositionEvent;
  }

  private normalizeStatic(
    raw: RawProviderMessage<unknown>,
    msg: AisStreamMessage,
    type: string,
    now: Date,
  ): StaticEvent | null {
    const occurredAt = parseAisStreamTimestamp(msg.MetaData?.time_utc) ?? raw.receivedAt;
    const report =
      type === 'StaticDataReport'
        ? (msg.Message?.[type] as AisStreamStaticDataReport | undefined)
        : (msg.Message?.[type] as AisStreamShipStaticData | undefined);
    const baseFields = {
      schemaVersion: SCHEMA_VERSION,
      kind: 'static' as const,
      mmsi: String(msg.MetaData?.MMSI ?? report?.UserID ?? ''),
      occurredAt,
      provider: raw.provider,
      ingestedAt: now.toISOString(),
    };

    let candidate: Partial<StaticEvent> | null = null;
    if (type === 'StaticDataReport') {
      candidate = this.fromStaticDataReport(report as AisStreamStaticDataReport | undefined, baseFields);
    } else if (type === 'ShipStaticData') {
      candidate = this.fromShipStaticData(report as AisStreamShipStaticData | undefined, baseFields);
    }
    if (!candidate) return null;

    const parsed = CanonicalEventSchema.safeParse(candidate);
    if (!parsed.success) {
      this.logger.debug(`drop invalid static event: ${parsed.error.issues[0]?.message}`);
      return null;
    }
    return parsed.data as StaticEvent;
  }

  private fromStaticDataReport(
    report: AisStreamStaticDataReport | undefined,
    base: Pick<StaticEvent, 'schemaVersion' | 'kind' | 'mmsi' | 'occurredAt' | 'provider' | 'ingestedAt'>,
  ): Partial<StaticEvent> | null {
    if (!report) return null;
    const aValid = report.ReportA?.Valid === true;
    const bValid = report.ReportB?.Valid === true;
    if (!aValid && !bValid) return null;

    const name = aValid ? cleanString(report.ReportA?.Name, 255) : null;
    const callSign = bValid ? cleanString(report.ReportB?.CallSign, 32) : null;
    const shipType =
      bValid && typeof report.ReportB?.ShipType === 'number' && report.ReportB.ShipType > 0
        ? report.ReportB.ShipType
        : null;
    const dim = dimensionsOrNull(bValid ? report.ReportB?.Dimension : undefined);

    return {
      ...base,
      name,
      callSign,
      shipType,
      imo: null,
      destination: null,
      dimensionToBow: dim.bow,
      dimensionToStern: dim.stern,
      dimensionToPort: dim.port,
      dimensionToStarboard: dim.starboard,
    };
  }

  private fromShipStaticData(
    report: AisStreamShipStaticData | undefined,
    base: Pick<StaticEvent, 'schemaVersion' | 'kind' | 'mmsi' | 'occurredAt' | 'provider' | 'ingestedAt'>,
  ): Partial<StaticEvent> | null {
    if (!report) return null;
    if (report.Valid === false) return null;

    const imo =
      typeof report.ImoNumber === 'number' && /^\d{7}$/.test(String(report.ImoNumber))
        ? String(report.ImoNumber)
        : null;
    const dim = dimensionsOrNull(report.Dimension);

    return {
      ...base,
      name: cleanString(report.Name, 255),
      callSign: cleanString(report.CallSign, 32),
      shipType: typeof report.Type === 'number' && report.Type > 0 ? report.Type : null,
      imo,
      destination: cleanString(report.Destination, 120),
      dimensionToBow: dim.bow,
      dimensionToStern: dim.stern,
      dimensionToPort: dim.port,
      dimensionToStarboard: dim.starboard,
    };
  }
}
