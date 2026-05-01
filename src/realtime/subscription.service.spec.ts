import { SubscriptionService } from './subscription.service';

const BBOX_A = { minLon: 30, minLat: 41, maxLon: 35, maxLat: 44 };
const BBOX_B = { minLon: 28, minLat: 42, maxLon: 33, maxLat: 45 };

describe('SubscriptionService', () => {
  it('stores and updates a per-connection bbox', () => {
    const s = new SubscriptionService();
    s.set('c1', BBOX_A);
    expect(s.get('c1')).toEqual(BBOX_A);
    s.set('c1', BBOX_B);
    expect(s.get('c1')).toEqual(BBOX_B);
  });

  it('removes a connection', () => {
    const s = new SubscriptionService();
    s.set('c1', BBOX_A);
    s.remove('c1');
    expect(s.get('c1')).toBeUndefined();
    expect(s.size()).toBe(0);
  });

  it('matches connections whose bbox contains the position', () => {
    const s = new SubscriptionService();
    s.set('c1', BBOX_A);
    s.set('c2', BBOX_B);
    // (32, 43) is in both
    expect(s.matchPosition(43, 32).sort()).toEqual(['c1', 'c2']);
    // (43.5, 32) is only in B (lat too high for A)
    expect(s.matchPosition(44.5, 32)).toEqual(['c2']);
    // (40, 32) is in neither (lat too low)
    expect(s.matchPosition(40, 32)).toEqual([]);
  });

  it('treats bbox edges as inclusive', () => {
    const s = new SubscriptionService();
    s.set('c1', BBOX_A);
    expect(s.matchPosition(BBOX_A.maxLat, BBOX_A.maxLon)).toEqual(['c1']);
    expect(s.matchPosition(BBOX_A.minLat, BBOX_A.minLon)).toEqual(['c1']);
  });

  it('returns all subscribed connection ids for static fanout', () => {
    const s = new SubscriptionService();
    s.set('c1', BBOX_A);
    s.set('c2', BBOX_B);
    expect(s.allSubscribed().sort()).toEqual(['c1', 'c2']);
  });
});
