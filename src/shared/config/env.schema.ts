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
});

export type Env = z.infer<typeof EnvSchema>;
