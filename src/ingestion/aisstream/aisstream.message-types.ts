export const AISSTREAM_ACCEPTED_MESSAGE_TYPES = [
  'PositionReport',
  'StandardClassBPositionReport',
  'ExtendedClassBPositionReport',
  'StaticDataReport',
  'ShipStaticData',
] as const;

export type AisStreamAcceptedMessageType = (typeof AISSTREAM_ACCEPTED_MESSAGE_TYPES)[number];

const acceptedMessageTypeSet = new Set<string>(AISSTREAM_ACCEPTED_MESSAGE_TYPES);

export function isAisStreamAcceptedMessageType(
  value: string,
): value is AisStreamAcceptedMessageType {
  return acceptedMessageTypeSet.has(value);
}
