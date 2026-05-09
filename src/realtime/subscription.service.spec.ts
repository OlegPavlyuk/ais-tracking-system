import { SubscriptionService } from './subscription.service';

describe('SubscriptionService', () => {
  function collectSubscribed(service: SubscriptionService): string[] {
    const ids: string[] = [];
    service.forEachSubscribed((id) => ids.push(id));
    return ids;
  }

  it('tracks subscribed connections', () => {
    const s = new SubscriptionService();
    s.add('c1');
    s.add('c1');
    expect(collectSubscribed(s)).toEqual(['c1']);
  });

  it('removes a connection', () => {
    const s = new SubscriptionService();
    s.add('c1');
    s.remove('c1');
    expect(collectSubscribed(s)).toEqual([]);
  });

  it('returns all subscribed connection ids for static fanout', () => {
    const s = new SubscriptionService();
    s.add('c1');
    s.add('c2');
    expect(collectSubscribed(s).sort()).toEqual(['c1', 'c2']);
  });
});
