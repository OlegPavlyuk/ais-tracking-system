import { MapView } from './map/MapView';
import { StatusPill } from './components/StatusPill';
import { CoverageBanner } from './components/CoverageBanner';

export function App() {
  return (
    <div className="relative h-full w-full">
      <MapView />
      <StatusPill />
      <CoverageBanner />
    </div>
  );
}
