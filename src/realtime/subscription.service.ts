import { Injectable } from '@nestjs/common';
import { Bbox } from '../shared/config/constants';

@Injectable()
export class SubscriptionService {
  private readonly bboxes = new Map<string, Bbox>();

  set(connectionId: string, bbox: Bbox): void {
    this.bboxes.set(connectionId, bbox);
  }

  remove(connectionId: string): void {
    this.bboxes.delete(connectionId);
  }

  get(connectionId: string): Bbox | undefined {
    return this.bboxes.get(connectionId);
  }

  size(): number {
    return this.bboxes.size;
  }

  /** Connection IDs whose bbox contains the given point. */
  matchPosition(lat: number, lon: number): string[] {
    const out: string[] = [];
    for (const [id, b] of this.bboxes) {
      if (lon >= b.minLon && lon <= b.maxLon && lat >= b.minLat && lat <= b.maxLat) {
        out.push(id);
      }
    }
    return out;
  }

  /** Static events have no lat/lon; fan to every subscribed connection. */
  allSubscribed(): string[] {
    return Array.from(this.bboxes.keys());
  }
}
