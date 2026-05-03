import { Injectable } from '@nestjs/common';
import { DropReason } from '../../shared/metrics/drop-reasons';

// ExtendedClassBPositionReport (Type 19) is observed in fixtures but intentionally
// deferred: it is a hybrid (position + Name/ShipType/Dimension) and not yet
// declared in docs/architecture-decisions.md. Decide its mapping before adding.
export const VESSEL_MESSAGE_TYPES = new Set<string>([
  'PositionReport',
  'StandardClassBPositionReport',
  'StaticDataReport',
  'ShipStaticData',
]);

export type RawFilterResult =
  | { accepted: true }
  | { accepted: false; reason: Extract<DropReason, 'non_vessel_mmsi' | 'invalid'> };

interface AisStreamLike {
  MessageType?: string;
  MetaData?: { MMSI?: number | string };
}

/**
 * Drops AISStream messages that are not vessel-originated or whose MMSI is not a
 * 9-digit operational identifier (base stations, AtoN, SAR aircraft, etc.).
 * Provider-scoped: tied to AISStream's `MessageType` / `MetaData.MMSI` envelope.
 */
@Injectable()
export class AisStreamRawFilter {
  accept(raw: unknown): RawFilterResult {
    if (!raw || typeof raw !== 'object') return { accepted: false, reason: 'invalid' };
    const msg = raw as AisStreamLike;
    if (!msg.MessageType || !VESSEL_MESSAGE_TYPES.has(msg.MessageType)) {
      return { accepted: false, reason: 'non_vessel_mmsi' };
    }
    const mmsi = String(msg.MetaData?.MMSI ?? '');
    if (!/^\d{9}$/.test(mmsi)) return { accepted: false, reason: 'non_vessel_mmsi' };
    return { accepted: true };
  }
}
