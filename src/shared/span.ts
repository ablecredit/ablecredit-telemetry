import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { Attributes, AttributeValue, Span } from '@opentelemetry/api';
import type { AttributeInput } from './types.js';

function isAttributeValue(value: unknown): value is AttributeValue {
  if (['string', 'number', 'boolean'].includes(typeof value)) return true;
  return Array.isArray(value) && value.every((item) => ['string', 'number', 'boolean'].includes(typeof item));
}

/** Drop `undefined`/`null` and anything OpenTelemetry cannot store (objects, functions). */
export function sanitizeAttributes(input: AttributeInput): Attributes {
  const out: Attributes = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== null && value !== undefined && isAttributeValue(value)) out[key] = value;
  }
  return out;
}

/**
 * Attach attributes to the span that is currently active (e.g. the incoming request span).
 * Does nothing when there is no active span, so it is always safe to call.
 *
 * Attributes belong to that one span only; child spans do not inherit them.
 */
export function setSpanAttributes(attributes: AttributeInput): void {
  trace.getActiveSpan()?.setAttributes(sanitizeAttributes(attributes));
}

/** Trace id of the active span, for correlating log lines and error reports. */
export function getTraceId(): string | undefined {
  const context = trace.getActiveSpan()?.spanContext();
  return context && trace.isSpanContextValid(context) ? context.traceId : undefined;
}

/**
 * Run `fn` inside a new child span. The span is ended when `fn` settles; a thrown error is recorded on
 * the span (status ERROR) and re-thrown unchanged.
 */
export async function withSpan<T>(
  tracerName: string,
  spanName: string,
  fn: (span: Span) => Promise<T> | T,
  attributes: AttributeInput = {},
): Promise<T> {
  return trace.getTracer(tracerName).startActiveSpan(
    spanName,
    { attributes: sanitizeAttributes(attributes) },
    async (span) => {
      try {
        return await fn(span);
      } catch (error) {
        span.recordException(error instanceof Error ? error : String(error));
        span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
