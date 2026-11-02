import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setSpanAttributes, startTelemetry, withSpan } from '../src/node/index.js';

interface Received { path: string; headers: Record<string, string | string[] | undefined>; body: string }

let server: Server;
let baseUrl: string;
const received: Received[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({ path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString() });
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('startTelemetry', () => {
  it('is a no-op when no endpoint is configured', async () => {
    const handle = startTelemetry({ env: {} });
    expect(handle.enabled).toBe(false);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('exports spans to the OTLP endpoint with service name, attributes and auth header', async () => {
    const handle = startTelemetry({
      endpoint: baseUrl,
      serviceName: 'e2e-service',
      environment: 'test',
      headers: { 'x-api-key': 'secret' },
      flushOnSignals: false,
      env: {},
    });
    expect(handle.enabled).toBe(true);
    expect(startTelemetry({ endpoint: baseUrl, env: {} })).toBe(handle);

    await withSpan('e2e', 'unit-of-work', () => setSpanAttributes({ 'application.id': 'EXAMPLE-APP-0001' }));
    await handle.shutdown();

    const traces = received.filter((r) => r.path === '/v1/traces');
    expect(traces.length).toBeGreaterThan(0);
    const body = traces.map((t) => t.body).join('');
    expect(body).toContain('e2e-service');
    expect(body).toContain('unit-of-work');
    expect(body).toContain('EXAMPLE-APP-0001');
    expect(traces[0]?.headers['x-api-key']).toBe('secret');
  });
});

describe('flushing when a process finishes by itself', () => {
  const dist = fileURLToPath(new URL('../dist/node.cjs', import.meta.url));

  // Needs the built package (`npm run build`), which CI runs before the tests.
  it.skipIf(!existsSync(dist))('sends the last spans even though nothing calls shutdown()', async () => {
    const before = received.length;
    const script = `
      const { startTelemetry, withSpan } = require(${JSON.stringify(dist)});
      startTelemetry({ endpoint: ${JSON.stringify(baseUrl)}, serviceName: 'exits-on-its-own', env: {} });
      withSpan('child', 'short-lived-job', () => undefined);
    `;
    // Async on purpose: a synchronous spawn would block this process's event loop, and with it the receiver above.
    const exitCode = await new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, ['-e', script], { stdio: 'inherit' });
      child.on('close', resolve);
    });
    expect(exitCode).toBe(0);
    const body = received
      .slice(before)
      .filter((r) => r.path === '/v1/traces')
      .map((r) => r.body)
      .join('');
    expect(body).toContain('short-lived-job');
  });
});

describe('one trace across a delayed hand-over', () => {
  const dist = fileURLToPath(new URL('../dist/node.cjs', import.meta.url));

  // Needs the built package (`npm run build`), which CI runs before the tests.
  it.skipIf(!existsSync(dist))('keeps work done later inside the trace that captured its context', async () => {
    const before = received.length;
    const script = `
      const { startTelemetry, withSpan, captureTraceContext, runInTraceContext } = require(${JSON.stringify(dist)});
      startTelemetry({ endpoint: ${JSON.stringify(baseUrl)}, serviceName: 'handover', env: {} });
      (async () => {
        let saved;
        await withSpan('child', 'create-request', () => { saved = captureTraceContext(); });
        // later, with no request around: a background worker picks the job up
        await new Promise((resolve) => setTimeout(resolve, 50));
        await runInTraceContext(saved, () => withSpan('child', 'process-job', () => undefined));
      })();
    `;
    const exitCode = await new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, ['-e', script], { stdio: 'inherit' });
      child.on('close', resolve);
    });
    expect(exitCode).toBe(0);

    const spans = received
      .slice(before)
      .filter((r) => r.path === '/v1/traces')
      .flatMap((r) => JSON.parse(r.body).resourceSpans)
      .flatMap((rs: { scopeSpans: Array<{ spans: Array<Record<string, string>> }> }) => rs.scopeSpans)
      .flatMap((ss: { spans: Array<Record<string, string>> }) => ss.spans);
    const create = spans.find((s) => s.name === 'create-request');
    const job = spans.find((s) => s.name === 'process-job');
    expect(create && job).toBeTruthy();
    expect(job?.traceId).toBe(create?.traceId);
    expect(job?.parentSpanId).toBe(create?.spanId);
  });
});
