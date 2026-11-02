import type { BaseTelemetryOptions } from './types.js';

export type Signal = 'traces' | 'metrics' | 'logs';

export interface ResolvedConfig {
  enabled: boolean;
  serviceName: string;
  serviceVersion?: string;
  environment?: string;
  endpoint?: string;
  headers: Record<string, string>;
  resourceAttributes: Record<string, string>;
}

export const DEFAULT_SERVICE_NAME = 'unknown-service';

const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);
const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);

/** Parse `key1=value1,key2=value2` (the OTEL_EXPORTER_OTLP_HEADERS / OTEL_RESOURCE_ATTRIBUTES format). */
export function parseKeyValueList(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const pair of raw.split(',')) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponentSafe(value);
  }
  return out;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Strip trailing slashes and any signal path the caller pasted by mistake. */
export function normalizeEndpoint(endpoint: string | undefined): string | undefined {
  const trimmed = endpoint?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, '').replace(/\/v1\/(traces|metrics|logs)$/, '');
}

/** Full OTLP/HTTP URL for one signal, e.g. `http://host:4318/v1/traces`. */
export function signalUrl(endpoint: string, signal: Signal): string {
  return `${endpoint}/v1/${signal}`;
}

/** Interpret an env flag. Returns `undefined` when unset or unrecognised, so the caller can fall through. */
function parseFlag(raw: string | undefined): boolean | undefined {
  const value = raw?.trim().toLowerCase();
  if (!value) return undefined;
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  return undefined;
}

/**
 * Merge explicit options over environment variables into one config.
 *
 * Precedence: explicit option > environment variable > default.
 * Telemetry is enabled only when an endpoint is known AND nothing switches it off
 * (`enabled: false`, `OTEL_ENABLED=false` or `OTEL_SDK_DISABLED=true`).
 */
export function resolveConfig(
  options: BaseTelemetryOptions = {},
  env: Record<string, string | undefined> = {},
): ResolvedConfig {
  const endpoint = normalizeEndpoint(options.endpoint ?? env.OTEL_EXPORTER_OTLP_ENDPOINT);

  const sdkDisabled = parseFlag(env.OTEL_SDK_DISABLED) === true;
  const envEnabled = parseFlag(env.OTEL_ENABLED);
  const switchedOff = options.enabled === false || sdkDisabled || envEnabled === false;

  const envResource = parseKeyValueList(env.OTEL_RESOURCE_ATTRIBUTES);
  const environment =
    options.environment ?? env.DEPLOYMENT_ENVIRONMENT ?? envResource['deployment.environment'];

  return {
    enabled: Boolean(endpoint) && !switchedOff,
    serviceName: options.serviceName ?? env.OTEL_SERVICE_NAME ?? DEFAULT_SERVICE_NAME,
    serviceVersion: options.serviceVersion ?? env.OTEL_SERVICE_VERSION,
    environment,
    endpoint,
    headers: { ...parseKeyValueList(env.OTEL_EXPORTER_OTLP_HEADERS), ...options.headers },
    resourceAttributes: { ...envResource, ...options.resourceAttributes },
  };
}

/** Resource attributes (service.*, deployment.*) shared by every runtime. */
export function buildResourceAttributes(config: ResolvedConfig): Record<string, string> {
  const attributes: Record<string, string> = {
    ...config.resourceAttributes,
    'service.name': config.serviceName,
  };
  if (config.serviceVersion) attributes['service.version'] = config.serviceVersion;
  if (config.environment) {
    // Current OpenTelemetry name, plus the older one that SigNoz's "Deployment Environment" filter still reads.
    attributes['deployment.environment.name'] = config.environment;
    attributes['deployment.environment'] = config.environment;
  }
  return attributes;
}
