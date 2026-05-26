import type { Vessel } from '@/store/types';
import { shipTypeColor } from '@/lib/shipTypeColor';
import { markerShape } from '@/lib/markerShape';

export interface VesselFeatureProps {
  mmsi: string;
  rotation: number;
  color: string;
  sanctionsStatus: 'clear' | 'candidate' | 'sanctioned' | null;
  markerShape: 'arrow' | 'circle';
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
        rotation,
        color: shipTypeColor(v.shipType),
        sanctionsStatus: v.sanctionsStatus,
        markerShape: markerShape(v.navStatus, v.sog),
      },
    });
  }
  return { type: 'FeatureCollection', features };
}
