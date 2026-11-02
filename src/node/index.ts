import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { IncomingMessage } from 'node:http';
import { buildResourceAttributes, resolveConfig, signalUrl } from '../shared/config.js';
import type { BaseTelemetryOptions, TelemetryHandle } from '../shared/types.js';

export { getTraceId, setSpanAttributes, withSpan } from '../shared/span.js';
export { captureTraceContext, runInTraceContext, withoutTracing } from '../shared/propagation.js';
export type { TraceCarrier } from '../shared/propagation.js';
export type { AttributeInput, TelemetryHandle } from '../shared/types.js';

type AutoInstrumentationConfig = NonNullable<Parameters<typeof getNodeAutoInstrumentations>[0]>;

export interface NodeTelemetryOptions extends BaseTelemetryOptions {
  /** Incoming request paths that are not traced. Defaults to common health-check paths. */
  ignoreIncomingPaths?: string[];
  /** Per-instrumentation overrides passed straight to `getNodeAutoInstrumentations`. */
  autoInstrumentations?: AutoInstrumentationConfig;
  /** Seconds between metric exports. Defaults to 30. */
  metricsIntervalSeconds?: number;
  /** Send logs through OTLP. Defaults to true. */
  logs?: boolean;
  /**
   * Flush buffered telemetry when the process is stopped (SIGTERM/SIGINT) or finishes on its own.
   * Defaults to true. Turn off only if your code calls `shutdown()` itself.
   */
  flushOnSignals?: boolean;
  /** Environment to read configuration from. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

export const DEFAULT_IGNORED_PATHS = ['/health', '/healthz', '/ready', '/ping', '/metrics'];

const NOOP_HANDLE: TelemetryHandle = { enabled: false, shutdown: async () => undefined };

let activeHandle: TelemetryHandle | undefined;

/**
 * Start tracing, metrics and logs for a Node.js service.
 *
 * This must run BEFORE the modules you want instrumented are loaded (http, fastify, mongodb, ...).
 * The easiest way is `node --require @ablecredit/telemetry/node/register app.js`; otherwise call this
 * from a file that your entry point imports first.
 *
 * Returns a no-op handle, and sends nothing, when no endpoint is configured or telemetry is switched off.
 * Calling it again returns the original handle.
 */
export function startTelemetry(options: NodeTelemetryOptions = {}): TelemetryHandle {
  if (activeHandle) return activeHandle;

  const env = options.env ?? process.env;
  const config = resolveConfig(options, env);
  if (!config.enabled || !config.endpoint) return NOOP_HANDLE;
  const endpoint = config.endpoint;

  const ignoredPaths = options.ignoreIncomingPaths ?? DEFAULT_IGNORED_PATHS;
  const sdk = new NodeSDK({
    resource: resourceFromAttributes(buildResourceAttributes(config)),
    traceExporter: new OTLPTraceExporter({ url: signalUrl(endpoint, 'traces'), headers: config.headers }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: signalUrl(endpoint, 'metrics'), headers: config.headers }),
        exportIntervalMillis: (options.metricsIntervalSeconds ?? 30) * 1000,
      }),
    ],
    logRecordProcessors:
      options.logs === false
        ? []
        : [
            new BatchLogRecordProcessor({
              exporter: new OTLPLogExporter({ url: signalUrl(endpoint, 'logs'), headers: config.headers }),
            }),
          ],
    instrumentations: [
      getNodeAutoInstrumentations({
        // Filesystem spans are extremely noisy and rarely useful.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (request: IncomingMessage) => isIgnoredPath(request.url, ignoredPaths),
        },
        ...options.autoInstrumentations,
      }),
    ],
  });
  sdk.start();

  let shutdownPromise: Promise<void> | undefined;
  const handle: TelemetryHandle = {
    enabled: true,
    shutdown() {
      shutdownPromise ??= sdk.shutdown().finally(() => {
        activeHandle = undefined;
      });
      return shutdownPromise;
    },
  };
  activeHandle = handle;

  if (options.flushOnSignals !== false) installSignalFlush(handle);
  return handle;
}

function isIgnoredPath(url: string | undefined, ignoredPaths: string[]): boolean {
  if (!url) return false;
  const path = url.split('?')[0] ?? '';
  return ignoredPaths.includes(path);
}

/**
 * Flush buffered telemetry when the process ends. Two cases:
 *  - the process is asked to stop (SIGTERM/SIGINT), and
 *  - the process finishes by itself (`beforeExit`, e.g. a script, cron job or worker that runs out of work).
 *    Without this, the last batch of spans would be dropped.
 *
 * Signals: If the application has its own handler
 * for the signal, we only flush and leave stopping to it; otherwise we re-raise so the default
 * behaviour (exit) still happens.
 */
function installSignalFlush(handle: TelemetryHandle): void {
  process.once('beforeExit', () => void handle.shutdown());
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    const onSignal = () => {
      const others = process.listeners(signal).filter((listener) => listener !== onSignal);
      void handle.shutdown().finally(() => {
        if (others.length === 0) {
          process.removeListener(signal, onSignal);
          process.kill(process.pid, signal);
        }
      });
    };
    process.on(signal, onSignal);
  }
}
