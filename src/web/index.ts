import { ZoneContextManager } from '@opentelemetry/context-zone';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { trace } from '@opentelemetry/api';
import { buildResourceAttributes, resolveConfig, signalUrl } from '../shared/config.js';
import type { BaseTelemetryOptions, TelemetryHandle } from '../shared/types.js';
import { urlPrefixPattern } from '../shared/url.js';

export { getTraceId, setSpanAttributes, withSpan } from '../shared/span.js';
export { captureTraceContext, runInTraceContext, withoutTracing } from '../shared/propagation.js';
export type { TraceCarrier } from '../shared/propagation.js';
export type { AttributeInput, TelemetryHandle } from '../shared/types.js';

export interface WebTelemetryOptions extends BaseTelemetryOptions {
  /** Required in the browser: there is no environment to fall back on. */
  serviceName: string;
  /**
   * URLs of YOUR backends that should receive the `traceparent` header, so browser and server spans
   * join into one trace. Cross-origin URLs must also allow that header in their CORS config.
   * Same-origin requests are always propagated.
   *
   * A string must equal the WHOLE request URL; use a RegExp (e.g. `/^https:\/\/api\.example\.com/`) to match
   * everything under an address.
   */
  propagateTraceHeaderCorsUrls?: Array<string | RegExp>;
  /**
   * Requests to these URLs are not traced (same matching rules as above). The telemetry endpoint itself is always
   * excluded.
   */
  ignoreUrls?: Array<string | RegExp>;
  /** Fraction of traces to record, 0..1. Defaults to 1 (record everything). */
  sampleRatio?: number;
  /** Turn individual instrumentations off. All default to on. */
  instrumentations?: { documentLoad?: boolean; fetch?: boolean; xhr?: boolean };
  /** Record uncaught errors and unhandled promise rejections as spans. Defaults to true. */
  captureErrors?: boolean;
}

const NOOP_HANDLE: TelemetryHandle = { enabled: false, shutdown: async () => undefined };

let activeHandle: TelemetryHandle | undefined;

/**
 * Start browser tracing. Call once, as early as possible in your entry file (before rendering).
 *
 * Returns a no-op handle, and sends nothing, when no `endpoint` is given or `enabled` is false.
 * Calling it again returns the original handle rather than registering a second provider.
 */
export function initWebTelemetry(options: WebTelemetryOptions): TelemetryHandle {
  if (activeHandle) return activeHandle;

  const config = resolveConfig(options);
  if (!config.enabled || !config.endpoint) return NOOP_HANDLE;
  const endpoint = config.endpoint;

  const exporter = new OTLPTraceExporter({ url: signalUrl(endpoint, 'traces'), headers: config.headers });
  const provider = new WebTracerProvider({
    resource: resourceFromAttributes(buildResourceAttributes(config)),
    sampler: new TraceIdRatioBasedSampler(clampRatio(options.sampleRatio)),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  provider.register({ contextManager: new ZoneContextManager() });

  // Never trace the exporter's own requests, or every export would create a span that triggers another export.
  const ignoreUrls = [urlPrefixPattern(endpoint), ...(options.ignoreUrls ?? [])];
  const toggles = options.instrumentations ?? {};
  const httpOptions = { propagateTraceHeaderCorsUrls: options.propagateTraceHeaderCorsUrls, ignoreUrls };

  const unregister = registerInstrumentations({
    instrumentations: [
      ...(toggles.documentLoad === false ? [] : [new DocumentLoadInstrumentation()]),
      ...(toggles.fetch === false ? [] : [new FetchInstrumentation(httpOptions)]),
      ...(toggles.xhr === false ? [] : [new XMLHttpRequestInstrumentation(httpOptions)]),
    ],
  });

  const removeErrorListeners = options.captureErrors === false ? () => undefined : captureErrors();

  let stopped = false;
  activeHandle = {
    enabled: true,
    async shutdown() {
      if (stopped) return;
      stopped = true;
      removeErrorListeners();
      unregister();
      await provider.shutdown();
      activeHandle = undefined;
    },
  };
  return activeHandle;
}

function clampRatio(ratio: number | undefined): number {
  if (ratio === undefined || Number.isNaN(ratio)) return 1;
  return Math.min(1, Math.max(0, ratio));
}

function recordErrorSpan(name: string, error: unknown): void {
  const span = trace.getTracer('@ablecredit/telemetry/web').startSpan(name);
  span.recordException(error instanceof Error ? error : String(error));
  span.setStatus({ code: 2, message: error instanceof Error ? error.message : String(error) });
  span.end();
}

function captureErrors(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onError = (event: ErrorEvent) => recordErrorSpan('window.error', event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => recordErrorSpan('window.unhandledrejection', event.reason);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
