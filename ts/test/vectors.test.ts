import { describe, expect, it } from 'vitest';

import { canonicalString, contentHash, parseMemoryContent } from '../src/canon.js';
import { cidDigest, cidV1Raw, cidV1RawToDigest } from '../src/cid.js';
import { commitmentHash } from '../src/commitment.js';
import { loadVectors } from '../src/vectors-node.js';

const { contents, commitments } = loadVectors();

describe('content vector corpus', () => {
  it('has a non-trivial corpus', () => {
    expect(contents.length).toBeGreaterThan(50);
  });

  it('every canonical form re-derives byte-identically', () => {
    for (const [index, vector] of contents.entries()) {
      const content = parseMemoryContent(vector.content);
      expect(canonicalString(content), `contents[${index}]`).toBe(vector.canonical);
    }
  });

  it('every contentHash matches its golden value', () => {
    for (const [index, vector] of contents.entries()) {
      expect(contentHash(vector.content), `contents[${index}]`).toBe(vector.contentHash);
    }
  });

  it('cidDigest covers the same bytes as canonicalBytes (D-9/D-4 coherence)', () => {
    for (const [index, vector] of contents.entries()) {
      const bytes = new TextEncoder().encode(vector.canonical);
      expect(cidDigest(bytes), `contents[${index}]`).toBe(vector.cidDigest);
      // The two roots are independent functions of the identical byte string.
      expect(contentHash(vector.content), `contents[${index}]`).toBe(vector.contentHash);
    }
  });

  it('cidV1Raw round-trips to the recorded digest', () => {
    for (const [index, vector] of contents.entries()) {
      expect(cidV1Raw(new TextEncoder().encode(vector.canonical)), `contents[${index}]`).toBe(
        vector.cidV1Raw,
      );
      expect(cidV1RawToDigest(vector.cidV1Raw), `contents[${index}]`).toBe(vector.cidDigest);
    }
  });
});

describe('commitment vector corpus', () => {
  it('contains exactly 100 structs (PRD)', () => {
    expect(commitments).toHaveLength(100);
  });

  it('every commitmentHash matches its golden value', () => {
    for (const [index, vector] of commitments.entries()) {
      expect(commitmentHash(vector.commitment), `commitments[${index}]`).toBe(
        vector.commitmentHash,
      );
    }
  });

  it('restores blockHeight as bigint and op as a number', () => {
    for (const vector of commitments) {
      expect(typeof vector.commitment.blockHeight).toBe('bigint');
      expect(vector.commitment.op).toBe(0);
    }
  });

  it('contains both chain roots and linked entries', () => {
    const roots = commitments.filter((v) => /^0x0{64}$/.test(v.commitment.prev));
    expect(roots.length).toBe(25);
  });
});
