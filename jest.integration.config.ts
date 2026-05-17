import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test/integration'],
  testRegex: '.*\\.integration\\.spec\\.ts$',
  globalSetup: '<rootDir>/test/integration/setup/global-setup.ts',
  globalTeardown: '<rootDir>/test/integration/setup/global-teardown.ts',
  setupFilesAfterEnv: ['<rootDir>/test/integration/setup/setup-file.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
};

export default config;
