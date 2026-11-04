import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recordRequestBody, requestBodyCaptureEnabled } from '../src/node/body.js';
import { sanitizeBody } from '../src/shared/body.js';
import { withSpan } from '../src/shared/span.js';

const parse = (body: unknown, options?: Parameters<typeof sanitizeBody>[1]) => JSON.parse(sanitizeBody(body, options) ?? 'null');

describe('sanitizeBody: sensitive keys', () => {
  it('keeps ordinary values and redacts the value of sensitive keys', () => {
    const out = parse({
      application_id: 'APP-1',
      status: 'open',
      password: 'hunter2',
      access_token: 'abc',
      Authorization: 'Bearer xyz',
      mobile: '9876543210',
      customer_email: 'a@b.com',
      pan_number: 'ABCDE1234F',
      aadhaar: '1234 5678 9012',
      salary: 90000,
      applicant_name: 'Asha',
    });

    expect(out.application_id).toBe('APP-1');
    expect(out.status).toBe('open');
    for (const key of ['password', 'access_token', 'Authorization', 'mobile', 'customer_email', 'pan_number', 'aadhaar', 'salary', 'applicant_name']) {
      expect(out[key], key).toBe('[redacted]');
    }
  });

  it('does not redact technical names that merely contain "name"', () => {
    const out = parse({ template_name: 'income', node_name: 'extract', name: 'Asha' });

    expect(out.template_name).toBe('income');
    expect(out.node_name).toBe('extract');
    expect(out.name).toBe('[redacted]');
  });

  it('redacts nested keys and keys inside arrays of objects', () => {
    const out = parse({ borrower: { details: { phone: '9876543210', city: 'Pune' } }, files: [{ id: 'f1', token: 't' }] });

    expect(out.borrower.details).toEqual({ phone: '[redacted]', city: 'Pune' });
    expect(out.files).toEqual([{ id: 'f1', token: '[redacted]' }]);
  });

  it('accepts extra keys to redact', () => {
    expect(parse({ branch_code: 'X1', note: 'ok' }, { redactKeys: /branch_code/ })).toEqual({ branch_code: '[redacted]', note: 'ok' });
  });
});

describe('sanitizeBody: sensitive-looking values under harmless keys', () => {
  it.each([
    ['PAN', 'verified ABCDE1234F ok', 'verified [redacted] ok'],
    ['Aadhaar', 'id 1234 5678 9012.', 'id [redacted].'],
    ['mobile', 'call 9876543210 now', 'call [redacted] now'],
    ['mobile with country code', 'call +91 9876543210', 'call [redacted]'],
    ['email', 'mail a.b+c@example.co.in please', 'mail [redacted] please'],
    ['JWT', 'tok eyJhbGciOiJI.eyJzdWIiOiIx.abcdefghijk end', 'tok [redacted] end'],
  ])('masks a %s inside a free-text field', (_label, input, expected) => {
    expect(parse({ remark: input }).remark).toBe(expected);
  });

  it('leaves ids and short numbers alone', () => {
    expect(parse({ note: 'APP-1234 step 3 of 12' }).note).toBe('APP-1234 step 3 of 12');
  });
});

describe('sanitizeBody: more sensitive keys', () => {
  it.each([
    'bank_name', 'beneficiary', 'ifsc_code', 'upi_id', 'vpa', 'account_number', 'iban', 'swift_code', 'passport_no',
    'voter_id', 'driving_licence', 'kyc_status', 'gstin', 'gender', 'religion', 'caste', 'marital_status', 'nationality',
    'pincode', 'postal_code', 'latitude', 'longitude', 'gps', 'location', 'photo', 'selfie', 'fingerprint', 'biometric',
    'cibil_score', 'credit_score', 'bureau_report', 'turnover', 'balance', 'otp', 'mpin', 'cvv', 'client_secret',
    'private_key', 'refresh_token', 'session_id', 'father_name', 'guarantor_name', 'dob', 'whatsapp',
  ])('redacts the value of "%s"', (key) => {
    expect(parse({ [key]: 'some value' })[key]).toBe('[redacted]');
  });

  it('keeps technical and id keys that only look similar', () => {
    const out = parse({ account_id: 'A1', application_id: 'APP-1', org_id: 'O1', reference_id: 'R1', template_id: 'T1', status: 'ok' });

    expect(out).toEqual({ account_id: 'A1', application_id: 'APP-1', org_id: 'O1', reference_id: 'R1', template_id: 'T1', status: 'ok' });
  });
});

