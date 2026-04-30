import { VesselsController } from './vessels.controller';
import { VesselsRepository } from '../storage/vessels.repository';
import { ApiError } from '../shared/errors/api-error';

describe('VesselsController', () => {
  function makeController() {
    const repo = { findInBbox: jest.fn().mockResolvedValue([]) } as unknown as VesselsRepository;
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
});
