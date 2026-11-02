import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getTraceId, sanitizeAttributes, setSpanAttributes, withSpan } from '../src/shared/span.js';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(provider);
});
afterAll(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
});
beforeEach(() => exporter.reset());

describe('sanitizeAttributes', () => {
  it('drops null, undefined and unsupported values', () => {
    const input = { a: 'x', b: 1, c: true, d: undefined, e: null, f: ['a', 'b'], g: { nested: 1 } } as never;
    expect(sanitizeAttributes(input)).toEqual({ a: 'x', b: 1, c: true, f: ['a', 'b'] });
  });
});

describe('setSpanAttributes / getTraceId', () => {
  it('does nothing without an active span', () => {
    expect(() => setSpanAttributes({ a: 1 })).not.toThrow();
    expect(getTraceId()).toBeUndefined();
  });

  it('sets attributes on the active span and exposes its trace id', async () => {
    let traceId: string | undefined;
    await withSpan('test', 'outer', () => {
      setSpanAttributes({ 'application.id': 'ABC', skipped: undefined });
      traceId = getTraceId();
    });
    const [span] = exporter.getFinishedSpans();
    expect(span?.attributes).toEqual({ 'application.id': 'ABC' });
    expect(traceId).toBe(span?.spanContext().traceId);
  });
});

describe('withSpan', () => {
  it('returns the callback result and ends the span', async () => {
    await expect(withSpan('test', 'ok', async () => 42, { k: 'v' })).resolves.toBe(42);
    const [span] = exporter.getFinishedSpans();
    expect(span).toMatchObject({ name: 'ok', attributes: { k: 'v' } });
  });

  it('records errors, marks the span failed and rethrows', async () => {
    const boom = new Error('boom');
    await expect(withSpan('test', 'fail', () => { throw boom; })).rejects.toBe(boom);
    const [span] = exporter.getFinishedSpans();
    expect(span?.status).toMatchObject({ code: 2, message: 'boom' });
    expect(span?.events[0]?.name).toBe('exception');
  });

  it('nests child spans under the parent', async () => {
    await withSpan('test', 'parent', () => withSpan('test', 'child', () => undefined));
    const spans = exporter.getFinishedSpans();
    const child = spans.find((s) => s.name === 'child');
    const parent = spans.find((s) => s.name === 'parent');
    expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
  });
});
