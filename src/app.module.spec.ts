import { AppModule } from './app.module';
import { ApiModule } from './api/api.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { StorageModule } from './storage/storage.module';
import { EnrichmentModule } from './enrichment/enrichment.module';
import { RealtimeModule } from './realtime/realtime.module';
import { AdminModule } from './admin/admin.module';

describe('AppModule role composition', () => {
  function importsFor(role: 'all' | 'api' | 'ingestion' | 'worker'): unknown[] {
    return AppModule.forRole(role).imports ?? [];
  }

  it('boots storage writer and partition maintenance only in all and ingestion roles', () => {
    expect(importsFor('all')).toContain(StorageModule);
    expect(importsFor('ingestion')).toContain(StorageModule);
    expect(importsFor('api')).not.toContain(StorageModule);
    expect(importsFor('worker')).not.toContain(StorageModule);
  });

  it('keeps api and worker roles on their intended module boundaries', () => {
    expect(importsFor('api')).toEqual(
      expect.arrayContaining([ApiModule, AdminModule, RealtimeModule]),
    );
    expect(importsFor('api')).not.toEqual(
      expect.arrayContaining([IngestionModule, PipelineModule]),
    );

    expect(importsFor('worker')).toContain(EnrichmentModule);
    expect(importsFor('worker')).not.toEqual(
      expect.arrayContaining([ApiModule, IngestionModule, PipelineModule, RealtimeModule]),
    );
  });
});
