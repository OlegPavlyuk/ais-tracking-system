import { Injectable } from '@nestjs/common';
import { DropReason } from '../../shared/metrics/drop-reasons';
import {
  AisStreamAcceptedMessageType,
  isAisStreamAcceptedMessageType,
} from './aisstream.message-types';
import { AisStreamEnvelope, AisStreamUnknownMessage } from './aisstream.raw-types';

export type RawFilterResult =
  | { accepted: true }
  | { accepted: false; reason: Extract<DropReason, 'non_vessel_mmsi' | 'invalid'> };

/**
 * Drops AISStream messages that are not vessel-originated or whose MMSI is not a
 * 9-digit operational identifier (base stations, AtoN, SAR aircraft, etc.).
 * Provider-scoped: tied to AISStream's `MessageType` / `MetaData.MMSI` envelope.
 */
@Injectable()
export class AisStreamRawFilter {
  accept(raw: unknown): RawFilterResult {
    if (!isRecord(raw)) return { accepted: false, reason: 'invalid' };
    const msg = raw as AisStreamUnknownMessage;
    if (typeof msg.MessageType !== 'string') {
      return { accepted: false, reason: 'invalid' };
    }
    if (!isAisStreamAcceptedMessageType(msg.MessageType)) {
      return { accepted: false, reason: 'non_vessel_mmsi' };
    }
    if (!isAcceptedEnvelope(msg, msg.MessageType)) {
      return { accepted: false, reason: 'invalid' };
    }
    const mmsi = String(msg.MetaData?.MMSI ?? '');
    if (!/^\d{9}$/.test(mmsi)) return { accepted: false, reason: 'non_vessel_mmsi' };
    return { accepted: true };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAcceptedEnvelope(
  msg: AisStreamUnknownMessage,
  messageType: AisStreamAcceptedMessageType,
): msg is AisStreamEnvelope<AisStreamAcceptedMessageType, unknown> {
  if (!isRecord(msg.Message)) return false;
  return isRecord(msg.Message[messageType]);
}
