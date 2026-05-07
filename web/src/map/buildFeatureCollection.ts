import type { Vessel } from '@/store/types';
import { shipTypeColor } from '@/lib/shipTypeColor';

export interface VesselFeatureProps {
  mmsi: string;
  rotation: number;
  shipType: number | null;
  color: string;
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
    const rotation = v.cog ?? v.trueHeading ?? 0;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
      properties: {
        mmsi: v.mmsi,
        rotation,
        shipType: v.shipType,
        color: shipTypeColor(v.shipType),
      },
    });
  }
  return { type: 'FeatureCollection', features };
}
