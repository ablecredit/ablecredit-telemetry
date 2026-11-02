import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { captureTraceContext, runInTraceContext, withoutTracing } from '../src/shared/propagation.js';
import { withSpan } from '../src/shared/span.js';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(provider);
});
afterAll(async () => {
  await provider.shutdown();
  trace.disable();
  propagation.disable();
  context.disable();
});
beforeEach(() => exporter.reset());

function spanByName(name: string) {
  const span = exporter.getFinishedSpans().find((s) => s.name === name);
  if (!span) throw new Error(`span not found: ${name}`);
  return span;
}

describe('captureTraceContext', () => {
  it('returns nothing when there is no active trace', () => {
    expect(captureTraceContext()).toBeUndefined();
  });

  it('captures only the trace identity of the active span', async () => {
    let carrier: ReturnType<typeof captureTraceContext>;
    await withSpan('test', 'create', () => {
      carrier = captureTraceContext();
    });
    const span = spanByName('create');
    expect(carrier?.traceparent).toBe(`00-${span.spanContext().traceId}-${span.spanContext().spanId}-01`);
    expect(Object.keys(carrier ?? {})).toEqual(['traceparent']);
  });
});

describe('runInTraceContext', () => {
  it('makes later work a child of the captured span, in the same trace', async () => {
    let carrier: ReturnType<typeof captureTraceContext>;
    await withSpan('test', 'create', () => {
      carrier = captureTraceContext();
    });

    // a completely separate async context, like a background worker picking the job up later
    await runInTraceContext(carrier, () => withSpan('test', 'later-work', () => undefined));

    const create = spanByName('create');
    const later = spanByName('later-work');
    expect(later.spanContext().traceId).toBe(create.spanContext().traceId);
    expect(later.parentSpanContext?.spanId).toBe(create.spanContext().spanId);
  });

  it.each([undefined, null, {}, 'junk', { traceparent: 'nope' }, { traceparent: 42 }])(
    'just runs the function when the carrier is %j',
    async (carrier) => {
      await expect(runInTraceContext(carrier, () => withSpan('test', 'standalone', () => 'ok'))).resolves.toBe('ok');
      expect(spanByName('standalone').parentSpanContext).toBeUndefined();
    },
  );

  it('returns the function result', () => {
    expect(runInTraceContext(undefined, () => 7)).toBe(7);
  });
});

describe('withoutTracing', () => {
  it('records no spans for the work inside, but does not affect work outside', async () => {
    await withoutTracing(() => withSpan('test', 'poll', () => undefined));
    await withSpan('test', 'real-work', () => undefined);
    const names = exporter.getFinishedSpans().map((s) => s.name);
    expect(names).toEqual(['real-work']);
  });

  it('returns the function result', async () => {
    await expect(withoutTracing(async () => 'done')).resolves.toBe('done');
  });
});
