import type { AttributeValue } from '@opentelemetry/api';

/** Returned by every `init`/`start` function so callers can flush telemetry on shutdown. */
export interface TelemetryHandle {
  /** `false` when telemetry is disabled (no endpoint, or switched off); all other calls are then no-ops. */
  readonly enabled: boolean;
  /** Flush buffered telemetry and release resources. Safe to call more than once. */
  shutdown(): Promise<void>;
}

/** Attributes accepted by the span helpers. `undefined`/`null` values are dropped, not recorded. */
export type AttributeInput = Record<string, AttributeValue | null | undefined>;

/** Settings every runtime needs, regardless of where they came from (options or environment). */
export interface BaseTelemetryOptions {
  /** Logical service name; shows up as the service in SigNoz. */
  serviceName?: string;
  serviceVersion?: string;
  /** Deployment environment, e.g. `production`, `staging`. */
  environment?: string;
  /**
   * OTLP/HTTP base URL of the collector, e.g. `http://signoz.internal:4318`.
   * Do not include `/v1/traces`. Telemetry is disabled when this is empty.
   */
  endpoint?: string;
  /** Extra headers sent with every export request (e.g. an ingestion key). */
  headers?: Record<string, string>;
  /** Extra resource attributes attached to all telemetry from this service. */
  resourceAttributes?: Record<string, string>;
  /** Force telemetry on or off. When unset, it is on whenever an endpoint is configured. */
  enabled?: boolean;
}
