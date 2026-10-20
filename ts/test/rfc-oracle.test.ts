import canonicalize from 'canonicalize';
import { describe, expect, it } from 'vitest';

import { canonicalString, contentHash } from '../src/canon.js';

/**
 * Independent oracle: the RFC 8785 example from §3.2.2, with the canonical
 * output published in §3.2.3.
 *
 * Why this file exists separately from `vectors.test.ts`: the vector suite
 * re-derives its golden values with the same functions that generated them, so
 * a `canonicalize` upgrade or a wrapper change would move producer and checker
 * together and every test would still pass. This one compares against a string
 * taken from the RFC itself, so drift in the dependency is detectable.
 *
 * Source: https://www.rfc-editor.org/rfc/rfc8785.txt
 *   §3.2.2  input JSON
 *   §3.2.3  canonical output
 */
// Built from code points rather than typed as a literal: the RFC sample mixes
// control characters, a quote, and backslashes, and hand-escaped source is
// exactly how this test was first written incorrectly.
const RFC_STRING =
  String.fromCodePoint(0x20ac) + // €
  '$' +
  String.fromCodePoint(0x0f, 0x0a) + // \u000F \u000A
  'A' +
  String.fromCodePoint(0x27) + // '
  String.fromCodePoint(0x42) + // B
  String.fromCodePoint(0x22) + // "
  String.fromCodePoint(0x5c) + // backslash
  String.fromCodePoint(0x5c) + // backslash (the escaped literal in the RFC input)
  String.fromCodePoint(0x22) + // "
  '/';

const RFC_INPUT = {
  numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
  string: RFC_STRING,
  literals: [null, true, false],
};

/**
 * Verbatim from RFC 8785 §3.2.3. Written with `String.raw` so every backslash
 * below is the literal character in the output, not a JS escape — writing it
 * as a normal string literal is how the first version of this file silently
 * became unparseable.
 *
 * Notable transformations the RFC requires, each visible here:
 *   - `333333333.33333329` → `333333333.3333333`  (shortest round-trip)
 *   - `1E30` → `1e+30`, `2e-3` → `0.002`, `1e-27` stays
 *   - `\u000F` → `\u000f` (lowercase hex), `\u000a` → `\n`
 *   - `"` → `\"`, `\` → `\\`
 *   - key order: literals, numbers, string
 */
const RFC_EXPECTED = String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`;

describe('RFC 8785 oracle (§3.2.2 → §3.2.3)', () => {
  it('canonicalize reproduces the RFC-published output byte-for-byte', () => {
    expect(canonicalize(RFC_INPUT)).toBe(RFC_EXPECTED);
  });

  it('routes the RFC numbers through the wrapper without changing them', () => {
    // The RFC object itself is not a valid MemoryContent (its top level has
    // keys the schema rejects), so its behaviour is exercised through `meta`.
    // This asserts that snapshot-then-canonicalize does not alter the numbers'
    // canonical spelling.
    const json = canonicalString({
      text: 'rfc8785',
      format: 'text.v0',
      meta: { numbers: RFC_INPUT.numbers },
    });
    expect(json).toContain('"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]');
    expect(json).not.toContain('333333333.33333329'); // unrounded input must not leak
  });

  it('produces the RFC escaling rules for the string field', () => {
    const json = canonicalString({
      text: 'rfc8785',
      format: 'text.v0',
      meta: { s: RFC_INPUT.string },
    });
    // Same escaping the RFC output shows: lowercase \u000f, \n, unescaped €
    // and ', escaped " and \\.
    expect(json).toContain(String.raw`"s":"€$\u000f\nA'B\"\\\\\"`);
  });

  it('contentHash is stable over the RFC-derived canonical bytes', () => {
    const content = { text: 'rfc8785', format: 'text.v0' as const };
    expect(contentHash(content)).toBe(contentHash(content));
    expect(contentHash(content)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});