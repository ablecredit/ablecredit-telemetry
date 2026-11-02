# Browser (frontend) guide

For the React / Vite frontend. It sends **traces only**: page-load timing, every `fetch` and XHR call, and uncaught
errors. Each API call carries a `traceparent` header, so the backend's work joins the same trace.

**Time needed:** about 15 minutes. **You will change:** `package.json`, `src/main.tsx`, an `.env.<mode>` file, and
(once) the SigNoz collector's CORS setting.

## Step 1: install

```bash
npm install "git+https://github.com/ablecredit/ablecredit-telemetry.git#v0.1.0"   # or the git+ssh form
npx ablecredit-telemetry install web
npx ablecredit-telemetry check web
```

See [Installing](installing.md) for HTTPS vs SSH.

## Step 2: start it first thing

Call `initWebTelemetry` once, before React renders.

```ts
// src/main.tsx
import { initWebTelemetry } from '@ablecredit/telemetry/web';

initWebTelemetry({
  serviceName: 'dashboard-client',
  serviceVersion: import.meta.env.VITE_APP_VERSION,
  environment: import.meta.env.MODE,
  endpoint: import.meta.env.VITE_OTEL_ENDPOINT,            // empty => telemetry is off
  propagateTraceHeaderCorsUrls: [/api\.example\.com/],     // your backend addresses (see Step 4)
});

// ...then the existing ReactDOM.createRoot(...) code
```

Browsers have no process environment, so settings are passed as options. With Vite, put them in the `.env.<mode>`
files; only names that start with `VITE_` reach the browser.

## Walkthrough: adding it to `dashboard-client`

`dashboard-client` is a Vite + React + TypeScript app (ES modules) with `.env.development`, `.env.staging`,
`.env.production` and so on.

1. Install ([Step 1](#step-1-install)).
2. Add to the top of `src/main.tsx` (before the render call) the code from [Step 2](#step-2-start-it-first-thing).
3. Add the SigNoz address to the environments that should report, and leave it out of the ones that should not:
   ```bash
   # .env.staging
   VITE_OTEL_ENDPOINT=https://otel.staging.example.com
   ```
   (Local development stays off if `VITE_OTEL_ENDPOINT` is not set.)
4. Make the collector accept your origin ([Step 3](#step-3-let-the-collector-accept-browser-traffic)).
5. Connect to the backend ([Step 4](#step-4-connect-browser-and-backend-traces)).
6. Run the app, click around, and look for `dashboard-client` in SigNoz.

## Step 3: let the collector accept browser traffic

Browsers block requests to another address unless that address allows them (this is called CORS). Add your frontend's
address to the OTLP receiver of SigNoz's OpenTelemetry collector:

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
        cors:
          allowed_origins:
            - "https://dashboard.example.com"
```

Restart the collector afterwards. You do this once per frontend address.

## Step 4: connect browser and backend traces

To make the browser's click and the API's work one trace:

1. Put your backend addresses in `propagateTraceHeaderCorsUrls` (a list of strings or regular expressions). Requests to
   the page's own address are included automatically.
2. Make each backend accept the `traceparent` and `tracestate` headers in its CORS settings
   ([how, for Fastify](recipes.md#connect-the-browser-and-the-backend-into-one-trace)).

If you skip 2, the browser's preflight check fails and the **API call itself breaks**, so test this in staging first.

## Things to know

- **HTTPS pages need an HTTPS endpoint.** A page served over HTTPS cannot send data to an `http://` address. Put the
  collector behind HTTPS (a reverse proxy).
- **The endpoint must be reachable from users' browsers,** not only from inside the company network.
- **Everything in browser code is public.** Self-hosted SigNoz needs no key. If you ever need one, send browser data to
  your own small proxy that adds the key; never put a key in the frontend bundle.
- **No personal data.** Do not put names, phone numbers, PAN/Aadhaar or income in attributes. URLs are recorded, so
  keep personal data out of query strings. See [Conventions](conventions.md#what-never-to-record).
- **Too much data?** `sampleRatio: 0.2` keeps 20% of traces.
- **Single-page app:** page load is recorded once; route changes show up as the `fetch` calls they trigger.

## Add your own spans and labels

```ts
import { setSpanAttributes, withSpan } from '@ablecredit/telemetry/web';

await withSpan('dashboard-client', 'submit-application-form', () => submit(form), {
  'application.id': form.applicationId,
});
```

More: [Recipes](recipes.md).

## Options

All options are listed in [Configuration](configuration.md#browser-only-options). `initWebTelemetry` also returns a
handle with `shutdown()`, mostly useful in tests.

## Common problems

| Symptom | Fix |
|---|---|
| Nothing arrives, console shows a CORS error | [Troubleshooting](troubleshooting.md#browser-nothing-arrives-console-shows-a-cors-error) |
| Frontend and backend show as two traces | [Troubleshooting](troubleshooting.md#browser-and-backend-show-as-two-separate-traces) |
| API calls fail after enabling it | [Troubleshooting](troubleshooting.md#browser-api-calls-start-failing-after-enabling-telemetry) |
