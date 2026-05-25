import { toOgrReadablePath } from '../../scripts/geo/import-geo-datasets';

describe('geo import OGR path handling', () => {
  it('uses direct paths for non-archive sources', () => {
    expect(toOgrReadablePath({ absolutePath: '/tmp/source.geojson' })).toBe('/tmp/source.geojson');
  });

  it('uses GDAL vsizip paths for zip sources', () => {
    expect(toOgrReadablePath({ absolutePath: '/tmp/source.zip' })).toBe('/vsizip//tmp/source.zip');
  });

  it('appends archive-internal paths for nested shapefiles', () => {
    expect(
      toOgrReadablePath({
        absolutePath: '/tmp/land.zip',
        archivePath: 'land-polygons-split-4326/land_polygons.shp',
      }),
    ).toBe('/vsizip//tmp/land.zip/land-polygons-split-4326/land_polygons.shp');
  });

  it('normalizes leading slashes in archive-internal paths', () => {
    expect(
      toOgrReadablePath({
        absolutePath: '/tmp/water.zip',
        archivePath: '/water-polygons-split-4326/water_polygons.shp',
      }),
    ).toBe('/vsizip//tmp/water.zip/water-polygons-split-4326/water_polygons.shp');
  });
});
