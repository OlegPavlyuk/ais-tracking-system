import {
  AIS_COVERAGE_BBOXES,
  BLACK_SEA_BBOX,
  LEVANT_EAST_MEDITERRANEAN_BBOX,
  pointInAnyBbox,
  toAisStreamBoundingBox,
} from './constants';

describe('coverage bbox helpers', () => {
  it('converts internal lon/lat bbox format to AISStream lat/lon corners', () => {
    expect(toAisStreamBoundingBox(BLACK_SEA_BBOX)).toEqual([
      [BLACK_SEA_BBOX.minLat, BLACK_SEA_BBOX.minLon],
      [BLACK_SEA_BBOX.maxLat, BLACK_SEA_BBOX.maxLon],
    ]);
  });

  it('accepts points inside the Black Sea coverage bbox', () => {
    expect(pointInAnyBbox(44, 35, AIS_COVERAGE_BBOXES)).toBe(true);
  });

  it('accepts points inside one of the Mediterranean coverage bboxes', () => {
    const lat = (LEVANT_EAST_MEDITERRANEAN_BBOX.minLat + LEVANT_EAST_MEDITERRANEAN_BBOX.maxLat) / 2;
    const lon = (LEVANT_EAST_MEDITERRANEAN_BBOX.minLon + LEVANT_EAST_MEDITERRANEAN_BBOX.maxLon) / 2;
    expect(pointInAnyBbox(lat, lon, AIS_COVERAGE_BBOXES)).toBe(true);
  });

  it('rejects points outside every supported coverage bbox', () => {
    expect(pointInAnyBbox(0, 0, AIS_COVERAGE_BBOXES)).toBe(false);
  });
});
