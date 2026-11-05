// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { recordBodyOnSpan, trackXhrBodies, xhrBody } from '../src/web/body.js';

function fakeSpan() {
  return { setAttribute: vi.fn() } as unknown as import('@opentelemetry/api').Span & { setAttribute: ReturnType<typeof vi.fn> };
}

describe('recordBodyOnSpan', () => {
  it('records a JSON body, keeping ids and redacting sensitive keys', () => {
    const span = fakeSpan();
    recordBodyOnSpan(span, JSON.stringify({ application_id: 'ACDE1A1A6516F74147D9AF7', mobile: '9876543210' }), '/api/x');
    const [key, value] = span.setAttribute.mock.calls[0]!;
    expect(key).toBe('http.request.body');
    expect(value).toContain('ACDE1A1A6516F74147D9AF7');
    expect(value).not.toContain('9876543210');
  });

  it('skips credential routes, non-JSON bodies and files', () => {
    const span = fakeSpan();
    recordBodyOnSpan(span, '{"a":1}', 'https://api/auth/login');
    recordBodyOnSpan(span, 'plain text', '/api/x');
    recordBodyOnSpan(span, new Blob(['x']), '/api/x');
    recordBodyOnSpan(span, '{bad json', '/api/x');
    recordBodyOnSpan(span, undefined, '/api/x');
    expect(span.setAttribute).not.toHaveBeenCalled();
  });
});

describe('recordBodyOnSpan without a request URL', () => {
  it('falls back to the URL on the span so credential routes are still skipped', () => {
    const span = Object.assign(fakeSpan(), { attributes: { 'http.url': 'https://api/v1/auth/login' } });
    recordBodyOnSpan(span, '{"a":1}', undefined);
    recordBodyOnSpan(span, '{"a":1}', '');
    expect(span.setAttribute).not.toHaveBeenCalled();
  });
});

describe('trackXhrBodies', () => {
  it('remembers the body passed to send() and restores send', () => {
    const originalSend = XMLHttpRequest.prototype.send;
    const restore = trackXhrBodies();
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'http://localhost/x');
    try { xhr.send('{"a":1}'); } catch { /* no network in tests */ }
    expect(xhrBody(xhr)).toBe('{"a":1}');
    restore();
    expect(XMLHttpRequest.prototype.send).toBe(originalSend);
  });
});
