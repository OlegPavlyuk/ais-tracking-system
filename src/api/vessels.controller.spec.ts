import { VesselsController } from './vessels.controller';
import { VesselDetailRow, VesselsRepository } from '../storage/vessels.repository';
import { ApiError } from '../shared/errors/api-error';

describe('VesselsController', () => {
  function makeController() {
    const repo = {
      findInBbox: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
      findTrack: jest.fn().mockResolvedValue({ kind: 'points', points: [] }),
    } as unknown as VesselsRepository;
    return { controller: new VesselsController(repo), repo };
  }

  it('returns vessels for an in-scope bbox', async () => {
    const { controller, repo } = makeController();
    const result = await controller.list({ bbox: '28,41,42,47' });
    expect(result).toEqual({ vessels: [] });
    expect(repo.findInBbox).toHaveBeenCalledWith(
      { minLon: 28, minLat: 41, maxLon: 42, maxLat: 47 },
      24 * 60 * 60 * 1000,
      2000,
    );
  });

  it('rejects out-of-Black-Sea bbox with BBOX_OUT_OF_SCOPE', async () => {
    const { controller } = makeController();
    await expect(controller.list({ bbox: '0,0,10,10' })).rejects.toMatchObject({
      response: { error: { code: 'BBOX_OUT_OF_SCOPE' } },
      status: 400,
    });
  });

  it('rejects malformed bbox with INVALID_QUERY', async () => {
    const { controller } = makeController();
    await expect(controller.list({ bbox: 'nope' })).rejects.toBeInstanceOf(ApiError);
    await expect(controller.list({ bbox: '42,47,28,41' })).rejects.toMatchObject({
      response: { error: { code: 'INVALID_QUERY' } },
    });
  });

  describe('GET /api/vessels/:id', () => {
    const validId = '11111111-2222-3333-4444-555555555555';

    function detailRow(overrides: Partial<VesselDetailRow> = {}): VesselDetailRow {
      return {
        id: validId,
        mmsi: '210098000',
        imo: '9807322',
        name: 'STENA EMBLA',
        callSign: '5BQA5',
        shipType: 61,
        destination: 'BELFAST<>BIRKINHEAD',
        dimensionToBow: 55,
        dimensionToStern: 160,
        dimensionToPort: 3,
        dimensionToStarboard: 25,
        sanctionsStatus: null,
        sanctionsCheckedAt: null,
        sanctionsMatches: [],
        position: {
          lon: 41.5,
          lat: 41.5,
          sog: 0.1,
          cog: 26.9,
          trueHeading: 261,
          navStatus: 5,
          rateOfTurn: 0,
          occurredAt: '2026-04-30T06:29:19.087Z',
          lastSeenAt: '2026-04-30T06:30:00.000Z',
        },
        ...overrides,
      };
    }

    it('returns full profile with sanctions placeholders', async () => {
      const { controller, repo } = makeController();
      (repo.findById as jest.Mock).mockResolvedValue(detailRow());
      const res = await controller.detail(validId);
      expect(repo.findById).toHaveBeenCalledWith(validId);
      expect(res).toMatchObject({
        id: validId,
        mmsi: '210098000',
        name: 'STENA EMBLA',
        sanctionsStatus: null,
        sanctionsCheckedAt: null,
        sanctionsMatches: [],
      });
      expect(res.position).not.toBeNull();
    });

    it('returns 404 envelope when vessel id is unknown', async () => {
      const { controller } = makeController();
      await expect(controller.detail(validId)).rejects.toMatchObject({
        response: { error: { code: 'VESSEL_NOT_FOUND' } },
        status: 404,
      });
    });

    it('rejects non-UUID id with INVALID_QUERY', async () => {
      const { controller } = makeController();
      await expect(controller.detail('210098000')).rejects.toMatchObject({
        response: { error: { code: 'INVALID_QUERY' } },
        status: 400,
      });
    });
  });

  describe('GET /api/vessels/:id/track', () => {
    const validId = '11111111-2222-3333-4444-555555555555';
    const from = '2026-04-23T00:00:00.000Z';
    const to = '2026-04-30T00:00:00.000Z';

    it('returns points when simplify is omitted', async () => {
      const { controller, repo } = makeController();
      (repo.findTrack as jest.Mock).mockResolvedValue({
        kind: 'points',
        points: [{ lon: 41.5, lat: 41.5, occurredAt: from, sog: 0.1, cog: 26.9, navStatus: 5 }],
      });
      const res = await controller.track(validId, { from, to });
      expect(repo.findTrack).toHaveBeenCalledWith(validId, new Date(from), new Date(to), undefined);
      expect(res).toEqual({
        vesselId: validId,
        from,
        to,
        points: [{ lon: 41.5, lat: 41.5, occurredAt: from, sog: 0.1, cog: 26.9, navStatus: 5 }],
      });
    });

    it('returns GeoJSON LineString when simplify is provided', async () => {
      const { controller, repo } = makeController();
      (repo.findTrack as jest.Mock).mockResolvedValue({
        kind: 'linestring',
        coordinates: [
          [41.5, 41.5],
          [41.6, 41.7],
        ],
      });
      const res = await controller.track(validId, { from, to, simplify: '500' });
      expect(repo.findTrack).toHaveBeenCalledWith(validId, new Date(from), new Date(to), 500);
      expect(res).toEqual({
        vesselId: validId,
        from,
        to,
        simplifyMeters: 500,
        geometry: {
          type: 'LineString',
          coordinates: [
            [41.5, 41.5],
            [41.6, 41.7],
          ],
        },
      });
    });

    it('rejects from >= to with INVALID_QUERY', async () => {
      const { controller } = makeController();
      await expect(controller.track(validId, { from: to, to: from })).rejects.toMatchObject({
        response: { error: { code: 'INVALID_QUERY' } },
        status: 400,
      });
    });

    it('rejects window > 7 days with INVALID_QUERY', async () => {
      const { controller } = makeController();
      const wide = '2026-05-01T00:00:01.000Z';
      await expect(controller.track(validId, { from, to: wide })).rejects.toMatchObject({
        response: { error: { code: 'INVALID_QUERY' } },
        status: 400,
      });
    });

    it('rejects non-UUID id with INVALID_QUERY', async () => {
      const { controller } = makeController();
      await expect(controller.track('not-a-uuid', { from, to })).rejects.toMatchObject({
        response: { error: { code: 'INVALID_QUERY' } },
        status: 400,
      });
    });

    it('rejects non-positive simplify with INVALID_QUERY', async () => {
      const { controller } = makeController();
      await expect(controller.track(validId, { from, to, simplify: '0' })).rejects.toMatchObject({
        response: { error: { code: 'INVALID_QUERY' } },
        status: 400,
      });
    });

    it('rejects malformed from/to with INVALID_QUERY', async () => {
      const { controller } = makeController();
      await expect(controller.track(validId, { from: 'not-a-date', to })).rejects.toMatchObject({
        response: { error: { code: 'INVALID_QUERY' } },
        status: 400,
      });
    });
  });
});
