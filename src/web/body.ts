import type { Span } from '@opentelemetry/api';
import { DEFAULT_SKIP_URLS, sanitizeBody } from '../shared/body.js';
import type { BodySanitizeOptions } from '../shared/body.js';

export interface WebBodyOptions extends BodySanitizeOptions {
  /** Replaces the built-in list of routes whose bodies are skipped (login, otp, token, ...). */
  skipUrls?: RegExp;
}

/** Bodies sent as a JSON string become an object; anything else (files, forms, streams, plain text) is not recorded. */
function parseJsonBody(body: unknown): unknown {
  if (typeof body !== 'string' || body.length === 0) return undefined;
  const first = body.trimStart()[0];
  if (first !== '{' && first !== '[') return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** Put the cleaned body on the span as `http.request.body`. Never throws. */
export function recordBodyOnSpan(span: Span, body: unknown, url: string | undefined, options: WebBodyOptions = {}): void {
  try {
    if (url && (options.skipUrls ?? DEFAULT_SKIP_URLS).test(url)) return;
    const text = sanitizeBody(parseJsonBody(body), options);
    if (text) span.setAttribute('http.request.body', text);
  } catch {
    // telemetry must never break a request
  }
}

const xhrBodies = new WeakMap<XMLHttpRequest, unknown>();

/**
 * The XHR instrumentation never sees the body passed to `send()`, so remember it per request. Returns a function that
 * restores the original `send`.
 */
export function trackXhrBodies(): () => void {
  if (typeof XMLHttpRequest === 'undefined') return () => undefined;
  const proto = XMLHttpRequest.prototype;
  const original = proto.send;
  proto.send = function send(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    xhrBodies.set(this, body);
    return original.call(this, body);
  };
  return () => {
    if (proto.send !== original) proto.send = original;
  };
}

export function xhrBody(xhr: XMLHttpRequest): unknown {
  return xhrBodies.get(xhr);
}
