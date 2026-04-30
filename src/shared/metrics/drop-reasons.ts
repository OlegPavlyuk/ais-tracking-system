export const DROP_REASONS = [
  'duplicate',
  'sampled',
  'out_of_bbox',
  'non_vessel_mmsi',
  'invalid',
] as const;
export type DropReason = (typeof DROP_REASONS)[number];

export const AIS_MESSAGES_DROPPED_TOTAL = 'ais_messages_dropped_total';
