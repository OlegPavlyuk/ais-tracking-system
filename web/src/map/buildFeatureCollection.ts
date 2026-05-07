import type { Vessel } from '@/store/types';
import { shipTypeColor } from '@/lib/shipTypeColor';
import { navStatusLabel } from '@/lib/navStatusLabel';
import { markerShape } from '@/lib/markerShape';

export interface VesselFeatureProps {
  mmsi: string;
  vesselName: string | null;
  rotation: number;
  shipType: number | null;
  color: string;
  navStatusLabel: string;
  markerShape: 'arrow' | 'circle';
  occurredAt: string | null;
}

export interface VesselFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: VesselFeatureProps;
}

export interface VesselFeatureCollection {
  type: 'FeatureCollection';
  features: VesselFeature[];
}

export function buildFeatureCollection(
  vessels: ReadonlyMap<string, Vessel>,
): VesselFeatureCollection {
  const features: VesselFeature[] = [];
  for (const v of vessels.values()) {
    if (v.lat === null || v.lon === null) continue;
    const cog = v.cog !== null && v.cog >= 0 && v.cog <= 359 ? v.cog : null;
    const heading =
      v.trueHeading !== null && v.trueHeading >= 0 && v.trueHeading <= 359
        ? v.trueHeading
        : null;
    const rotation = cog ?? heading ?? 0;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
      properties: {
        mmsi: v.mmsi,
        vesselName: v.name,
        rotation,
        shipType: v.shipType,
        color: shipTypeColor(v.shipType),
        navStatusLabel: navStatusLabel(v.navStatus),
        markerShape: markerShape(v.navStatus, v.sog),
        occurredAt: v.occurredAt,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}
