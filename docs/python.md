# Python service guide

For Python APIs and workers: FastAPI services, SQS consumers, background jobs such as `ai-node-executor`. It sends
**traces, metrics and logs**.

**Time needed:** about 10 minutes. **You will change:** `pyproject.toml`, one start-up call, and the service's
environment variables.

## What you get automatically

- A span for every FastAPI request, joining the caller's trace if it sent a `traceparent` header.
- Spans for outgoing `httpx` calls and AWS (`botocore`) calls, when those libraries are installed.
- Your normal `logging` output forwarded to SigNoz, each line carrying the trace id.
- Metrics, exported every 30 seconds.
- `/health`, `/healthz`, `/ready`, `/ping` and `/metrics` are skipped.

## Step 1: install

```bash
uv add "ablecredit-telemetry[fastapi,httpx,botocore] @ git+https://github.com/ablecredit/ablecredit-telemetry.git@v0.1.0#subdirectory=python"
```

Keep only the extras you use (`fastapi`, `httpx`, `botocore`). SSH form, pip, Docker and CI: [Installing](installing.md).
Requires Python 3.10 or newer.

## Step 2: start it once, early

```python
# app/main.py: before creating routes or starting workers
from fastapi import FastAPI
from ablecredit_telemetry import setup_telemetry, instrument_fastapi, instrument_libraries

telemetry = setup_telemetry("ai-node-executor")   # endpoint etc. come from OTEL_* environment variables
instrument_libraries()                            # httpx and botocore, whichever is installed
app = FastAPI()
instrument_fastapi(app)                           # a span per request
```

Good to know:

- With no `OTEL_EXPORTER_OTLP_ENDPOINT` this does nothing, so local runs and tests are unaffected.
- Calling `setup_telemetry` twice is safe: the second call returns the first result.
- `instrument_libraries()` returns the list it turned on. A library that is not installed is skipped, not an error.
- To stop forwarding logs, pass `logs=False`.

Settings: [Configuration](configuration.md).

## Step 3: flush on shutdown

Telemetry is sent in batches. Flush at shutdown so the last seconds are not lost:

```python
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    telemetry.shutdown()

app = FastAPI(lifespan=lifespan)
```

## Walkthrough: adding it to a service like `ai-node-executor`

1. Install ([Step 1](#step-1-install)).
2. Find where the app is created (for `ai-node-executor`, `app/main.py`) and add the calls from
   [Step 2](#step-2-start-it-once-early) before the routes are used.
3. Set the environment (Terraform, `.env`, your shell):
   ```bash
   OTEL_EXPORTER_OTLP_ENDPOINT=http://<signoz-host>:4318
   OTEL_SERVICE_NAME=ai-node-executor
   DEPLOYMENT_ENVIRONMENT=staging
   ```
4. If the service already exports to Axiom, keep that working with
   [dual export](#dual-export-axiom-and-signoz) instead of removing it.
5. For queue work, carry the trace across the queue ([recipe](recipes.md#follow-a-background-job-across-a-queue)).
6. Start the service, send a request, and look for the service in SigNoz → *Services*.

## Step 4: add business context

```python
from ablecredit_telemetry import set_span_attributes, span, get_trace_id

set_span_attributes({"application.id": application_id, "product.type": "loan"})   # None values are skipped

with span("crif.fetch-report", {"application.id": application_id}):               # a timed step
    report = fetch_report(application_id)

logger.error("eligibility failed", extra={"trace_id": get_trace_id()})            # link logs to the trace
```

More, with where and how for each: [Recipes](recipes.md). Before recording anything, read
[what never to record](conventions.md#what-never-to-record).

## Dual export: Axiom and SigNoz

If the service already sends traces to Axiom, you can keep that and add SigNoz. The `extra_*` arguments **add**
destinations; they never replace SigNoz.

```python
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace.export import BatchSpanProcessor

axiom = BatchSpanProcessor(OTLPSpanExporter(
    endpoint="https://api.axiom.co/v1/traces",
    headers={"Authorization": f"Bearer {axiom_token}", "X-Axiom-Dataset": dataset},
))

setup_telemetry("ai-v2", extra_span_processors=[axiom])
```

- With `OTEL_EXPORTER_OTLP_ENDPOINT` set, spans go to SigNoz **and** Axiom.
- Without it, spans go only to Axiom, as before.
- Metrics and logs have `extra_metric_readers` and `extra_log_processors`.
- Register everything through this one call. Do not create a second tracer provider elsewhere.
- Sending prompt or completion text to two systems doubles where that data lives. Check that is acceptable.

## You already create your own providers (for example for Axiom)

Some services build their own OpenTelemetry providers and send to another backend such as Axiom. You do **not** have to
hand those over to the library. Keep your setup exactly as it is, and add SigNoz **next to** it:

```python
from ablecredit_telemetry import TelemetryConfig, otlp_metric_reader, otlp_span_processor

config = TelemetryConfig.from_env(service_name="ai-node-executor", environment="prod")   # reads OTEL_* variables

# traces: your provider and your Axiom processor stay as they are; SigNoz gets one more processor
provider = TracerProvider(resource=resource)
provider.add_span_processor(axiom_processor)                       # unchanged
if (signoz := otlp_span_processor(config)) is not None:           # None when SigNoz export is off
    provider.add_span_processor(signoz)

# metrics: readers are given when the provider is created
readers = [axiom_reader]
if (signoz_reader := otlp_metric_reader(config)) is not None:
    readers.append(signoz_reader)
meter_provider = MeterProvider(metric_readers=readers, resource=resource)

# logs: let the library own the log provider only
setup_telemetry("ai-node-executor", traces=False, metrics=False)
```

- Each processor has its own queue and worker thread. A slow or unreachable SigNoz cannot delay or drop what Axiom receives.
- The builders return `None` when SigNoz export is off, so the code is "add it if there is one".
- `setup_telemetry(traces=False, metrics=False)` creates no tracer or meter provider, so yours are left alone. It sets up the
  log export (the handler skips the exporter's own log lines, so a failing export cannot feed itself).
- Adding SigNoz does not change the spans, attributes or datasets your other backend receives. If you also add new
  attributes to spans, both backends receive them.

## Queues (SQS)

How to send and receive with the trace attached: [recipe](recipes.md#follow-a-background-job-across-a-queue).
Remember `MessageAttributeNames=["All"]` when receiving, otherwise SQS drops the trace headers.

## Testing your own code

Tests need no setup: with no endpoint, `setup_telemetry` does nothing. To check the spans your code creates, register an
`InMemorySpanExporter` through `extra_span_processors` (this repository's own tests do exactly that).

## Common problems

| Symptom | Fix |
|---|---|
| Service never appears in SigNoz | [Troubleshooting](troubleshooting.md#no-data-in-signoz) |
| "Overriding of current TracerProvider is not allowed" | [Troubleshooting](troubleshooting.md#python-overriding-of-current-tracerprovider-is-not-allowed) |
| `httpx` / AWS spans missing | [Troubleshooting](troubleshooting.md#python-httpx-or-botocore-spans-are-missing) |
