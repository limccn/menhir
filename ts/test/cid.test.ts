import { describe, expect, it } from 'vitest';
import { sha256 } from 'viem';
import {
  base32Decode,
  base32Encode,
  cidDigest,
  cidV1Raw,
  cidV1RawFromDigest,
  cidV1RawToDigest,
} from '../src/cid.js';

const encoder = new TextEncoder();

describe('cidDigest', () => {
  it('is plain sha256 over the bytes, not a CID multihash', () => {
    // menhir spec §3.3 / D-9: the on-chain value is the raw sha256 digest.
    // If this ever became the multihash, every on-chain comparison breaks.
    const bytes = encoder.encode('hello world');
    expect(cidDigest(bytes)).toBe(sha256(bytes));
    expect(cidDigest(bytes)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('matches the known sha256 of "hello world"', () => {
    expect(cidDigest(encoder.encode('hello world'))).toBe(
      '0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
  });
});

describe('base32 — RFC 4648, lowercase, unpadded', () => {
  it('encodes to the RFC 4648 alphabet', () => {
    expect(base32Encode(encoder.encode('foobar'))).toBe('mzxw6ytboi');
  });

  it('round-trips arbitrary bytes', () => {
    for (const text of ['', 'a', 'ab', 'abc', 'abcd', '\u0000ÿ', '日本語テキスト']) {
      const bytes = encoder.encode(text);
      expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    }
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => base32Decode('mzxw6ytboi!')).toThrow();
    expect(() => base32Decode('0189')).toThrow(); // 0,1,8,9 are not base32-lower
  });

  it('treats uppercase as equivalent', () => {
    expect(base32Decode('MZXW6YTBOI')).toEqual(base32Decode('mzxw6ytboi'));
  });
});

describe('CIDv1 raw encoding', () => {
  const bytes = encoder.encode('hello world');
  const cid = cidV1Raw(bytes);

  it('produces a b-prefixed CIDv1 raw string', () => {
    expect(cid.startsWith('b')).toBe(true);
    // version(1) + codec raw(0x55) + sha2-256(0x12) + len(0x20) + 32 bytes
    expect(base32Decode(cid.slice(1))).toHaveLength(36);
  });

  it('round-trips to the same sha256 digest as cidDigest', () => {
    // The CID and the on-chain digest must describe the same bytes. This is
    // the invariant that lets the UI derive a retrieval key from chain state.
    expect(cidV1RawToDigest(cid)).toBe(cidDigest(bytes));
    expect(cidV1RawFromDigest(cidDigest(bytes))).toBe(cid);
  });

  it('agrees with the multiformats reference implementation', async () => {
    // Independent implementation: if our hand-rolled encoder is ever wrong,
    // real gateways would reject every CID we produce.
    const { CID } = await import('multiformats/cid');
    const { sha256: mfSha256 } = await import('multiformats/hashes/sha2');
    const raw = await import('multiformats/codecs/raw');

    const digest = await mfSha256.digest(bytes);
    const reference = CID.createV1(raw.code, digest).toString();
    expect(cid).toBe(reference);
  });

  it('returns null for non-raw CIDs and malformed input', () => {
    expect(cidV1RawToDigest('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG')).toBeNull(); // CIDv0
    expect(cidV1RawToDigest('not-a-cid')).toBeNull();
    expect(cidV1RawToDigest('b!!!')).toBeNull();
    expect(cidV1RawToDigest('')).toBeNull();
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(cidV1RawToDigest(`  ${cid}  `)).toBe(cidDigest(bytes));
  });
});