describe('sanitizeBody: more sensitive-looking values', () => {
  it.each([
    ['IFSC', 'branch HDFC0001234 here', 'branch [redacted] here'],
    ['GSTIN', 'gst 27ABCDE1234F1Z5 filed', 'gst [redacted] filed'],
    ['voter id', 'epic ABC1234567 ok', 'epic [redacted] ok'],
    ['passport', 'pp K1234567 valid', 'pp [redacted] valid'],
    ['UPI handle', 'pay asha@okaxis today', 'pay [redacted] today'],
    ['IPv4 address', 'from 203.0.113.42 at noon', 'from [redacted] at noon'],
    ['bearer token', 'header Bearer abc.def-123_xyz== end', 'header [redacted] end'],
    ['AWS access key id', 'key AKIAIOSFODNN7EXAMPLE end', 'key [redacted] end'],
    ['URL credentials', 'https://user:p4ss@host.example/path', '[redacted]host.example/path'],
    ['presigned URL signature', 'https://b.s3.amazonaws.com/f.pdf?X-Amz-Signature=abcdef123&x=1', 'https://b.s3.amazonaws.com/f.pdf?X-Amz-Signature=[redacted]&x=1'],
    ['token in a URL', 'https://h/cb?code=123456&state=ok', 'https://h/cb?code=[redacted]&state=ok'],
    ['card number', 'card 4111 1111 1111 1111 ok', 'card [redacted] ok'],
    ['card number with hyphens', 'card 5555-5555-5555-4444', 'card [redacted]'],
  ])('masks a %s', (_label, input, expected) => {
    expect(parse({ remark: input }).remark).toBe(expected);
  });

  it('masks a private key block', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\n-----END RSA PRIVATE KEY-----';

    expect(parse({ remark: `k ${pem} end` }).remark).toBe('k [redacted] end');
  });

  it('masks a long key-like string such as a hash or secret', () => {
    expect(parse({ remark: `h ${'a1b2c3d4'.repeat(6)} end` }).remark).toBe('h [redacted] end');
  });

  it('keeps real ids intact even when they contain a long digit run', () => {
    const out = parse({
      application_id: 'ACDE1A187394268679AE9C5',
      applicationId: 'ACDE1A187394268679AE9C5',
      file_ids: ['ACDE1A187394268679AE9C5', 'f2'],
      _id: '507f1f77bcf86cd799439011',
      workflow_id: 'WF01542FEAA77334E56A60E4D09346275AF',
    });

    expect(out).toEqual({
      application_id: 'ACDE1A187394268679AE9C5',
      applicationId: 'ACDE1A187394268679AE9C5',
      file_ids: ['ACDE1A187394268679AE9C5', 'f2'],
      _id: '507f1f77bcf86cd799439011',
      workflow_id: 'WF01542FEAA77334E56A60E4D09346275AF',
    });
  });

  it('still masks the same digit run in free text, and strict patterns even under id keys', () => {
    const out = parse({ remark: 'ref ACDE1A187394268679AE9C5 call 9876543210', pan_id: 'ABCDE1234F', user_id: 'a@b.com' });

    expect(out.remark).toBe('ref ACDE1A[redacted]AE9C5 call [redacted]');
    expect(out.pan_id).toBe('[redacted]');
    expect(out.user_id).toBe('[redacted]');
  });

  it('does NOT mask things that only look long or numeric: timestamps, ids, short codes, versions', () => {
    const out = parse({
      created_at: 1793647686749,
      note: 'ts 1793647686749 id 507f1f77bcf86cd799439011 v1.2.3 order 12345 ref APP-2026-0001 trace 4bf92f3577b34da6a3ce929d0e0e4736',
    });

    expect(out.created_at).toBe(1793647686749);
    expect(out.note).toBe('ts 1793647686749 id 507f1f77bcf86cd799439011 v1.2.3 order 12345 ref APP-2026-0001 trace 4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('a 13-19 digit number that fails the card checksum is kept', () => {
    expect(parse({ remark: 'n 1234567890123 end' }).remark).toBe('n 1234567890123 end');
  });
});

