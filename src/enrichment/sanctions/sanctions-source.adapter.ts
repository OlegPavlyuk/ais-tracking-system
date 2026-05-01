export interface VesselEntity {
  sourceEntityId: string;
  name: string;
  imo: string | null;
  mmsi: string | null;
  aliases: string[];
  flag: string | null;
  listingDate: string | null;
  programs: string[];
  rawPayload: Record<string, unknown>;
}

export interface SanctionsSourceAdapter {
  readonly source: string;
  fetchAll(): AsyncIterable<VesselEntity>;
}
