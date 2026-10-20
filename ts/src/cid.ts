import { sha256 } from 'viem';
import { InvalidHexError } from './errors.js';

/** sha256(bytes) — the retrieval-layer integrity root (menhir spec §3.3, D-9). */
export function cidDigest(bytes: Uint8Array): `0x${string}` {
  return sha256(bytes);
}

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** RFC 4648 base32, lowercase, no padding (multibase 'b' body). */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

const CIDV1_RAW_PREFIX = Uint8Array.from([0x01, 0x55, 0x12, 0x20]);

/**
 * CIDv1 raw (codec 0x55) base32-lowercase string from raw bytes.
 * Metadata/display + gateway retrieval only — integrity always comes from the
 * two digests over the same bytes (D-9).
 */
export function cidV1Raw(bytes: Uint8Array): string {
  const digest = hexToBytes(sha256(bytes));
  const payload = new Uint8Array(CIDV1_RAW_PREFIX.length + digest.length);
  payload.set(CIDV1_RAW_PREFIX, 0);
  payload.set(digest, CIDV1_RAW_PREFIX.length);
  return `b${base32Encode(payload)}`;
}

/**
 * Build the same CIDv1 raw string from an on-chain cidDigest
 * (sha256(bytes)). Lets the UI turn a commitment's digest into the retrieval
 * key without knowing the CID at write time.
 */
export function cidV1RawFromDigest(digest: `0x${string}`): string {
  const bytes = hexToBytes(digest);
  if (bytes.length !== 32) {
    throw new InvalidHexError(`cid digest must be 32 bytes, got ${bytes.length}`);
  }
  const payload = new Uint8Array(CIDV1_RAW_PREFIX.length + 32);
  payload.set(CIDV1_RAW_PREFIX, 0);
  payload.set(bytes, CIDV1_RAW_PREFIX.length);
  return `b${base32Encode(payload)}`;
}

/**
 * Strict hex → bytes. Rejects odd length and non-hex characters instead of
 * producing silently wrong bytes: `parseInt('zz', 16)` is NaN, which becomes
 * `0` inside a Uint8Array, so a truncated or malformed digest from a chain
 * read would yield a valid-looking CID that fetches nothing (review 2026-10-20).
 */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new InvalidHexError(`hex string has odd length: ${clean.length}`);
  }
  if (!/^[0-9a-fA-F]*$/.test(clean)) {
    throw new InvalidHexError(`hex string has non-hex characters: ${hex.slice(0, 10)}…`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const BASE32_LOOKUP: Record<string, number> = Object.fromEntries(
  [...BASE32_ALPHABET].map((ch, index) => [ch, index]),
);

/** RFC 4648 base32 decode (lowercase, no padding). Throws on bad input. */
export function base32Decode(input: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.toLowerCase()) {
    const digit = BASE32_LOOKUP[ch];
    if (digit === undefined) throw new Error(`invalid base32 character: ${ch}`);
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Uint8Array.from(out);
}

/**
 * Extract the sha256 digest from a CIDv1 raw string (`b` multibase, codec
 * 0x55). Returns null when the CID is not a raw/sha2-256 CIDv1 (nothing else
 * can match an on-chain cidDigest in M1).
 */
export function cidV1RawToDigest(cid: string): `0x${string}` | null {
  const value = cid.trim();
  if (!value.startsWith('b')) return null;
  let payload: Uint8Array;
  try {
    payload = base32Decode(value.slice(1));
  } catch {
    return null;
  }
  // version(1) + codec(1) + multihash(2 header + 32 digest)
  if (payload.length !== 36) return null;
  if (payload[0] !== 0x01 || payload[1] !== 0x55) return null;
  if (payload[2] !== 0x12 || payload[3] !== 0x20) return null;
  return `0x${Array.from(payload.slice(4))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`;
}

