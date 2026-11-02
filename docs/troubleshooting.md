# Troubleshooting

## No data in SigNoz

1. Is `OTEL_EXPORTER_OTLP_ENDPOINT` set in the process that runs the service (not only in your shell)? Without it
   telemetry is silently off. Print `startTelemetry().enabled` / `setup_telemetry(...).enabled` to check.
2. Is the endpoint the **base** URL on the **HTTP** port (`:4318`), not `:4317` (gRPC)?
3. Can the service reach it? `curl -i -X POST http://<host>:4318/v1/traces -H 'content-type: application/json' -d '{}'`
   should answer `200`.
4. Is `OTEL_ENABLED=false` or `OTEL_SDK_DISABLED=true` set somewhere?
5. Wait one export interval (traces ~5s, metrics 30s by default), or stop the process so it flushes.
6. Node only: set `OTEL_LOG_LEVEL=debug` to see exporter errors. In Python, enable `logging.DEBUG` for the
   `opentelemetry` logger.

## Node: the service runs but has no HTTP/database spans

Telemetry started after the libraries were loaded. It must be the first thing that runs: use
`--require @ablecredit/telemetry/node/register`, or make your bootstrap file the first import. ES module services also
need the loader hook ([Node guide](node.md#es-module-services)).

## Browser: nothing arrives, console shows a CORS error

The collector's OTLP/HTTP receiver must list your front end's origin under `cors.allowed_origins`
([Browser guide](web.md#step-3-let-the-collector-accept-browser-traffic)). A blocked mixed-content request (HTTPS page,
`http://` endpoint) looks similar; use an HTTPS endpoint.

## Browser and backend show as two separate traces

- The backend URL is missing from `propagateTraceHeaderCorsUrls`, or
- the backend's CORS config does not allow the `traceparent` and `tracestate` headers.

Check the request in the browser's network tab: it should carry a `traceparent` header.

## Browser: API calls start failing after enabling telemetry

Same cause as above from the other side: the backend rejects the new `traceparent` header in its CORS preflight. Add
it to `allowedHeaders` on the backend.

## `npm install` reports `ERESOLVE` / peer dependency conflict

Do not use `--legacy-peer-deps`: it hides a real mismatch and can leave two copies of OpenTelemetry installed, which
breaks tracing without any error. Run `npx ablecredit-telemetry install node` (or `web`) to install the exact tested
versions, and `npx ablecredit-telemetry check node` to see what is missing. If your service pins its own
`@opentelemetry/*` versions, align them with this package's peer ranges (see `peerDependencies` in `package.json`).

## Installing from GitHub fails

Match the message to the cause:

| Message | Cause | Fix |
|---|---|---|
| `Permission denied (publickey)` | Using the SSH form, and this machine has no SSH key GitHub knows. | Add your key to GitHub (your machine) or a read-only deploy key (Docker/CI). See [Installing](installing.md). |
| `could not read Username for 'https://github.com'`, `Authentication failed` or `Repository not found` with the HTTPS form | The repository is private and HTTPS has no credentials. | Use the SSH form, or make the repository public. |
| `Remote branch v0.1.0 not found` / `couldn't find remote ref` | That tag does not exist yet (or is misspelled). | Check the tag in GitHub, or use `#main` for a quick experiment. |
| `git: command not found` during a Docker build | The build image has no `git` (slim images do not). | Install dependencies in a build stage that has git, such as the full `node` image. |
| `Host key verification failed` in Docker/CI | GitHub is not in `known_hosts`. | Add `ssh-keyscan github.com >> ~/.ssh/known_hosts`. |

## The package installed, but `dist` is missing

The build runs on install through the `prepare` script, which needs `devDependencies`. npm provides them for git
dependencies; some setups (`NODE_ENV=production` with `--omit=dev` forced globally, or `--ignore-scripts`) skip it.
Install with scripts enabled.

## Two services appear as one in SigNoz

They share an `OTEL_SERVICE_NAME`. Give each deployable its own ([conventions](conventions.md)).

## Python: "Overriding of current TracerProvider is not allowed"

Something else already set a tracer provider (another setup call, or the `opentelemetry-instrument` launcher). Register
everything through a single `setup_telemetry` call and pass other destinations through `extra_span_processors`.

## Python: httpx or botocore spans are missing

`instrument_libraries()` returns what it enabled. If a library is missing from the list, install its extra
(`ablecredit-telemetry[httpx]`, `[botocore]`) and make sure the library itself is installed.