describe('sanitizeBody: size limits', () => {
  it('replaces a long string with its length, never a prefix of it', () => {
    const out = parse({ doc: 'x'.repeat(5000) });

    expect(out.doc).toBe('[string 5000 chars]');
  });

  it('keeps only the first items of a big array and says how many were left out', () => {
    const out = parse({ ids: Array.from({ length: 100 }, (_, i) => i) }, { maxItems: 3 });

    expect(out.ids).toEqual([0, 1, 2, '[+97 more]']);
  });

  it('stops at the depth limit', () => {
    expect(parse({ a: { b: { c: { d: 1 } } } }, { maxDepth: 3 })).toEqual({ a: { b: { c: '[deep]' } } });
  });

  it('caps the whole result and marks the cut', () => {
    const text = sanitizeBody(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`key${i}`, 'v'.repeat(150)])), { maxLength: 200 });

    expect(text?.length).toBeLessThanOrEqual(200 + '…[truncated]'.length);
    expect(text?.endsWith('…[truncated]')).toBe(true);
  });

  it('shows binary data as a size, and survives circular references', () => {
    const circular: Record<string, unknown> = { id: 'c' };
    circular.self = circular;

    expect(parse({ file: new Uint8Array(10) }).file).toBe('[binary 10 bytes]');
    expect(parse(circular)).toEqual({ id: 'c', self: '[circular]' });
  });
});

describe('sanitizeBody: nothing worth recording', () => {
  it.each([undefined, null, '', 'plain text', 42, {}, [], Buffer.from('x')])('returns undefined for %j', (body) => {
    expect(sanitizeBody(body)).toBeUndefined();
  });

  it('never throws, even for hostile objects', () => {
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error('boom'); } });

    expect(() => sanitizeBody(hostile)).not.toThrow();
  });
});

describe('recordRequestBody', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

  beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    trace.setGlobalTracerProvider(provider);
  });
  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    context.disable();
  });
  beforeEach(() => exporter.reset());

  const recorded = () => exporter.getFinishedSpans()[0]?.attributes['http.request.body'];

  it('puts the cleaned body on the active span', async () => {
    await withSpan('t', 'request', () => recordRequestBody({ application_id: 'A1', password: 'p' }));

    expect(JSON.parse(String(recorded()))).toEqual({ application_id: 'A1', password: '[redacted]' });
  });

  it.each(['/api/v1/auth/login', '/api/v1/auth/refresh', '/verify-otp', '/user/password/reset', '/api/vpd/token'])(
    'never records the body of %s',
    async (url) => {
      await withSpan('t', 'request', () => recordRequestBody({ username: 'u', secret: 's' }, { url }));

      expect(recorded()).toBeUndefined();
    },
  );

  it.each(['multipart/form-data; boundary=x', 'application/octet-stream', 'image/png', 'audio/mpeg', 'application/pdf'])(
    'never records a %s body',
    async (contentType) => {
      await withSpan('t', 'request', () => recordRequestBody({ a: 1 }, { contentType }));

      expect(recorded()).toBeUndefined();
    },
  );

  it('records a JSON body', async () => {
    await withSpan('t', 'request', () => recordRequestBody({ a: 1 }, { contentType: 'application/json; charset=utf-8' }));

    expect(recorded()).toBe('{"a":1}');
  });

  it('records ordinary routes, and the skip list can be replaced', async () => {
    await withSpan('t', 'request', () => recordRequestBody({ a: 1 }, { url: '/api/v1/applications' }));
    expect(recorded()).toBe('{"a":1}');

    exporter.reset();
    await withSpan('t', 'request', () => recordRequestBody({ a: 1 }, { url: '/api/v1/auth/x', skipUrls: /never-matches/ }));
    expect(recorded()).toBe('{"a":1}');
  });

  it('does nothing without an active span, and can be switched off', async () => {
    expect(() => recordRequestBody({ a: 1 })).not.toThrow();

    expect(requestBodyCaptureEnabled({})).toBe(true);
    for (const off of ['false', '0', 'no', 'off', 'FALSE']) expect(requestBodyCaptureEnabled({ OTEL_CAPTURE_REQUEST_BODY: off })).toBe(false);
    expect(requestBodyCaptureEnabled({ OTEL_CAPTURE_REQUEST_BODY: 'true' })).toBe(true);
  });
});
