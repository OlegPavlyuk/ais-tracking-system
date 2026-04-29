import { Injectable } from '@nestjs/common';
import { Env, EnvSchema } from './env.schema';

@Injectable()
export class ConfigService {
  private readonly env: Env;

  constructor(rawEnv: NodeJS.ProcessEnv = process.env) {
    const parsed = EnvSchema.safeParse(rawEnv);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      throw new Error(`Invalid environment configuration: ${issues}`);
    }
    this.env = parsed.data;
  }

  get<K extends keyof Env>(key: K): Env[K] {
    return this.env[key];
  }

  get all(): Readonly<Env> {
    return this.env;
  }
}
