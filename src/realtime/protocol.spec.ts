import { ClientMessageSchema } from './protocol';

describe('ClientMessageSchema', () => {
  it('accepts subscribe without coverage payload', () => {
    expect(ClientMessageSchema.safeParse({ type: 'subscribe' }).success).toBe(true);
  });

  it('rejects stale subscribe payloads that still include bbox', () => {
    expect(
      ClientMessageSchema.safeParse({
        type: 'subscribe',
        bbox: { minLon: 1, minLat: 2, maxLon: 3, maxLat: 4 },
      }).success,
    ).toBe(false);
  });

  it('rejects update_subscription messages from the retired viewport protocol', () => {
    expect(
      ClientMessageSchema.safeParse({
        type: 'update_subscription',
        bbox: { minLon: 1, minLat: 2, maxLon: 3, maxLat: 4 },
      }).success,
    ).toBe(false);
  });
});
