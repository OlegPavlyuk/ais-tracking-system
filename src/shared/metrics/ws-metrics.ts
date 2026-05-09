export const WS_DROP_REASONS = ['superseded', 'queue_overflow', 'invalid_payload'] as const;
export type WsDropReason = (typeof WS_DROP_REASONS)[number];

export const WS_CONNECTIONS_ACTIVE = 'ws_connections_active';
export const WS_MESSAGES_SENT_TOTAL = 'ws_messages_sent_total';
export const WS_MESSAGES_DROPPED_TOTAL = 'ws_messages_dropped_total';
export const WS_SUBSCRIPTIONS_ACCEPTED_TOTAL = 'ws_subscriptions_accepted_total';
