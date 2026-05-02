import { z } from 'zod';

export const ProcessRoleSchema = z.enum(['all', 'api', 'ingestion', 'worker']);
export type ProcessRole = z.infer<typeof ProcessRoleSchema>;

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PROCESS_ROLE: ProcessRoleSchema.default('all'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  ADMIN_TOKEN: z.string().optional(),

  AIS_PROVIDERS: z
    .string()
    .default('aisstream')
    .transform((s) => s.split(',').map((p) => p.trim()).filter(Boolean)),
  AISSTREAM_API_KEY: z.string().optional(),

  METRICS_ENABLED: z
    .string()
    .default('true')
    .transform((s) => s.toLowerCase() === 'true'),

  DEDUP_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  SAMPLER_MOVING_WINDOW_SECONDS: z.coerce.number().int().positive().default(10),
  SAMPLER_STATIONARY_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  SAMPLER_STATIONARY_SOG_KN: z.coerce.number().nonnegative().default(0.5),
  SAMPLER_STATE_TTL_SECONDS: z.coerce.number().int().positive().default(600),

  WS_SEND_QUEUE_MAX: z.coerce.number().int().positive().default(256),
  WS_BUFFERED_AMOUNT_LIMIT_BYTES: z.coerce.number().int().positive().default(1024 * 1024),
  WS_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),

  ENRICHMENT_STALENESS_SECONDS: z.coerce.number().int().positive().default(7 * 24 * 60 * 60),
  ENRICHMENT_JOB_ATTEMPTS: z.coerce.number().int().positive().default(3),
  ENRICHMENT_JOB_BACKOFF_MS: z.coerce.number().int().positive().default(5000),

  OFAC_SDN_URL: z
    .string()
    .url()
    .default('https://sanctionslistservice.ofac.treas.gov/api/download/SDN.XML'),
  OFAC_SDN_FIXTURE_PATH: z.string().optional(),
  SANCTIONS_IMPORT_CRON: z.string().default('0 3 * * *'),
  SANCTIONS_IMPORT_BATCH_SIZE: z.coerce.number().int().positive().default(500),
});

export type Env = z.infer<typeof EnvSchema>;
