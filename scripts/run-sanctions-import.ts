import 'reflect-metadata';
import { resolve } from 'node:path';
import { loadEnvFileForLocalDevelopment } from '../src/shared/config/load-env';

loadEnvFileForLocalDevelopment();

import { ConfigService } from '../src/shared/config/config.service';
import { DbService } from '../src/shared/db/db.service';
import { OfacAdapter } from '../src/enrichment/sanctions/ofac.adapter';
import { SanctionsImporterService } from '../src/enrichment/sanctions/sanctions-importer.service';
import { SanctionsRepository } from '../src/enrichment/sanctions/sanctions.repository';

async function main() {
  const config = new ConfigService(process.env);
  const db = new DbService(config);
  const repo = new SanctionsRepository(db);
  const importer = new SanctionsImporterService(repo, config);

  const fixturePath = resolve(__dirname, '../docs/fixtures/ofac-sdn-sample.xml');
  const adapter = OfacAdapter.fromFile(fixturePath);

  const result = await importer.run(adapter);
  console.log('import result:', result);

  await db.onModuleDestroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
