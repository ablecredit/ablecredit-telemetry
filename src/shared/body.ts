/**
 * Turns a request body into a short, safe string for a span attribute.
 *
 * A body is never recorded as it is. It is cut down and cleaned first:
 *  - values under sensitive keys (password, token, mobile, PAN, Aadhaar, ...) are replaced with "[redacted]";
 *  - values that LOOK sensitive (PAN, Aadhaar, phone, email, JWT) are masked even under harmless keys;
 *  - long strings, big arrays, deep nesting and binary data are shortened to a size marker;
 *  - the whole result is capped (default 4096 characters).
 */

export interface BodySanitizeOptions {
  /** Cap on the final string. Default 4096. */
  maxLength?: number;
  /** Longest string value kept as it is; longer ones become "[string N chars]". Default 200. */
  maxStringLength?: number;
  /** Nesting deeper than this becomes "[deep]". Default 6. */
  maxDepth?: number;
  /** Array elements / object keys kept per level. Default 30. */
  maxItems?: number;
  /** Extra key names to redact, added to the built-in list. */
  redactKeys?: RegExp;
}

const REDACTED = '[redacted]';

/** Keys whose VALUE is never recorded, whatever it contains. Matched anywhere in the key, case-insensitively. */
const DEFAULT_REDACT_KEYS = new RegExp(
  [
    // credentials and secrets
    'pass(word|wd|code|phrase)?', 'secret', 'token', 'authorization', 'bearer', 'api[-_]?key', 'apikey', 'private[-_]?key',
    'credential', 'cookie', 'session', 'jwt', 'signature', 'otp', 'mpin', 'cvv', 'cvc', '\\bpin\\b', 'ssh', 'webhook[-_]?secret',
    // identity documents and personal identifiers
    'aadhaar', 'aadhar', 'uidai', 'pan(_?(no|number|card))?$', 'ssn', 'passport', 'voter', 'epic', 'licen[cs]e', 'driving',
    'kyc', 'gst(in)?$', 'tan$', 'cin$',
    // contact details
    'mobile', 'phone', 'msisdn', 'whatsapp', 'email', 'address', 'pin[-_]?code', 'postal', 'zip',
    // people
    '(first|middle|last|full|father|mother|spouse|applicant|borrower|customer|guarantor|nominee|contact)_?name', '^name$',
    'dob', 'birth', 'gender', 'religion', 'caste', 'marital', 'nationality',
    // banking and money
    'account(_?(no|number|num))?$', 'ifsc', 'swift', 'iban', 'routing', 'bank', 'beneficiary', 'upi', 'vpa', 'card',
    'salary', 'income', 'turnover', 'revenue', 'balance', 'credit[-_]?score', 'cibil', 'bureau',
    // location and biometrics
    'latitude', 'longitude', '\\blat\\b', '\\blng\\b', '\\blon\\b', 'geo', 'gps', 'location',
    'photo', 'selfie', 'biometric', 'fingerprint', 'face',
    'private',
  ].join('|'),
  'i',
);

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Starts like a real card network (Visa, Mastercard, Amex, Diners, Discover, RuPay), so a timestamp or id never matches. */
const CARD_PREFIX = /^(4|5[0-5]|2[2-7]|3[0-9]|6[0-9]|8[1-2])/;

/**
 * Card numbers: 13-19 digits, optionally spaced or hyphenated, starting like a card network AND passing the Luhn check.
 * Must run before the other number patterns, or the Aadhaar rule would cut a card number in half.
 */
function maskCards(value: string): string {
  return value.replace(/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g, (match) => {
    const digits = match.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19 && CARD_PREFIX.test(digits) && luhnValid(digits) ? REDACTED : match;
  });
}

/**
 * Values that look like sensitive data, masked wherever they appear inside a string. Order matters: specific before general.
 * `loose` patterns match plain digit runs and long strings, which also occur inside ids (ACDE1A187394268679AE9C5), so they are
 * skipped for values under id-like keys (application_id, file_ids, ...). The strict ones always apply.
 */
