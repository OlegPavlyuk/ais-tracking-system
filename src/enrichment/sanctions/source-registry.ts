export interface SanctionsSourceMeta {
  id: string;
  name: string;
  url: string;
  license: string;
  attribution: string;
}

export const SANCTIONS_SOURCE_REGISTRY: SanctionsSourceMeta[] = [
  {
    id: 'ofac',
    name: 'OFAC SDN (Specially Designated Nationals)',
    url: 'https://sanctionslistservice.ofac.treas.gov/api/download/SDN.XML',
    license: 'Public Domain (U.S. Government work)',
    attribution: 'U.S. Department of the Treasury, Office of Foreign Assets Control',
  },
];
