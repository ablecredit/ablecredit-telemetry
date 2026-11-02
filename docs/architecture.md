# Architecture and design decisions

## Goal

Every AbleCredit service reports traces, metrics and logs to SigNoz the same way, so one request can be followed
end to end, and no service has to reinvent the setup.

```
 browser ──traceparent──▶ Node API ──traceparent / SQS attrs──▶ Python worker
    │                        │                                      │
    └────────────────────────┴────────── OTLP/HTTP ────────────────┘
                                   │
                                   ▼
                        SigNoz OTel collector (:4318)
```

## What this repo is, and is not

It is a thin **setup layer** over the official OpenTelemetry SDKs: it creates and registers providers, applies shared
defaults, and offers a few helpers. It does not wrap or replace OpenTelemetry, so everything in the OpenTelemetry
documentation still applies, and a service can drop down to the raw API at any point.

It is not a metrics catalogue, a logging framework, or a place for service-specific instrumentation.

## Decisions

**One repo, one npm package, one Python package.** The runtimes share conventions and a release cadence, so they live
together. npm cannot install a sub-folder of a git repository, so the JavaScript package sits at the repo root, with
`web` and `node` as separate entry points; Python installs from `python/` via `#subdirectory=python`.

**Installed from GitHub, pinned to a tag.** No registry to run or pay for. Pinning a tag gives reproducible builds,
and upgrading is a one-line change in each service. The JavaScript package builds itself on install, so build output
never lives in git.

**OpenTelemetry packages are optional peer dependencies (JavaScript).** Browser and Node need different sets, the Node
set is large, and OpenTelemetry must exist exactly once in an app's tree or tracing silently breaks. Peers solve all
three. The cost is an install list per runtime, which the guides give and which is a tested, version-matched set.

**A small command line helper (`ablecredit-telemetry install|check`).** The peer packages are a version-matched set;
having every README repeat the list invites drift and mistakes. The helper reads the list from `package.json`, so there
is one source of truth and a one-line install for newcomers.

**Off unless configured.** `OTEL_EXPORTER_OTLP_ENDPOINT` is the only switch needed. Developers and tests pay nothing
and need no flags, and a missing variable can never crash a service.

**Failing open.** Exporter errors are swallowed by OpenTelemetry, and batching keeps telemetry off the request path. A
SigNoz outage must never affect users.

**Idempotent start.** Starting twice returns the first handle. OpenTelemetry only allows one global provider, so a
second registration would otherwise warn or do nothing in confusing ways.

**Env vars are the contract; options are the escape hatch.** The standard `OTEL_*` names work in every language and in
infrastructure config (Terraform, Kubernetes). Options exist for the cases env vars cannot express.

**W3C trace context everywhere.** The `traceparent` header and SQS message attributes carry the trace across every hop.
Services never invent their own correlation ids.

**Additive exporters instead of a fork in the code (Python).** `extra_*` arguments let a service keep an existing
destination (Axiom) next to SigNoz, then drop the old one by deleting a line.

**Trace ids stay random.** Business ids go on spans as attributes. See [conventions](conventions.md).

## Layout

```
src/shared/   config parsing, span helpers (no OpenTelemetry SDK dependency; pure logic, unit tested)
src/web/      browser entry: provider, instrumentations, error capture
src/node/     Node entry: SDK start, auto-instrumentations, signal flush; register.ts for --require
src/cli/      `ablecredit-telemetry install|check` (index.ts = logic, bin.ts = executable)
python/src/ablecredit_telemetry/
              config, setup (providers), spans, propagation (HTTP and SQS), instrumentation (FastAPI, httpx, botocore)
tests/        TypeScript tests, including an end-to-end export to a local OTLP receiver
python/tests/ Python tests, same approach
docs/         guides and reference
```

## Not covered yet (deliberately)

- Browser metrics and logs (traces only).
- Temporal workflow/worker metrics for Python; add a reader through `extra_metric_readers` where needed.
- Python auto-instrumentation beyond FastAPI, httpx and botocore.
- Any redaction of attribute values. Callers are responsible ([conventions](conventions.md)).
