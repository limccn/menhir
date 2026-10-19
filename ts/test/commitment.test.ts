import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, keccak256, type Hex } from 'viem';
import {
  assertAddress,
  assertBytes32,
  commitmentDigest,
  commitmentHash,
  isZeroBytes32,
  ZERO_BYTES32,
  type Commitment,
} from '../src/commitment.js';
import { InvalidHexError } from '../src/errors.js';

const OWNER = `0x${'11'.repeat(20)}` as const;
const SIGNER = `0x${'22'.repeat(20)}` as const;
const CONTENT_HASH = `0x${'aa'.repeat(32)}` as const;
const CID_DIGEST = `0x${'bb'.repeat(32)}` as const;

const c: Commitment = {
  owner: OWNER,
  contentHash: CONTENT_HASH,
  cidDigest: CID_DIGEST,
  signer: SIGNER,
  blockHeight: 1234n,
  op: 0,
  prev: ZERO_BYTES32,
};

describe('commitmentHash — ABI encoding', () => {
  it('matches an independently built abi.encode + keccak256', () => {
    // The single most important cross-language invariant in M1: this value is
    // computed in Solidity, in the browser, and in scripts. Rebuilding the
    // encoding here from the documented component order proves the shared
    // COMMITMENT_COMPONENTS array has not drifted.
    const expected = keccak256(
      encodeAbiParameters(
        [
          { name: 'owner', type: 'address' },
          { name: 'contentHash', type: 'bytes32' },
          { name: 'cidDigest', type: 'bytes32' },
          { name: 'signer', type: 'address' },
          { name: 'blockHeight', type: 'uint64' },
          { name: 'op', type: 'uint8' },
          { name: 'prev', type: 'bytes32' },
        ],
        [OWNER, CONTENT_HASH, CID_DIGEST, SIGNER, 1234n, 0, ZERO_BYTES32],
      ),
    );
    expect(commitmentHash(c)).toBe(expected);
  });

  it('pins the documented component order (op BEFORE prev)', () => {
    // Swapping op and prev must change the hash. If a refactor reorders the
    // interface without the array (or vice versa), this catches it.
    const swapped: Commitment = { ...c, op: 1 };
    const reordered = keccak256(
      encodeAbiParameters(
        [
          { name: 'owner', type: 'address' },
          { name: 'contentHash', type: 'bytes32' },
          { name: 'cidDigest', type: 'bytes32' },
          { name: 'signer', type: 'address' },
          { name: 'blockHeight', type: 'uint64' },
          { name: 'prev', type: 'bytes32' },
          { name: 'op', type: 'uint8' },
        ],
        [OWNER, CONTENT_HASH, CID_DIGEST, SIGNER, 1234n, ZERO_BYTES32, 1],
      ),
    );
    expect(commitmentHash(swapped)).not.toBe(reordered);
  });

  it('changes when blockHeight changes', () => {
    // Documents a real pitfall: commitmentHash is NOT content-derived because
    // it covers the anchoring block. Anything needing a content-stable key
    // must use contentHash instead.
    expect(commitmentHash({ ...c, blockHeight: 1235n })).not.toBe(commitmentHash(c));
  });

  it('changes when any field changes', () => {
    const variants: Commitment[] = [
      { ...c, owner: `0x${'33'.repeat(20)}` },
      { ...c, contentHash: `0x${'cc'.repeat(32)}` },
      { ...c, cidDigest: `0x${'dd'.repeat(32)}` },
      { ...c, signer: `0x${'44'.repeat(20)}` },
      { ...c, prev: `0x${'ee'.repeat(32)}` },
    ];
    const base = commitmentHash(c);
    for (const variant of variants) expect(commitmentHash(variant)).not.toBe(base);
  });

  it('accepts op 1 (retract)', () => {
    expect(() => commitmentHash({ ...c, op: 1 })).not.toThrow();
    expect(commitmentHash({ ...c, op: 1 })).not.toBe(commitmentHash(c));
  });
});

describe('commitmentDigest — EIP-712', () => {
  const domain = {
    chainId: 84532,
    verifyingContract: `0x${'99'.repeat(20)}` as const,
  };

  it('produces a 32-byte digest', () => {
    expect(commitmentDigest(c, domain)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('is domain-bound: chainId and verifyingContract both matter', () => {
    const base = commitmentDigest(c, domain);
    expect(commitmentDigest(c, { ...domain, chainId: 8453 })).not.toBe(base);
    expect(
      commitmentDigest(c, { ...domain, verifyingContract: `0x${'88'.repeat(20)}` }),
    ).not.toBe(base);
  });

  it('differs from commitmentHash (different constructions)', () => {
    expect(commitmentDigest(c, domain)).not.toBe(commitmentHash(c));
  });
});

describe('hex validators', () => {
  it('accepts well-formed values', () => {
    expect(assertAddress(OWNER)).toBe(OWNER);
    expect(assertBytes32(CONTENT_HASH)).toBe(CONTENT_HASH);
  });

  it('rejects wrong lengths and non-hex', () => {
    expect(() => assertAddress(`0x${'11'.repeat(19)}`)).toThrow(InvalidHexError);
    expect(() => assertAddress(`0x${'11'.repeat(21)}`)).toThrow(InvalidHexError);
    expect(() => assertAddress('nope')).toThrow(InvalidHexError);
    expect(() => assertBytes32(`0x${'aa'.repeat(31)}`)).toThrow(InvalidHexError);
    expect(() => assertBytes32(`0x${'zz'.repeat(32)}`)).toThrow(InvalidHexError);
  });

  it('accepts uppercase hex', () => {
    expect(assertBytes32(`0x${'AA'.repeat(32)}`)).toBe(`0x${'AA'.repeat(32)}`);
  });

  it('detects the zero bytes32', () => {
    expect(isZeroBytes32(ZERO_BYTES32)).toBe(true);
    expect(isZeroBytes32(`0x${'0'.repeat(63)}1` as Hex)).toBe(false);
    expect(isZeroBytes32(CONTENT_HASH)).toBe(false);
  });
});
