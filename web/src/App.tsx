import { useCallback, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import { MapView } from './map/MapView';
import { useVesselsLayer } from './map/useVesselsLayer';
import { useVesselClick } from './map/useVesselClick';
import { useVesselHover } from './map/useVesselHover';
import { ErrorNotice } from './components/ErrorNotice';
import { StatusPill } from './components/StatusPill';
import { VesselDetailPopup } from './components/VesselDetailPopup';
import { MapLegend } from './components/MapLegend';
import { useVesselsStore } from './store/vessels';
import { useVesselRealtimeSync } from './realtime/useVesselRealtimeSync';

type SelectedVessel = {
  mmsi: string;
  vesselId: string | null;
  anchorLngLat: [number, number];
};

export function App() {
  const [map, setMap] = useState<MlMap | null>(null);
  const [selectedVessel, setSelectedVessel] = useState<SelectedVessel | null>(null);

  useVesselRealtimeSync();
  useVesselsLayer(map);
  useVesselClick(map, setSelectedVessel);
  useVesselHover(map, selectedVessel !== null);

  const handleMapError = useCallback((err: Error) => {
    useVesselsStore.getState().setError({ code: 'MAP_INIT', message: err.message });
  }, []);

  return (
    <div className="relative h-full w-full">
      <MapView onReady={setMap} onError={handleMapError} />
      <StatusPill />
      <ErrorNotice />
      <MapLegend />
      {map && selectedVessel && (
        <VesselDetailPopup
          map={map}
          selectedVessel={selectedVessel}
          onClose={() => setSelectedVessel(null)}
        />
      )}
    </div>
  );
}
