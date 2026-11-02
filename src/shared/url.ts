/** Escape text so it can be placed inside a regular expression literally. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A pattern that matches any URL starting with `url`.
 *
 * OpenTelemetry compares a plain string against the WHOLE request URL, so a base address such as
 * `http://host:4318` would never match `http://host:4318/v1/traces`. A pattern does.
 */
export function urlPrefixPattern(url: string): RegExp {
  return new RegExp(`^${escapeRegExp(url)}`);
}
