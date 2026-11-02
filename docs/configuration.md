# Configuration reference

All runtimes read the same environment variables. In the browser there is no environment, so the same settings are
passed as options to `initWebTelemetry`.

**Precedence:** explicit option/argument > environment variable > default.

| Variable | Option (Node / Python) | Default | Meaning |
|---|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `endpoint` | none | Base URL of the SigNoz collector's OTLP/HTTP receiver, e.g. `http://signoz.internal:4318`. **Telemetry is off when this is empty.** Do not add `/v1/traces`; a pasted signal path is stripped. |
| `OTEL_SERVICE_NAME` | `serviceName` / `service_name` | `unknown-service` | How the service appears in SigNoz. Must be unique per service. |
| `OTEL_SERVICE_VERSION` | `serviceVersion` / `service_version` | none | Release version, shown as `service.version`. |
| `DEPLOYMENT_ENVIRONMENT` | `environment` | none | `production`, `staging`, ... Recorded as `deployment.environment.name`. Also read from `OTEL_RESOURCE_ATTRIBUTES` (`deployment.environment=...`). |
| `OTEL_EXPORTER_OTLP_HEADERS` | `headers` | none | `key=value,key2=value2` sent with every export, e.g. an ingestion key. Explicit headers win. |
| `OTEL_RESOURCE_ATTRIBUTES` | `resourceAttributes` / `resource_attributes` | none | Extra attributes attached to everything the service emits. |
| `OTEL_ENABLED` | `enabled: false` | on | `false`/`0`/`no`/`off` turns telemetry off even if an endpoint is set. |
| `OTEL_SDK_DISABLED` | none | off | Standard OpenTelemetry kill switch; `true` turns everything off. |

## Behaviour that follows from this

- **No endpoint, no telemetry.** Calling the start function is always safe: it returns a handle with
  `enabled: false` and does nothing else.
- **Calling start twice is safe.** The second call returns the first handle; it never registers a second provider.
- **Switching off wins.** `enabled: false`, `OTEL_ENABLED=false` or `OTEL_SDK_DISABLED=true` disable telemetry
  regardless of the endpoint.

## Node-only options

| Option | Default | Meaning |
|---|---|---|
| `ignoreIncomingPaths` | `/health`, `/healthz`, `/ready`, `/ping`, `/metrics` | Incoming request paths that are not traced. |
| `autoInstrumentations` | none | Per-instrumentation overrides passed to `getNodeAutoInstrumentations`. |
| `metricsIntervalSeconds` | `30` | How often metrics are exported. |
| `logs` | `true` | Export logs over OTLP. |
| `flushOnSignals` | `true` | Flush the last batch on `SIGTERM`/`SIGINT` and when the process finishes by itself. Turn off only if your code calls `shutdown()`. |

## Browser-only options

| Option | Default | Meaning |
|---|---|---|
| `propagateTraceHeaderCorsUrls` | none | Backend URLs that get the `traceparent` header. Same-origin requests always do. |
| `ignoreUrls` | none | URLs not to trace. The telemetry endpoint is always excluded. |
| `sampleRatio` | `1` | Fraction of traces to record (0 to 1). |
| `instrumentations` | all on | `{ documentLoad, fetch, xhr }`, set any to `false` to turn it off. |
| `captureErrors` | `true` | Record uncaught errors and unhandled promise rejections as spans. |

## Python-only options

| Argument | Default | Meaning |
|---|---|---|
| `logs` | `True` | Forward the standard `logging` output over OTLP. |
| `log_level` | `INFO` | Minimum level forwarded. |
| `metrics_interval_seconds` | `30` | Metric export interval. |
| `extra_span_processors`, `extra_metric_readers`, `extra_log_processors` | none | Additional destinations next to SigNoz (see [dual export](python.md#dual-export-axiom-and-signoz)). |
