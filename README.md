# ablecredit-telemetry

Add monitoring to an AbleCredit service in a few minutes. After you install this, a service reports **what it did,
how long it took, and what went wrong** to SigNoz, and one request can be followed from the browser through every
backend and AI service it touches.

It works for:

| You are working on | Language | Start with |
|---|---|---|
| A **backend server** (Fastify, Express, workers) | Node.js | [Node.js guide](docs/node.md) |
| A **frontend** (React, Vite) | Browser JavaScript / TypeScript | [Browser guide](docs/web.md) |
| An **AI / Python service** (FastAPI, SQS workers) | Python | [Python guide](docs/python.md) |

New to monitoring? Read [Getting started](docs/getting-started.md) first. It explains the words in plain language.

## The 5-minute version

1. **Install** the package from GitHub (no npm account or token for the package itself; see
   [Installing](docs/installing.md) for HTTPS vs SSH):

   ```bash
   # Node.js server or frontend
   npm install "git+https://github.com/ablecredit/ablecredit-telemetry.git#v0.1.0"
   npx ablecredit-telemetry install node     # or: install web
   ```

   ```bash
   # Python service
   uv add "ablecredit-telemetry[fastapi] @ git+https://github.com/ablecredit/ablecredit-telemetry.git@v0.1.0#subdirectory=python"
   ```

2. **Start it** (one line, see the guide for your language).
3. **Set one environment variable** so it knows where SigNoz is:

   ```bash
   OTEL_EXPORTER_OTLP_ENDPOINT=http://<your-signoz-host>:4318
   OTEL_SERVICE_NAME=my-service
   ```

4. **Open SigNoz**, go to *Services*, and find `my-service`.

If you do not set `OTEL_EXPORTER_OTLP_ENDPOINT`, nothing is sent and nothing changes. That makes it safe to add
everywhere, including local development and tests.

## What you get

- A record (a "span") for every incoming request, database call, outgoing HTTP call and queue message.
- Errors recorded with their stack trace, attached to the request that failed.
- Response-time, request-count and error-rate charts per service, plus runtime metrics.
- Application logs linked to the request they belong to.
- One connected trace across browser, backend and AI services.

## Documentation map

Start at **[docs/README.md](docs/README.md)**. The most useful pages:

| I want to... | Page |
|---|---|
| Understand the basics | [Getting started](docs/getting-started.md) |
| Install it (HTTPS, SSH, Docker, CI) | [Installing](docs/installing.md) |
| Do a specific task (what / where / how) | [Recipes](docs/recipes.md) |
| Look up an environment variable or option | [Configuration](docs/configuration.md) |
| Fix something that is not working | [Troubleshooting](docs/troubleshooting.md) |
| Change this library itself | [Codebase map](docs/codebase-map.md) and [Contributing](CONTRIBUTING.md) |
