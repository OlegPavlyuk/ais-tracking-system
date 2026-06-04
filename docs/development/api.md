# API Reference

The API is intentionally small and optimized for the realtime map client. There is no generated OpenAPI document yet.

## Public API

Public API routes do not require end-user authentication today.

### Routes

| Method | Path                     | Purpose                                               |
| ------ | ------------------------ | ----------------------------------------------------- |
| `GET`  | `/api/vessels`           | Latest vessel snapshot for map bootstrap.             |
| `GET`  | `/api/vessels/:id`       | Vessel profile, latest position, and sanctions state. |
| `GET`  | `/api/vessels/:id/track` | Historical track query for a vessel.                  |
| `GET`  | `/api/sanctions/sources` | Sanctions source metadata and latest import summary.  |
| `WS`   | `/ws/positions`          | Realtime position, static, and enrichment updates.    |

### Query Parameters

`GET /api/vessels`

| Parameter      | Default | Notes                              |
| -------------- | ------- | ---------------------------------- |
| `limit`        | `10000` | Positive integer, maximum `30000`. |
| `staleMinutes` | `1440`  | Positive integer, maximum 7 days.  |

The snapshot endpoint rejects unknown query parameters, including stale bbox parameters.

`GET /api/vessels/:id/track`

| Parameter  | Required | Notes                                                                  |
| ---------- | -------- | ---------------------------------------------------------------------- |
| `from`     | yes      | ISO datetime with offset.                                              |
| `to`       | yes      | ISO datetime with offset; must be after `from`.                        |
| `simplify` | no       | Positive number of meters. Returns a LineString instead of raw points. |

Track requests require a UUID vessel ID and are capped at a 7-day window.

## Admin API

### Authentication

Admin routes use the `x-admin-token` header. If `ADMIN_TOKEN` is unset, admin routes are allowed only in `NODE_ENV=development`; in other environments they return unauthorized and are effectively disabled.

In the production Nginx configuration, public HTTPS access to `/admin` is blocked with `404` before requests reach the backend.

### Routes

| Method | Path                                   | Purpose                                  |
| ------ | -------------------------------------- | ---------------------------------------- |
| `GET`  | `/admin/streams`                       | Inspect stream and consumer-group state. |
| `GET`  | `/admin/deadletter`                    | Inspect DLQ entries.                     |
| `POST` | `/admin/deadletter/:id/replay`         | Replay a DLQ entry.                      |
| `GET`  | `/admin/sanctions/imports`             | List sanctions import runs.              |
| `POST` | `/admin/sanctions/imports/:source/run` | Start a sanctions import for a source.   |

### Query Parameters

`GET /admin/deadletter`

| Parameter | Default          | Notes                            |
| --------- | ---------------- | -------------------------------- |
| `stream`  | `ais.deadletter` | Redis stream to inspect.         |
| `limit`   | `50`             | Positive integer, maximum `500`. |

`GET /admin/sanctions/imports`

| Parameter | Default | Notes                            |
| --------- | ------- | -------------------------------- |
| `limit`   | `20`    | Positive integer, maximum `200`. |

`POST /admin/deadletter/:id/replay` requires a Redis stream ID path parameter such as `1700000000000-0`.

## Operational Endpoints

These endpoints are used by health checks, readiness checks, and monitoring.

| Method | Path       | Purpose                                             |
| ------ | ---------- | --------------------------------------------------- |
| `GET`  | `/healthz` | Process liveness.                                   |
| `GET`  | `/readyz`  | DB/Redis readiness and AIS feed degradation signal. |
| `GET`  | `/metrics` | Prometheus metrics.                                 |

`/readyz` returns `503` when DB or Redis readiness fails. AIS provider feed degradation is reported in the payload but does not by itself make readiness fail.

In the production Nginx configuration, public HTTPS access to `/metrics` is blocked with `404`; Prometheus scrapes it over the internal Compose network.

## Validation and Errors

REST inputs are validated with Zod. API errors use this envelope:

```json
{
  "error": {
    "code": "INVALID_QUERY",
    "message": "invalid query",
    "details": []
  }
}
```

Related docs:

- [Realtime delivery](../architecture/realtime.md)
- [Sanctions enrichment](../architecture/sanctions-enrichment.md)
- [Operations runbook](../operations/operations-runbook.md)
