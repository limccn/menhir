import { describe, expect, it } from 'vitest';
import { keccak256, stringToBytes } from 'viem';
import {
  canonicalBytes,
  canonicalString,
  contentHash,
  isWellFormedUtf16,
  parseMemoryContent,
} from '../src/canon.js';
import {
  NonNormalizedInputError,
  SchemaViolationError,
  UnknownKeyError,
} from '../src/errors.js';

const BASE = { text: 'hello world', format: 'text.v0' } as const;

describe('parseMemoryContent — schema gate', () => {
  it('accepts the minimal shape', () => {
    expect(parseMemoryContent(BASE)).toEqual({ text: 'hello world', format: 'text.v0' });
  });

  it('accepts refs and meta', () => {
    const out = parseMemoryContent({
      ...BASE,
      refs: ['ipfs://bafy'],
      meta: { source: 'agent', nested: { n: 1 } },
    });
    expect(out.refs).toEqual(['ipfs://bafy']);
    expect(out.meta).toEqual({ source: 'agent', nested: { n: 1 } });
  });

  it('rejects unknown top-level keys instead of silently dropping them', () => {
    // Extension must go through `meta`; a stray key would otherwise vanish
    // from the canonical bytes and produce a hash the author did not intend.
    expect(() => parseMemoryContent({ ...BASE, extra: 1 })).toThrow(UnknownKeyError);
  });

  it('rejects empty and whitespace-only text', () => {
    expect(() => parseMemoryContent({ text: '', format: 'text.v0' })).toThrow(
      SchemaViolationError,
    );
    expect(() => parseMemoryContent({ text: '   ', format: 'text.v0' })).toThrow(
      SchemaViolationError,
    );
  });

  it('rejects a wrong format value', () => {
    expect(() => parseMemoryContent({ text: 'x', format: 'text.v1' })).toThrow(
      SchemaViolationError,
    );
  });

  it('rejects non-string refs', () => {
    expect(() => parseMemoryContent({ ...BASE, refs: [1] })).toThrow(SchemaViolationError);
  });

  it('rejects non-finite numbers in meta', () => {
    expect(() => parseMemoryContent({ ...BASE, meta: { n: NaN } })).toThrow(
      SchemaViolationError,
    );
    expect(() => parseMemoryContent({ ...BASE, meta: { n: Infinity } })).toThrow(
      SchemaViolationError,
    );
  });

  it('rejects values that are not JSON at all', () => {
    expect(() => parseMemoryContent({ ...BASE, meta: { fn: () => 1 } })).toThrow(
      SchemaViolationError,
    );
    expect(() => parseMemoryContent({ ...BASE, meta: { big: 1n } })).toThrow(
      SchemaViolationError,
    );
  });

  it('rejects meta nested beyond the depth limit', () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 70; i += 1) deep = { child: deep };
    expect(() => parseMemoryContent({ ...BASE, meta: deep })).toThrow(
      SchemaViolationError,
    );
  });

  it('rejects non-object content', () => {
    expect(() => parseMemoryContent('a string')).toThrow(SchemaViolationError);
    expect(() => parseMemoryContent(null)).toThrow(SchemaViolationError);
    expect(() => parseMemoryContent([BASE])).toThrow(SchemaViolationError);
  });
});

describe('Unicode normalization gate', () => {
  it('accepts NFC text', () => {
    // "é" as a single composed code point is NFC.
    expect(() => parseMemoryContent({ text: 'é', format: 'text.v0' })).not.toThrow();
  });

  it('rejects decomposed text that is not NFC', () => {
    // "e" + combining acute — visually identical, different bytes. Accepting
    // it would let two spellings of the same text hash differently.
    expect(() => parseMemoryContent({ text: 'é', format: 'text.v0' })).toThrow(
      NonNormalizedInputError,
    );
  });

  it('rejects lone surrogates', () => {
    expect(isWellFormedUtf16('ok')).toBe(true);
    expect(isWellFormedUtf16('\uD800')).toBe(false); // lone high
    expect(isWellFormedUtf16('\uDC00')).toBe(false); // lone low
    expect(isWellFormedUtf16('a\uD800b')).toBe(false);
    expect(isWellFormedUtf16('😀')).toBe(true); // valid pair
    expect(() => parseMemoryContent({ text: '\uD800', format: 'text.v0' })).toThrow(
      NonNormalizedInputError,
    );
  });
});

describe('canonical form — JCS (RFC 8785)', () => {
  it('sorts object keys and emits no whitespace', () => {
    const a = canonicalString({ text: 'x', format: 'text.v0', meta: { b: 1, a: 2 } });
    const b = canonicalString({ format: 'text.v0', meta: { a: 2, b: 1 }, text: 'x' });
    expect(a).toBe(b);
    expect(a).toBe('{"format":"text.v0","meta":{"a":2,"b":1},"text":"x"}');
  });

  it('represents an own __proto__ member instead of dropping it (M-2)', () => {
    // JSON.parse is what produces an OWN `__proto__` data property; an object
    // literal would set the prototype and never reach the snapshot as a key.
    const withProto = JSON.parse(
      '{"text":"own proto","format":"text.v0","meta":{"__proto__":{"admin":true}}}',
    );
    const empty = { text: 'own proto', format: 'text.v0' as const, meta: {} };

    const parsed = parseMemoryContent(withProto);
    // The key survives as an ordinary own member.
    expect(Object.keys(parsed.meta!)).toContain('__proto__');
    // ...and it is data, not an inherited property.
    expect((parsed.meta as Record<string, unknown>).admin).toBeUndefined();
    expect(Object.getPrototypeOf(parsed.meta)).toBe(Object.prototype);

    // The canonical bytes agree with the reference implementation.
    expect(canonicalString(withProto)).toBe(
      '{"format":"text.v0","meta":{"__proto__":{"admin":true}},"text":"own proto"}',
    );
    // Injectivity: it cannot collide with the empty-meta content.
    expect(contentHash(withProto)).not.toBe(contentHash(empty));
  });

  it('round-trips a parsed __proto__ member without a schema error', () => {
    const parsed = parseMemoryContent(
      JSON.parse('{"text":"roundtrip","format":"text.v0","meta":{"__proto__":{"x":1}}}'),
    );
    const once = canonicalString(parsed);
    const twice = canonicalString(parseMemoryContent(JSON.parse(once)));
    expect(twice).toBe(once);
  });

  it('canonicalBytes and contentHash agree with an independent keccak256', () => {
    // The hash rule is keccak256(JCS bytes). Recomputing it here through a
    // separate path is the point: if canonicalBytes ever drifts, this fails.
    const content = parseMemoryContent({ ...BASE, meta: { z: [3, 2, 1], a: true } });
    const expected = keccak256(stringToBytes(canonicalString(content)));
    expect(contentHash(content)).toBe(expected);
    expect(keccak256(canonicalBytes(content))).toBe(expected);
  });

  it('pins a known JCS vector', () => {
    // RFC 8785 §3.2.2 style checks: numbers and escaping.
    expect(canonicalString({ text: 'a\nb', format: 'text.v0' })).toBe(
      '{"format":"text.v0","text":"a\\nb"}',
    );
  });

  it('rejects arrays where the schema expects an object', () => {
    expect(() => parseMemoryContent([])).toThrow(SchemaViolationError);
  });
});
