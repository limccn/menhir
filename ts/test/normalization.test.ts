import { describe, expect, it } from 'vitest';

import { canonicalBytes, canonicalString, parseMemoryContent } from '../src/canon.js';
import { NonNormalizedInputError, SchemaViolationError } from '../src/errors.js';

/**
 * Regression tests for the 2026-10-19 review (core-ts R1/R2).
 *
 * Both defects shared one symptom: `canonicalize` silently rewrote input the
 * user never wrote, and the resulting hash was stable and plausible. A hash
 * that is wrong but verifiable is worse than a crash — nothing downstream can
 * detect it.
 */

describe('R1 — non-JSON object types are rejected, never coerced', () => {
  const base = { text: 'x', format: 'text.v0' } as const;

  it.each([
    ['Date', new Date('2020-01-01T00:00:00Z')],
    ['Map', new Map([['a', 1]])],
    ['Set', new Set([1, 2])],
    ['RegExp', /abc/],
    ['class instance', new (class Memory { readonly text = 'x' })()],
  ])('rejects %s inside meta', (_label, value) => {
    expect(() =>
      parseMemoryContent({ ...base, meta: { value } }),
    ).toThrow(SchemaViolationError);
  });

  it('still accepts null-prototype objects (they are plain JSON mappings)', () => {
    const meta = Object.create(null) as Record<string, unknown>;
    meta.a = 1;
    expect(() => parseMemoryContent({ ...base, meta })).not.toThrow();
  });

  it('rejects the same coercion when canonicalBytes is called directly', () => {
    // Public entry point: callers can hand-build MemoryContent. The gate must
    // not live only inside parseMemoryContent.
    const handBuilt = {
      text: 'x',
      format: 'text.v0' as const,
      meta: { d: new Date('2020-01-01T00:00:00Z') } as never,
    };
    expect(() => canonicalBytes(handBuilt)).toThrow(SchemaViolationError);
  });
});

describe('R3 — the gate cannot be bypassed at the public entry points', () => {
  const base = { text: 'x', format: 'text.v0' } as const;

  it.each([
    ['refs as a Set', { ...base, refs: new Set(['a']) }],
    ['refs as a string', { ...base, refs: 'abc' }],
    ['refs containing a number', { ...base, refs: [42] }],
    ['refs containing null', { ...base, refs: [null] }],
    ['unknown top-level key', { ...base, tags: ['secret'] }],
    ['unsupported format', { text: 'x', format: 'text.v1' }],
    ['missing format', { text: 'x' }],
    ['non-string text', { text: 42, format: 'text.v0' }],
    ['Date as text', { text: new Date('2020-01-01T00:00:00Z'), format: 'text.v0' }],
  ])('rejects %s when canonicalString is called directly', (_label, value) => {
    expect(() => canonicalString(value as never)).toThrow();
  });

  it('rejects a root toJSON that would serialize different content', () => {
    const evil = {
      text: 'x',
      format: 'text.v0' as const,
      toJSON() {
        return { text: 'evil', format: 'text.v0' };
      },
    };
    expect(() => canonicalString(evil)).toThrow(SchemaViolationError);
  });

  it('rejects an own toJSON nested inside meta', () => {
    // Cast because this is deliberately not a valid MemoryContent: the point
    // is that the runtime gate must catch what the type system rejects.
    const evil = {
      ...base,
      meta: {
        toJSON() {
          return { s: 'evil' };
        },
      },
    } as unknown as Parameters<typeof canonicalString>[0];
    expect(() => canonicalString(evil)).toThrow(SchemaViolationError);
  });

  it('reads each property exactly once (no TOCTOU window)', () => {
    // A getter that answers differently on the second read is the shape of the
    // bug: validate the first answer, serialize the second. Snapshotting means
    // there is no second read.
    let reads = 0;
    const evil = {
      format: 'text.v0' as const,
      get text() {
        reads += 1;
        return reads === 1 ? 'safe' : 'é'; // NFC then NFD
      },
    };
    expect(canonicalString(evil as never)).toBe('{"format":"text.v0","text":"safe"}');
    expect(reads).toBe(1);
  });

  it('a non-string text yields a typed error, not a TypeError', () => {
    expect(() => canonicalString({ text: 42 as never, format: 'text.v0' })).toThrow(
      SchemaViolationError,
    );
    expect(() => canonicalString({ text: 42 as never, format: 'text.v0' })).not.toThrow(
      TypeError,
    );
  });

  it('parseMemoryContent and canonicalString enforce the same rules', () => {
    // One gate, not two. If the parser accepted something the hasher rejects
    // (or vice versa), callers would see inconsistent behaviour on the same
    // input depending on which function they happened to call.
    const inputs: unknown[] = [
      { ...base, refs: new Set(['a']) },
      { ...base, tags: [] },
      { text: 'x', format: 'text.v1' },
      { ...base, meta: { s: 'é' } },
    ];
    for (const input of inputs) {
      expect(() => parseMemoryContent(input), 'parse').toThrow();
      expect(() => canonicalString(input as never), 'canon').toThrow();
    }
  });
});

describe('R2 — normalization is enforced for every string in the hashed object', () => {
  const base = { text: 'x', format: 'text.v0' } as const;
  const NFD = 'é'; // e + combining acute
  const NFC = 'é';

  it('accepts the NFC spelling', () => {
    expect(() => parseMemoryContent({ ...base, meta: { s: NFC } })).not.toThrow();
  });

  it('rejects a non-NFC value inside meta', () => {
    expect(() => parseMemoryContent({ ...base, meta: { s: NFD } })).toThrow(
      NonNormalizedInputError,
    );
  });

  it('rejects a non-NFC object key inside meta', () => {
    expect(() => parseMemoryContent({ ...base, meta: { [NFD]: 1 } })).toThrow(
      NonNormalizedInputError,
    );
  });

  it('rejects a non-NFC ref', () => {
    expect(() => parseMemoryContent({ ...base, refs: [NFD] })).toThrow(
      NonNormalizedInputError,
    );
  });

  it('rejects non-NFC input fed straight to canonicalString', () => {
    const handBuilt = { text: 'x', format: 'text.v0' as const, meta: { s: NFD } };
    expect(() => canonicalString(handBuilt)).toThrow(NonNormalizedInputError);
  });

  it('documents why rejection (not silent normalization) is the policy', () => {
    // The two spellings are visibly identical but encode to different UTF-8
    // bytes, so under JCS they would hash differently. Silently normalizing
    // would anchor a commitment that no longer matches the bytes the user's
    // content producers sent; rejecting makes the mismatch the caller's.
    expect(NFC).not.toBe(NFD);
    expect(new TextEncoder().encode(NFC).length).not.toBe(
      new TextEncoder().encode(NFD).length,
    );
    expect(() => canonicalBytes({ ...base, meta: { s: NFD } })).toThrow(
      NonNormalizedInputError,
    );
  });
});
