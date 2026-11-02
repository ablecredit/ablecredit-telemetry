import { describe, expect, it } from 'vitest';
import { escapeRegExp, urlPrefixPattern } from '../src/shared/url.js';

describe('urlPrefixPattern', () => {
  const pattern = urlPrefixPattern('http://signoz.internal:4318');

  it('matches every url under the address', () => {
    expect(pattern.test('http://signoz.internal:4318/v1/traces')).toBe(true);
  });

  it('does not match other hosts, including look-alikes', () => {
    expect(pattern.test('http://other.internal:4318/v1/traces')).toBe(false);
    expect(pattern.test('http://signozXinternal:4318/v1/traces')).toBe(false);
    expect(pattern.test('https://evil.example/?u=http://signoz.internal:4318')).toBe(false);
  });
});

describe('escapeRegExp', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegExp('a.b*c(d)')).toBe('a\\.b\\*c\\(d\\)');
  });
});
