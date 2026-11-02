# Recipes: what, where and how

Each recipe says **what** you get, **where** in your code to make the change, and **how** (copy-paste).

Examples use these names; swap in your own: `application.id` (see [Conventions](conventions.md)), service `collector`
(Node.js), `ai-node-executor` (Python), `dashboard-client` (frontend).

Contents:
[See my service in SigNoz](#see-my-service-in-signoz) ·
[Find every trace for one application](#find-every-trace-for-one-application) ·
[Tag every request automatically](#tag-every-request-automatically) ·
[Time one piece of code](#time-one-piece-of-code) ·
[Put the trace id in logs and errors](#put-the-trace-id-in-logs-and-errors) ·
[Record an error](#record-an-error) ·
[Connect the browser and the backend](#connect-the-browser-and-the-backend-into-one-trace) ·
[Follow a job across a queue](#follow-a-background-job-across-a-queue) ·
[Keep a long-running job in one trace](#keep-a-long-running-job-in-one-trace) ·
[Keep a polling loop out of the traces](#keep-a-polling-loop-out-of-the-traces) ·
[Hide noisy endpoints](#hide-noisy-endpoints) ·
[Count something (custom metric)](#count-something-custom-metric) ·
[Turn telemetry off](#turn-telemetry-off) ·
[Check it works locally](#check-it-works-locally)

---

## See my service in SigNoz

- **What:** your service shows up under *Services*, with request counts, latency and errors.
- **Where:** your start-up code, plus the service's environment variables.
- **How:** follow your guide ([Node.js](node.md), [Browser](web.md), [Python](python.md)), then set:
  ```bash
  OTEL_EXPORTER_OTLP_ENDPOINT=http://<signoz-host>:4318
  OTEL_SERVICE_NAME=collector
  DEPLOYMENT_ENVIRONMENT=staging
  ```
  Use the service for a minute, then open SigNoz → *Services*.

## Find every trace for one application

- **What:** type an application id in SigNoz and see every request that touched it.
- **Where:** the code that handles a request about an application (see the next recipe to do it in one place).
- **How:** add the id as an attribute on the current span.

  Node.js:
  ```js
  const { setSpanAttributes } = require('@ablecredit/telemetry/node');
  setSpanAttributes({ 'application.id': applicationId });
  ```
  Python:
  ```python
  from ablecredit_telemetry import set_span_attributes
  set_span_attributes({"application.id": application_id})
  ```
  In SigNoz: *Traces* → *Add filter* → `application.id` `=` `EXAMPLE-APP-0001`.

  Good to know: the label sits on **one span** (the request). Search finds the whole trace through that span; the
  other spans in the trace do not carry the label. Why not use the application id as the trace id? See
  [Conventions](conventions.md#attributes-versus-the-trace-id).

## Tag every request automatically

- **What:** every request about an application gets `application.id` without touching each handler.
- **Where:** one hook in your server's setup file.
- **How:**

  Fastify (for example `collector/src/app.js`, after the app is created):
  ```js
  const { setSpanAttributes } = require('@ablecredit/telemetry/node');

  fastify.addHook('onRequest', async (request) => {
    setSpanAttributes({
      'application.id': request.params?.applicationId,   // missing values are skipped, not an error
      'org.id': request.auth_org_id,
    });
  });
  ```
  FastAPI (a dependency on the routes that have the id):
  ```python
  from fastapi import Depends
  from ablecredit_telemetry import set_span_attributes

  def tag_application(application_id: str) -> None:
      set_span_attributes({"application.id": application_id})

  @app.get("/applications/{application_id}", dependencies=[Depends(tag_application)])
  def read_application(application_id: str): ...
  ```
  Both patterns are covered by this repository's tests.

## Time one piece of code

- **What:** a named step with its own duration inside the trace, e.g. "fetch CRIF report".
- **Where:** around the slow or important call.
- **How:**

  Node.js / browser:
  ```js
  const { withSpan } = require('@ablecredit/telemetry/node');   // browser: '@ablecredit/telemetry/web'

  const report = await withSpan('collector', 'crif.fetch-report', () => fetchReport(id), {
    'application.id': id,
  });
  ```
  Python:
  ```python
  from ablecredit_telemetry import span

  with span("crif.fetch-report", {"application.id": application_id}):
      report = fetch_report(application_id)
  ```
  The span ends by itself. If the code throws, the error is recorded on the span and then thrown again unchanged.

## Put the trace id in logs and errors

- **What:** a support report or log line carries an id you can paste into SigNoz to open that exact request.
- **Where:** your error handler and logger calls.
- **How:**
  ```js
  const { getTraceId } = require('@ablecredit/telemetry/node');
  logger.error({ traceId: getTraceId() }, 'eligibility check failed');
  ```
  ```python
  from ablecredit_telemetry import get_trace_id
  logger.error("eligibility failed", extra={"trace_id": get_trace_id()})
  ```
  It returns nothing when there is no active request. In SigNoz: *Traces* → filter by trace id.

## Record an error

- **What:** a failed step shows red in the trace with the error message and stack.
- **Where:** where you catch an error and want its message and stack on the trace. (A request that ends with a 5xx
  response is already marked as failed; this adds the details.)
- **How:** this uses the standard OpenTelemetry API, which is already installed.
  ```js
  const { trace, SpanStatusCode } = require('@opentelemetry/api');

  try { await riskyThing(); }
  catch (error) {
    const span = trace.getActiveSpan();
    span?.recordException(error);
    span?.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    throw error;     // or handle it
  }
  ```
  ```python
  from opentelemetry import trace
  from opentelemetry.trace import Status, StatusCode

  try:
      risky_thing()
  except Exception as error:
      current = trace.get_current_span()
      current.record_exception(error)
      current.set_status(Status(StatusCode.ERROR, str(error)))
      raise
  ```
  If you use `withSpan` / `span(...)` from this library, you get this for free.

## Connect the browser and the backend into one trace

- **What:** a click in the frontend and the API work it caused appear as one trace.
- **Where:** three places. Miss one and you get two separate traces.
- **How:**
  1. **Frontend:** list your API address in `propagateTraceHeaderCorsUrls` ([Browser guide](web.md)).
  2. **Backend:** allow the `traceparent` and `tracestate` headers in CORS.
     Fastify:
     ```js
     await fastify.register(require('@fastify/cors'), {
       origin: [/* your frontend origins */],
       allowedHeaders: ['content-type', 'authorization', 'traceparent', 'tracestate'],
     });
     ```
     (`collector` already registers `@fastify/cors` with an `allowedHeaders` list in `src/app.js`; add the two names to it.)
  3. **Backend telemetry** must be running ([Node.js guide](node.md)), so it reads the header.

  Check: in the browser's *Network* tab, an API request has a `traceparent` header. In SigNoz one trace shows both
  `dashboard-client` and `collector` spans.

## Follow a background job across a queue

- **What:** the worker's spans join the trace of the request that queued the job.
- **Where:** the code that **sends** the message and the code that **receives** it.
- **How:**
  - Node.js sender: nothing to do. The AWS SDK instrumentation adds the trace to the message.
  - Python sender:
    ```python
    from ablecredit_telemetry import sqs_message_attributes
    sqs.send_message(QueueUrl=url, MessageBody=body, MessageAttributes=sqs_message_attributes())
    ```
  - Python receiver:
    ```python
    from ablecredit_telemetry import sqs_context

    response = sqs.receive_message(QueueUrl=url, MessageAttributeNames=["All"])   # "All" is required
    for message in response.get("Messages", []):
        with sqs_context(message):
            handle(message)
    ```
  A worker that starts its own job (for example from a database poll) has no request to join, so it starts a new trace.

## Keep a long-running job in one trace

- **What:** work that happens later, outside any request (a background picker, a callback minutes afterwards), shows up in
  the same trace as the request that started it, instead of a trace of its own.
- **Where:** two places: the request that starts the job, and the code that later does the work.
- **How:** save the trace when the job is created, and restore it when the job runs.
  ```js
  const { captureTraceContext, runInTraceContext, withSpan } = require('@ablecredit/telemetry/node');

  // 1. in the request that creates the job: keep the trace with the job's record
  await Job.create({ ...fields, trace_context: captureTraceContext() });

  // 2. later, in the worker that runs it (no request around):
  await runInTraceContext(job.trace_context, () =>
    withSpan('worker', 'run job', () => doTheWork(job), { 'job.id': job.id }));
  ```
  Calls made inside (HTTP, queues, databases) are children of the saved span, so the trace continues into other services
  too. With an old record that has no saved trace, `runInTraceContext` just runs the work as before.
- **A retry is its own trace.** If a later request re-runs the job, save that request's trace on the job again. The re-run
  then belongs to the retry request's trace, and the original run's trace stays as it was. Give both the same
  `application.id` / `job.id` attributes so they are found together.
- **A callback from outside** (another system posting a result back, with no trace header) cannot join a trace by itself.
  Restore the saved trace as above, and put the saved trace id on the callback's own request span
  (`setSpanAttributes({ 'job.trace_id': ... })`) so it can be followed to the run.
- Only the trace identity is saved (`traceparent`, optionally `tracestate`). Nothing else travels with it.

## Keep a polling loop out of the traces

- **What:** "check the queue every second" stops producing a trace per poll.
- **Where:** around the polling call only, not around the work it finds.
- **How:**
  ```js
  const { withoutTracing } = require('@ablecredit/telemetry/node');

  const messages = await withoutTracing(() => pollQueue());   // the poll is not recorded
  for (const m of messages) await handle(m);                  // the work is, as usual
  ```
  Without this, a loop that runs every second records about 86,000 traces a day that say nothing useful, and buries the
  real ones.

## Hide noisy endpoints

- **What:** health checks and similar calls stop cluttering SigNoz.
- **Where:** the start-up options.
- **How:**
  ```js
  startTelemetry({ ignoreIncomingPaths: ['/health', '/healthz', '/internal/ping'] });   // Node.js
  ```
  ```python
  instrument_fastapi(app, excluded_urls=r"/health(\?|$),/internal/ping(\?|$)")          # Python, comma-separated regexes
  ```
  `/health`, `/healthz`, `/ready`, `/ping` and `/metrics` are already hidden by default. Browser: `ignoreUrls: [...]`.

## Count something (custom metric)

- **What:** a number over time, such as "applications submitted", charted in SigNoz.
- **Where:** where the event happens.
- **How:** use the standard OpenTelemetry API; this library has already set up the plumbing.
  ```js
  const { metrics } = require('@opentelemetry/api');
  const submitted = metrics.getMeter('collector').createCounter('applications.submitted');
  submitted.add(1, { 'product.type': 'loan' });
  ```
  ```python
  from opentelemetry import metrics
  submitted = metrics.get_meter("ai-node-executor").create_counter("applications.submitted")
  submitted.add(1, {"product.type": "loan"})
  ```
  Keep labels few and low-cardinality (product, status). **Never** put application ids or user ids on a metric; see
  [Conventions](conventions.md#values-you-should-not-group-metrics-by).

## Turn telemetry off

- **What:** the service sends nothing and does no telemetry work.
- **How:** any one of these:
  - Do not set `OTEL_EXPORTER_OTLP_ENDPOINT` (the default, so local development and tests are already off).
  - Set `OTEL_ENABLED=false` or `OTEL_SDK_DISABLED=true`.
  - Pass `enabled: false` (Node.js, browser) or `enabled=False` (Python) in code.

## Check it works locally

You do not need SigNoz to see whether data leaves your service. Run a throwaway receiver that prints what it gets:

```bash
node -e "require('http').createServer((q,s)=>{console.log(q.method,q.url);q.resume();s.end('{}')}).listen(4318)"
```

In another terminal start your service with `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`. After a few requests
(and a few seconds) you should see `POST /v1/traces` and `POST /v1/metrics` lines. If you do, the library works and any
remaining problem is between your network and SigNoz.
