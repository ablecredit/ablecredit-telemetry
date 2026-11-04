# Changelog

All notable changes are recorded here. Versions follow [semver](https://semver.org); consumers pin a git tag
(for example `#v0.1.0`).

## Unreleased

- Request bodies: `recordRequestBody` (Node) and `record_request_body` / `sanitize_body` (Python) record a request body as `http.request.body`,
  masked (sensitive keys and values), shortened and size-capped, with the same rules in both languages. Credential-like routes and file
  uploads are skipped; `OTEL_CAPTURE_REQUEST_BODY=false` turns it off.
- Python: `otlp_span_processor`, `otlp_metric_reader` and `otlp_log_processor` add SigNoz to providers a service already owns (for example
  one that exports to Axiom). `setup_telemetry` gained `traces`, `metrics` and `logs` switches, and its log handler no longer re-exports
  the exporter's own log lines.
- New helpers (`/node` and `/web`): `captureTraceContext()` and `runInTraceContext()` keep work that runs later, outside any request, in the
  trace of the request that started it; `withoutTracing()` keeps polling loops out of the traces.
- Types: added `typesVersions`, so TypeScript projects that still use `"moduleResolution": "Node"` can import `@ablecredit/telemetry/node` and `/web` (they failed with TS2307 before).
- Resource attributes: the environment is now recorded as both `deployment.environment` (read by SigNoz's *Deployment Environment* filter) and `deployment.environment.name`.
- Web: the telemetry endpoint is now excluded from tracing by a prefix pattern (a plain string never matched `/v1/traces`).
- Docs: clarified that string URLs in `propagateTraceHeaderCorsUrls` / `ignoreUrls` must match the whole URL.

## 0.1.0

Initial release.

- `@ablecredit/telemetry/web`: browser tracing (document load, fetch, XHR, uncaught errors).
- `@ablecredit/telemetry/node`: Node.js traces, metrics and logs, plus `node/register` for `--require`.
- `ablecredit-telemetry` command: `install <node|web>` installs the tested OpenTelemetry peer packages, `check` lists missing ones.
- Node: the last batch is flushed on SIGTERM/SIGINT and when the process finishes by itself.
- `ablecredit-telemetry` (Python): traces, metrics and logs, FastAPI/httpx/botocore helpers, SQS trace propagation,
  extra exporters for dual export (for example Axiom during a migration).
