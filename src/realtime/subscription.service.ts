import { Injectable } from '@nestjs/common';

@Injectable()
export class SubscriptionService {
  private readonly connectionIds = new Set<string>();

  add(connectionId: string): void {
    this.connectionIds.add(connectionId);
  }

  remove(connectionId: string): void {
    this.connectionIds.delete(connectionId);
  }

  forEachSubscribed(visitor: (connectionId: string) => void): void {
    for (const connectionId of this.connectionIds) {
      visitor(connectionId);
    }
  }
}