const SENSITIVE_VALUE_PATTERNS: Array<{ pattern: RegExp; loose: boolean }> = [
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, loose: false }, // private key block
  { pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/gi, loose: false }, // credentials inside a URL (scheme://user:pass@host)
  { pattern: /([?&;](?:x-amz-[\w-]+|signature|sig|token|access_token|id_token|api[-_]?key|key|secret|password|passwd|auth|code|otp)=)[^&\s"'#]+/gi, loose: false }, // secret URL parameters
  { pattern: /\bBearer\s+[\w.~+/-]+=*/gi, loose: false }, // bearer tokens
  { pattern: /eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, loose: false }, // JWT
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, loose: false }, // AWS access key id
  { pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/gi, loose: false }, // PAN
  { pattern: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, loose: false }, // IFSC
  { pattern: /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g, loose: false }, // GSTIN
  { pattern: /\b[A-Z]{3}\d{7}\b/g, loose: false }, // voter id (EPIC)
  { pattern: /\b[A-PR-WY][1-9]\d\s?\d{4}[1-9]\b/g, loose: false }, // passport
  { pattern: /\b[A-Z]{2}\d{2}[ -]?\d{11}\b/g, loose: false }, // driving licence
  { pattern: /(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)/g, loose: true }, // Aadhaar (12 digits)
  { pattern: /(?<!\d)(?:\+?91[- ]?|0)?[6-9]\d{9}(?!\d)/g, loose: true }, // Indian mobile number
  { pattern: /[\w.+-]+@[\w-]+\.[\w.-]+/g, loose: false }, // email
  { pattern: /\b[\w.-]{2,}@[a-z]{2,15}\b/gi, loose: false }, // UPI handle (name@bank)
  { pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, loose: true }, // IPv4 address
  { pattern: /(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/_-]{40,}={0,2}(?![A-Za-z0-9+/=_-])/g, loose: true }, // long key-like strings (hashes, secrets)
];

function maskString(value: string, idLike = false): string {
  let out = maskCards(value);
  for (const { pattern, loose } of SENSITIVE_VALUE_PATTERNS) {
    if (loose && idLike) continue;
    out = out.replace(pattern, (_m, prefix: unknown) => (typeof prefix === 'string' ? `${prefix}${REDACTED}` : REDACTED));
  }
  return out;
}

/** Keys that hold an identifier: id, _id, application_id, applicationId, file_ids, ... */
const ID_LIKE_KEY = /(^|[_-])ids?$|[a-z]Ids?$/;

function isBinary(value: unknown): value is ArrayBufferView | ArrayBuffer {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function clean(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  limits: Required<Omit<BodySanitizeOptions, 'redactKeys' | 'maxLength'>>,
  redactKeys: RegExp,
  idLike = false,
): unknown {
  if (value === null || value === undefined) return value ?? null;
  switch (typeof value) {
    case 'string':
      return value.length > limits.maxStringLength ? `[string ${value.length} chars]` : maskString(value, idLike);
    case 'number':
    case 'boolean':
      return value;
    case 'bigint':
      return String(value);
    case 'function':
    case 'symbol':
      return undefined;
  }
  if (value instanceof Date) return value.toISOString();
  if (isBinary(value)) return `[binary ${value.byteLength} bytes]`;
  const object = value as object;
  if (seen.has(object)) return '[circular]';
  if (depth >= limits.maxDepth) return '[deep]';
  seen.add(object);

  if (Array.isArray(object)) {
    const items = object.slice(0, limits.maxItems).map((item) => clean(item, depth + 1, seen, limits, redactKeys, idLike));
    if (object.length > limits.maxItems) items.push(`[+${object.length - limits.maxItems} more]`);
    return items;
  }
  const out: Record<string, unknown> = {};
  const entries = Object.entries(object as Record<string, unknown>);
  for (const [key, item] of entries.slice(0, limits.maxItems)) {
    out[key] = redactKeys.test(key) ? REDACTED : clean(item, depth + 1, seen, limits, redactKeys, ID_LIKE_KEY.test(key));
  }
  if (entries.length > limits.maxItems) out['[more]'] = `+${entries.length - limits.maxItems} keys`;
  return out;
}

/**
 * The cleaned body as a JSON string, or `undefined` when there is nothing worth recording (no body, a plain string, a
 * stream). Never throws.
 */
export function sanitizeBody(body: unknown, options: BodySanitizeOptions = {}): string | undefined {
  try {
    if (typeof body !== 'object' || body === null || isBinary(body)) return undefined;
    if (Array.isArray(body) ? body.length === 0 : Object.keys(body).length === 0) return undefined;

    const limits = {
      maxStringLength: options.maxStringLength ?? 200,
      maxDepth: options.maxDepth ?? 6,
      maxItems: options.maxItems ?? 30,
    };
    const redactKeys = options.redactKeys
      ? new RegExp(`${DEFAULT_REDACT_KEYS.source}|${options.redactKeys.source}`, 'i')
      : DEFAULT_REDACT_KEYS;
    const text = JSON.stringify(clean(body, 0, new WeakSet(), limits, redactKeys));
    const maxLength = options.maxLength ?? 4096;
    return text.length > maxLength ? `${text.slice(0, maxLength)}…[truncated]` : text;
  } catch {
    return undefined;
  }
}

/** Routes whose bodies are never recorded: credentials, tokens, one-time codes, identity checks. */
export const DEFAULT_SKIP_URLS = /\/(auth|login|logout|otp|password|passwd|token|refresh|verify|register|signup|sso|vpd)\b/i;
