import { Injectable } from '@nestjs/common';

// ExtendedClassBPositionReport (Type 19) is observed in fixtures but intentionally
// deferred: it is a hybrid (position + Name/ShipType/Dimension) and not yet
// declared in docs/architecture-decisions.md. Decide its mapping before adding.
export const VESSEL_MESSAGE_TYPES = new Set<string>([
  'PositionReport',
  'StandardClassBPositionReport',
  'StaticDataReport',
  'ShipStaticData',
]);

interface AisStreamLike {
  MessageType?: string;
  MetaData?: { MMSI?: number | string };
}

/**
 * Drops AIS messages that are not vessel-originated or whose MMSI is not a
 * 9-digit operational identifier (base stations, AtoN, SAR aircraft, etc.).
 */
@Injectable()
export class RawFilter {
  accept(raw: unknown): boolean {
    if (!raw || typeof raw !== 'object') return false;
    const msg = raw as AisStreamLike;
    if (!msg.MessageType || !VESSEL_MESSAGE_TYPES.has(msg.MessageType)) return false;
    const mmsi = String(msg.MetaData?.MMSI ?? '');
    return /^\d{9}$/.test(mmsi);
  }
}
