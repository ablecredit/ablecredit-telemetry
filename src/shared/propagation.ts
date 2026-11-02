import { context, createContextKey, propagation, ROOT_CONTEXT } from '@opentelemetry/api';

/** A trace context as plain strings (W3C `traceparent`, optionally `tracestate`), safe to keep in a database or message. */
export type TraceCarrier = { traceparent: string; tracestate?: string };

const TRACEPARENT = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

/** Accept only a well-formed carrier. Anything else (missing, malformed, from an old record) is treated as "no trace". */
function toCarrier(value: unknown): TraceCarrier | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { traceparent, tracestate } = value as Record<string, unknown>;
  if (typeof traceparent !== 'string' || !TRACEPARENT.test(traceparent)) return undefined;
  return typeof tracestate === 'string' && tracestate ? { traceparent, tracestate } : { traceparent };
}

/**
 * Snapshot the trace the code is running in right now, so a LATER piece of work can join it (see
 * `runInTraceContext`). Store the result with the job, for example on its database record.
 *
 * Returns `undefined` when there is no active trace. Only the trace identity is captured, never baggage or other data.
 */
export function captureTraceContext(): TraceCarrier | undefined {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return toCarrier(carrier);
}

/**
 * Run `fn` as part of the trace described by a carrier from `captureTraceContext`. Spans and outgoing calls made
 * inside become children of the captured span, in the same trace, however much later this runs.
 *
 * With a missing or invalid carrier `fn` simply runs as it would have, so this is safe to call on old records.
 */
export function runInTraceContext<T>(carrier: unknown, fn: () => T): T {
  const clean = toCarrier(carrier);
  if (!clean) return fn();
  return context.with(propagation.extract(ROOT_CONTEXT, clean), fn);
}

// The key OpenTelemetry's own `suppressTracing()` uses. `createContextKey` returns a global Symbol, so using the same
// description makes every instrumentation honour it, without depending on @opentelemetry/core.
const SUPPRESS_TRACING_KEY = createContextKey('OpenTelemetry SDK Context Key SUPPRESS_TRACING');

/**
 * Run `fn` without recording any spans for the work it does (database queries, HTTP and AWS calls included).
 *
 * Use it around polling loops, such as "check the queue every second". Without it each poll becomes its own trace and
 * drowns out the real ones.
 */
export function withoutTracing<T>(fn: () => T): T {
  return context.with(context.active().setValue(SUPPRESS_TRACING_KEY, true), fn);
}
