# Getting started

This page explains monitoring ("telemetry") from zero. No prior knowledge needed.

## The problem it solves

A user clicks a button. The browser calls an API. The API reads a database, calls a credit bureau, and puts a job on a
queue. A Python service picks the job up and calls an AI model. Something is slow, or fails. **Where?**

Without monitoring, you read the logs of five services and guess. With it, you open one page and see the whole journey
with timings.

## The words you will see

| Word | Plain meaning |
|---|---|
| **Telemetry** | The data a running program sends out about itself: what it did, how long it took, what failed. |
| **Span** | One step of work with a start and end time: "handle GET /applications/42", "query MongoDB", "call CRIF". |
| **Trace** | All the spans caused by one request, in order, across services. A trace is the story of one request. |
| **Trace ID** | A random id shared by every span in a trace. It is what links the browser, the API and the worker. |
| **Attribute** | A label on a span, such as `application.id = ACGR1...`. You search by attributes. |
| **Metric** | A number measured over time: requests per second, memory used, error rate. |
| **Log** | A text line your program writes. With this library, logs also carry the trace id. |
| **SigNoz** | The tool where you look at all of this (self-hosted). |
| **OpenTelemetry (OTel)** | The open standard and libraries that collect telemetry. This repo configures it for you. |
| **OTLP** | The format OTel uses to send data. We send it over HTTP. |
| **Collector / endpoint** | The SigNoz receiver that accepts the data, usually at `http://<host>:4318`. |
| **Service name** | How a program appears in SigNoz, e.g. `collector`, `dashboard-client`. |

## How it fits together

```
 Browser  ──────▶  Node.js API  ──────▶  Python worker
 (web)             (node)                (python)
    │                 │                       │
    └─────────────────┴───── send ────────────┘
                          │
                          ▼
                 SigNoz (the collector at :4318)
                          │
                          ▼
                  You, looking at charts
```

Each program runs one small piece of this library. They all send to the same SigNoz endpoint. The programs are
connected by a header called `traceparent` that carries the trace id from one to the next.

## What this library does for you

OpenTelemetry on its own needs dozens of lines of setup that are easy to get wrong. This library does that setup:

- creates the OpenTelemetry pieces in the right order,
- turns on tracking for web requests, databases and outgoing calls,
- skips noisy health-check URLs,
- reads its settings from environment variables,
- does nothing at all unless you give it a SigNoz address,
- sends any remaining data when the program stops.

You keep writing your code exactly as before.

## What it does **not** do

- It does not run SigNoz. SigNoz already exists; this just sends data to it.
- It does not hide private data for you. See [Conventions](conventions.md#what-never-to-record).
- It does not replace your logger or web framework.

## Your first run: a checklist

1. Install the package: [Installing](installing.md).
2. Start it in your service (one line): [Node.js](node.md) / [Browser](web.md) / [Python](python.md).
3. Set `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_SERVICE_NAME`.
4. Run the service and use it for a minute (make a few requests).
5. In SigNoz, open **Services**. Your service should appear within about a minute.
6. Open **Traces**, click a trace, and look at the spans.

Nothing showing up? Go to [Troubleshooting](troubleshooting.md#no-data-in-signoz).

## Where to go next

- Want to find traces for one customer application? [Recipes](recipes.md#find-every-trace-for-one-application).
- Want to time one slow function? [Recipes](recipes.md#time-one-piece-of-code).
- Want to know what is safe to record? [Conventions](conventions.md).
