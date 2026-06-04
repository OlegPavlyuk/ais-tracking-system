# Deployment

Production deployment uses GitHub Actions to build images, push them to GCP Artifact Registry, copy deployment files to the VM, run migrations, restart services, and execute smoke checks.

## Runtime Model

One backend image is reused with role-specific `PROCESS_ROLE` values:

- `api`: REST API, admin controllers, health/readiness, WebSocket gateway.
- `ingestion`: provider ingestion, normalization pipeline, storage writer.
- `worker`: sanctions import, vessel enrichment, reconciliation jobs.

The production Docker Compose stack also includes Nginx, Postgres/PostGIS, Redis, Prometheus, Grafana, a migrator image, and geo import support.

## Deployment Flow

1. Run CI quality gates.
2. Build backend, migrator, geo-import, and frontend images.
3. Push images tagged with the deploy SHA.
4. Copy Compose and script files to the VM.
5. Run the deploy script with the target SHA and registry.
6. Run smoke checks against local Nginx and public HTTPS routes.

Rollback uses the previous image metadata recorded under `.deploy/releases` on the VM.

Related docs:

- [GCP VM runbook](gcp-vm-runbook.md)
- [HTTPS and domain runbook](https-domain-runbook.md)
- [Operations runbook](operations-runbook.md)
- [Restore drill](restore-drill.md)
