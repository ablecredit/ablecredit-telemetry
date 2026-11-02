// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { initWebTelemetry } from '../src/web/index.js';

afterEach(() => undefined);

describe('initWebTelemetry', () => {
  it('is a no-op without an endpoint', async () => {
    const handle = initWebTelemetry({ serviceName: 'dashboard-client' });
    expect(handle.enabled).toBe(false);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('is a no-op when explicitly disabled', () => {
    expect(initWebTelemetry({ serviceName: 's', endpoint: 'http://localhost:4318', enabled: false }).enabled).toBe(false);
  });

  it('starts once, returns the same handle on repeat calls, and shuts down cleanly', async () => {
    const options = { serviceName: 'dashboard-client', endpoint: 'http://localhost:4318' };
    const handle = initWebTelemetry(options);
    expect(handle.enabled).toBe(true);
    expect(initWebTelemetry(options)).toBe(handle);
    await handle.shutdown();
    await handle.shutdown();
    const fresh = initWebTelemetry(options);
    expect(fresh).not.toBe(handle);
    await fresh.shutdown();
  });
});
