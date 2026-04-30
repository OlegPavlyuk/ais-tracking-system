import { config as loadDotenv } from 'dotenv';

export function loadEnvFileForLocalDevelopment(): void {
  if (process.env.NODE_ENV === 'production') return;
  loadDotenv();
}
