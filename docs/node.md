# Node.js server guide

For any Node.js API or worker: Fastify, Express, queue consumers. It sends **traces, metrics and logs**.

**Time needed:** about 10 minutes. **You will change:** `package.json`, one start-up line, and the service's
environment variables.

## What you get automatically

- A span for every incoming HTTP request. If the request carries a `traceparent` header (from the browser or another
  service), the span joins that trace.
- Spans for outgoing HTTP and `fetch` calls, databases (MongoDB, Postgres, Redis, ...), the AWS SDK, and the other
  libraries covered by `@opentelemetry/auto-instrumentations-node`.
- Runtime metrics (event loop, memory, GC) and HTTP metrics.
- A log exporter, so loggers supported by the auto-instrumentations (Pino, Winston, Bunyan) can attach the trace id and
  ship lines to SigNoz. Confirm log shipping for your logger in a test environment.
- Health-check paths (`/health`, `/healthz`, `/ready`, `/ping`, `/metrics`) are skipped. Filesystem spans are off.

## Step 1: install

```bash
npm install "git+https://github.com/ablecredit/ablecredit-telemetry.git#v0.1.0"   # or the git+ssh form
npx ablecredit-telemetry install node
npx ablecredit-telemetry check node
```

HTTPS or SSH, Docker and CI: [Installing](installing.md).

## Step 2: start telemetry **before anything else loads**

OpenTelemetry works by patching libraries (`http`, `fastify`, `mongodb`, ...) at the moment they are first loaded. If
your code loads them first, those libraries produce **no spans**, and nothing warns you. So telemetry must start first.

There are two ways. Pick one.

### Option A: `--require` (simplest)

Change how the service is started:

```json
{ "scripts": { "start": "node --require @ablecredit/telemetry/node/register src/app.js" } }
```

Settings come only from the process environment ([Configuration](configuration.md)).

> **Warning: `.env` files.** `--require` runs before your code. If your app loads settings from a `.env` file itself
> (with `dotenv`), `OTEL_*` values written in that file are **not visible yet**. Set them in the real environment
> (Docker, ECS, your shell), or use Option B.

### Option B: a small start-up file (use this when you load `.env` yourself)

Create `src/tracing.js`:

```js
const { startTelemetry } = require('@ablecredit/telemetry/node');

module.exports = startTelemetry({
  serviceName: 'collector',                       // optional: OTEL_SERVICE_NAME also works
  ignoreIncomingPaths: ['/health', '/internal/ping'],
});
```

Then `require` it **after** the `.env` is loaded and **before** the frameworks.

## Walkthrough: adding it to `collector`

`collector` is a CommonJS Fastify service started with `node src/app.js`, and `src/app.js` loads
`.env.${NODE_ENV}` with `dotenv` at the very top. That is the Option B case.

1. Install ([Step 1](#step-1-install)).
2. Create `collector/src/tracing.js` as above.
3. In `collector/src/app.js`, add one line **right after the `dotenv` block and before `require("fastify")`**:

   ```js
   require("dotenv").config({ path: path.join(__dirname, `.env.${process.env.NODE_ENV}`) });

   const telemetry = require("./tracing");    // <-- new: must come before fastify and other libraries

   const Fastify = require("fastify");
   ```
4. Add the settings to `.env.<NODE_ENV>` (or the real environment):
   ```bash
   OTEL_EXPORTER_OTLP_ENDPOINT=http://<signoz-host>:4318
   OTEL_SERVICE_NAME=collector
   DEPLOYMENT_ENVIRONMENT=staging
   ```
5. Allow the trace headers in CORS so the browser's trace can continue
   ([recipe](recipes.md#connect-the-browser-and-the-backend-into-one-trace)).
6. Flush on shutdown (see [Step 3](#step-3-shut-down-cleanly)), start the service, make a request, and look for
   `collector` in SigNoz → *Services*.

The `Dockerfile` needs no change for Option B (`CMD ["node", "src/app.js"]`). For Option A it becomes
`CMD ["node", "--require", "@ablecredit/telemetry/node/register", "src/app.js"]`, and `OTEL_*` must be real
environment variables.

## Step 3: shut down cleanly

Telemetry is sent in batches (every few seconds). By default the library flushes the last batch when the process
receives `SIGTERM` or `SIGINT`, and when it finishes by itself (a script, cron job or worker that runs out of work).
If your service has its own graceful shutdown, flush there too so the last few seconds are not lost:

```js
async function shutdown() {
  await fastify.close();
  await telemetry.shutdown();     // `telemetry` is what ./tracing exports; safe to call twice
}
```

## Step 4: add business context

Automatic tracking knows about requests, not about your domain. Add labels so you can search by what a request is
about. The full list of recipes, with where/how for each, is in [Recipes](recipes.md). The three you will use most:

```js
const { setSpanAttributes, withSpan, getTraceId } = require('@ablecredit/telemetry/node');

setSpanAttributes({ 'application.id': id });                                   // label the current request
await withSpan('collector', 'crif.fetch-report', () => fetchReport(id));       // time a step
logger.error({ traceId: getTraceId() }, 'failed');                             // link logs to the trace
```

Before you record anything, read [what never to record](conventions.md#what-never-to-record).

## ES module services

If your service uses `"type": "module"`, libraries are only patched when OpenTelemetry's loader hook is also active:

```bash
node --import @ablecredit/telemetry/node/register \
     --experimental-loader=@opentelemetry/instrumentation/hook.mjs src/app.js
```

This repository's automated tests cover the CommonJS path. Check an ES module service in a test environment first.

## Common problems

| Symptom | Fix |
|---|---|
| Service never appears in SigNoz | [Troubleshooting](troubleshooting.md#no-data-in-signoz) |
| Requests appear but there are no database or framework spans | Telemetry started too late: [Step 2](#step-2-start-telemetry-before-anything-else-loads) |
| `OTEL_*` in my `.env` file is ignored | The warning under [Option A](#option-a---require-simplest) |
| `npm install` fails with `ERESOLVE` | [Troubleshooting](troubleshooting.md#npm-install-reports-eresolve--peer-dependency-conflict) |
