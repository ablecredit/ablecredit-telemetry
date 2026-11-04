import { sanitizeBody, DEFAULT_SKIP_URLS } from '../shared/body.js';
import type { BodySanitizeOptions } from '../shared/body.js';
import { setSpanAttributes } from '../shared/span.js';

export interface RecordRequestBodyOptions extends BodySanitizeOptions {
  /** The request URL or path. Bodies of credential-like routes (login, otp, token, ...) are never recorded. */
  url?: string;
  /** Replaces the built-in list of routes that are skipped. */
  skipUrls?: RegExp;
  /** The request's content type. File uploads, images, audio and other non-JSON bodies are never recorded. */
  contentType?: string;
}

/** Bodies that are files or binary, not data. */
const NON_DATA_CONTENT = /multipart|octet-stream|form-data|image\/|audio\/|video\/|pdf/i;

const OFF_VALUES = new Set(['false', '0', 'no', 'off']);

/** Request-body recording is on unless OTEL_CAPTURE_REQUEST_BODY is set to false / 0 / no / off. */
export function requestBodyCaptureEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !OFF_VALUES.has((env.OTEL_CAPTURE_REQUEST_BODY ?? '').trim().toLowerCase());
}

/**
 * Record the request body on the active span (the request span) as `http.request.body`, cleaned first (see
 * `sanitizeBody`): sensitive values redacted, long values shortened, total size capped. Does nothing when there is no
 * usable body, no active span, the route is credential-like, or OTEL_CAPTURE_REQUEST_BODY=false. Never throws.
 */
export function recordRequestBody(body: unknown, options: RecordRequestBodyOptions = {}): void {
  if (!requestBodyCaptureEnabled()) return;
  if (options.url && (options.skipUrls ?? DEFAULT_SKIP_URLS).test(options.url)) return;
  if (options.contentType && NON_DATA_CONTENT.test(options.contentType)) return;
  const text = sanitizeBody(body, options);
  if (text) setSpanAttributes({ 'http.request.body': text });
}
