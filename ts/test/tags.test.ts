import { describe, expect, it } from 'vitest';
import { bytes32ToTag, tagToBytes32, tagsToBytes32List } from '../src/tags.js';
import { TagTooLongError } from '../src/errors.js';

describe('tagToBytes32 — UTF-8, right-padded', () => {
  it('pads on the right with zero bytes', () => {
    // Right padding (not left) so the tag reads correctly in a hex dump and
    // sorts lexicographically before its extensions.
    expect(tagToBytes32('ab')).toBe(`0x6162${'00'.repeat(30)}`);
  });

  it('encodes multi-byte UTF-8 by byte length, not character count', () => {
    // '日' is 3 UTF-8 bytes; 10 of them is 30 bytes and fits, 11 (33) does not.
    // A character-count check would wrongly accept the longer string.
    expect(() => tagToBytes32('日'.repeat(10))).not.toThrow();
    expect(() => tagToBytes32('日'.repeat(11))).toThrow(TagTooLongError);
  });

  it('accepts exactly 32 bytes', () => {
    expect(() => tagToBytes32('a'.repeat(32))).not.toThrow();
    expect(() => tagToBytes32('a'.repeat(33))).toThrow(TagTooLongError);
  });

  it('accepts the empty tag', () => {
    expect(tagToBytes32('')).toBe(`0x${'00'.repeat(32)}`);
  });
});

describe('bytes32ToTag', () => {
  it('strips trailing zero bytes', () => {
    expect(bytes32ToTag(tagToBytes32('hello'))).toBe('hello');
  });

  it('round-trips ASCII and CJK', () => {
    for (const tag of ['layer:deep', 'topic:seed', '标签', '', 'a'.repeat(32)]) {
      expect(bytes32ToTag(tagToBytes32(tag))).toBe(tag);
    }
  });

  it('preserves an interior NUL when non-zero bytes follow it', () => {
    // Only the *trailing* run of zero bytes is padding. An interior NUL that
    // is followed by data is part of the tag and survives the round trip.
    expect(bytes32ToTag(`0x610062${'00'.repeat(29)}`)).toBe('a\u0000b');
  });

  it('cannot distinguish a trailing NUL from padding (documented limitation)', () => {
    // Right-padding means a tag ending in NUL is not representable: decoding
    // strips it along with the padding. Worth pinning so nobody "fixes" the
    // decode loop into something that breaks the padding contract.
    expect(bytes32ToTag(`0x6100${'00'.repeat(30)}`)).toBe('a');
  });
});

describe('tagsToBytes32List', () => {
  it('maps in order', () => {
    expect(tagsToBytes32List(['a', 'b'])).toEqual([tagToBytes32('a'), tagToBytes32('b')]);
  });

  it('rejects the first oversized tag', () => {
    expect(() => tagsToBytes32List(['ok', 'x'.repeat(33)])).toThrow(TagTooLongError);
  });
});
