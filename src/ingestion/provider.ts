import { CanonicalEvent, RawProviderMessage } from '../contracts';
import { ProviderHealth } from '../shared/health/provider-health';

export type RawMessageHandler = (msg: RawProviderMessage<unknown>) => void;

/** Transport boundary: connect/reconnect, auth, raw-message emission, health surface. */
export interface AisProviderAdapter {
  readonly id: string;
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
  onMessage(handler: RawMessageHandler): void;
  health(): ProviderHealth;
}

/** Semantic boundary: convert provider-shaped raw messages into canonical events. */
export interface ProviderNormalizer {
  readonly provider: string;
  normalize(raw: RawProviderMessage<unknown>, now?: Date): CanonicalEvent | null;
}

export interface ProviderPair {
  adapter: AisProviderAdapter;
  normalizer: ProviderNormalizer;
}
