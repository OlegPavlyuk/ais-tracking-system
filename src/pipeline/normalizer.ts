import { Injectable, Logger } from '@nestjs/common';
import {
  PositionEvent,
  PositionEventSchema,
  RawProviderMessage,
  SCHEMA_VERSION,
} from '../contracts';

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

interface AisStreamMessage {
  MessageType?: string;
  Message?: Record<string, AisStreamPositionReport | undefined>;
  MetaData?: {
    MMSI?: number | string;
    ShipName?: string;
    time_utc?: string;
  };
}

const POSITION_TYPES = new Set([
  'PositionReport',
  'StandardClassBPositionReport',
]);

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

@Injectable()
export class AisStreamNormalizer {
  private readonly logger = new Logger(AisStreamNormalizer.name);
  readonly provider = 'aisstream';

  normalize(raw: RawProviderMessage<unknown>, now: Date = new Date()): PositionEvent | null {
    const msg = raw.payload as AisStreamMessage;
    const type = msg.MessageType;
    if (!type || !POSITION_TYPES.has(type)) return null;

    const report = msg.Message?.[type];
    if (!report) return null;
    if (report.Valid === false) return null;

    const occurredAt = parseAisStreamTimestamp(msg.MetaData?.time_utc) ?? raw.receivedAt;
    const shipName =
      typeof msg.MetaData?.ShipName === 'string' ? msg.MetaData.ShipName.trim() || null : null;

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

    const parsed = PositionEventSchema.safeParse(candidate);
    if (!parsed.success) {
      this.logger.debug(`drop invalid position event: ${parsed.error.issues[0]?.message}`);
      return null;
    }
    return parsed.data;
  }
}
