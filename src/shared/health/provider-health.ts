export interface ProviderHealth {
  providerId: string;
  connected: boolean;
  lastMessageAt: string | null;
  reconnectCount: number;
  startedAt: string | null;
}

export interface ProviderHealthSource {
  snapshots(): ProviderHealth[];
}

export const PROVIDER_HEALTH_SOURCE = Symbol('PROVIDER_HEALTH_SOURCE');
