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
