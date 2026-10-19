import { TagTooLongError } from './errors.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** UTF-8 bytes of the tag, zero-padded on the RIGHT, max 32 bytes. */
export function tagToBytes32(tag: string): `0x${string}` {
  const bytes = encoder.encode(tag);
  if (bytes.length > 32) throw new TagTooLongError(tag, bytes.length);
  const padded = new Uint8Array(32);
  padded.set(bytes, 0);
  return `0x${toHex(padded)}`;
}

/** Strips trailing zero bytes, decodes UTF-8. */
export function bytes32ToTag(value: `0x${string}`): string {
  const bytes = fromHex(value);
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  return decoder.decode(bytes.subarray(0, end));
}

export function tagsToBytes32List(tags: readonly string[]): `0x${string}`[] {
  return tags.map(tagToBytes32);
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
