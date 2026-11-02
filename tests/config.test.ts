import { describe, expect, it } from 'vitest';
import {
  buildResourceAttributes,
  normalizeEndpoint,
  parseKeyValueList,
  resolveConfig,
  signalUrl,
} from '../src/shared/config.js';

describe('parseKeyValueList', () => {
  it('parses pairs, trims whitespace and decodes values', () => {
    expect(parseKeyValueList('a=1, b = two ,c=hello%20world')).toEqual({ a: '1', b: 'two', c: 'hello world' });
  });

  it('keeps "=" inside values and skips malformed pairs', () => {
    expect(parseKeyValueList('token=abc=def,broken,=nokey')).toEqual({ token: 'abc=def' });
  });

  it('returns an empty object for undefined', () => {
    expect(parseKeyValueList(undefined)).toEqual({});
  });
});

describe('normalizeEndpoint', () => {
  it('strips trailing slashes and pasted signal paths', () => {
    expect(normalizeEndpoint('http://h:4318/')).toBe('http://h:4318');
    expect(normalizeEndpoint('http://h:4318/v1/traces')).toBe('http://h:4318');
  });

  it('returns undefined for blank input', () => {
    expect(normalizeEndpoint('  ')).toBeUndefined();
    expect(normalizeEndpoint(undefined)).toBeUndefined();
  });

  it('builds signal urls', () => {
    expect(signalUrl('http://h:4318', 'metrics')).toBe('http://h:4318/v1/metrics');
  });
});

describe('resolveConfig', () => {
  it('is disabled when no endpoint is configured', () => {
    expect(resolveConfig({ serviceName: 's' }, {}).enabled).toBe(false);
  });

  it('is enabled by an endpoint from the environment', () => {
    const config = resolveConfig({}, { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://h:4318', OTEL_SERVICE_NAME: 'api' });
    expect(config).toMatchObject({ enabled: true, endpoint: 'http://h:4318', serviceName: 'api' });
  });

  it('lets explicit options win over the environment', () => {
    const config = resolveConfig(
      { endpoint: 'http://opt:4318', serviceName: 'from-option' },
      { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://env:4318', OTEL_SERVICE_NAME: 'from-env' },
    );
    expect(config).toMatchObject({ endpoint: 'http://opt:4318', serviceName: 'from-option' });
  });

  it.each([
    [{ enabled: false }, {}],
    [{}, { OTEL_ENABLED: 'false' }],
    [{}, { OTEL_SDK_DISABLED: 'true' }],
  ])('can be switched off (%j, %j)', (options, extraEnv) => {
    const config = resolveConfig(options, { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://h:4318', ...extraEnv });
    expect(config.enabled).toBe(false);
  });

  it('merges headers with explicit headers winning', () => {
    const config = resolveConfig(
      { headers: { a: 'opt' } },
      { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://h', OTEL_EXPORTER_OTLP_HEADERS: 'a=env,b=env' },
    );
    expect(config.headers).toEqual({ a: 'opt', b: 'env' });
  });

  it('falls back to a default service name', () => {
    expect(resolveConfig({}, {}).serviceName).toBe('unknown-service');
  });
});

describe('buildResourceAttributes', () => {
  it('includes service and environment attributes only when set', () => {
    const config = resolveConfig(
      { serviceName: 'api', serviceVersion: '1.2.3', environment: 'staging', resourceAttributes: { team: 'core' } },
      {},
    );
    expect(buildResourceAttributes(config)).toEqual({
      team: 'core',
      'service.name': 'api',
      'service.version': '1.2.3',
      'deployment.environment.name': 'staging',
      'deployment.environment': 'staging',
    });
  });
});
