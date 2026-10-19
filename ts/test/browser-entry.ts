/**
 * Browser-safety smoke (core-ts design §4, PRD AC).
 *
 * Compiled by `pnpm check:browser` with `--lib es2022,dom`. If any module
 * reachable from the package root imports a Node builtin, this fails to
 * compile — that is the whole test. It is deliberately not run under vitest:
 * vitest's environment would mask a `node:` import that a real browser
 * bundle cannot resolve.
 *
 * `@menhir/core/vectors` is intentionally NOT imported here: it is the one
 * Node-only subpath (filesystem loading), by design.
 */
import {
  canonicalBytes,
  canonicalString,
  contentHash,
  isWellFormedUtf16,
  parseMemoryContent,
} from '../src/canon.js';
import { cidDigest, cidV1Raw, cidV1RawFromDigest } from '../src/cid.js';
import {
  commitmentDigest,
  commitmentHash,
  assertAddress,
  assertBytes32,
  isZeroBytes32,
  ZERO_BYTES32,
} from '../src/commitment.js';
import { bytes32ToTag, tagToBytes32, tagsToBytes32List } from '../src/tags.js';
import { parseVectors } from '../src/vectors.js';
import { memoryRegistryAbi } from '../src/abi.js';
import {
  InvalidHexError,
  MenhirCoreError,
  NonNormalizedInputError,
  SchemaViolationError,
  TagTooLongError,
  UnknownKeyError,
} from '../src/errors.js';

const content = parseMemoryContent({ text: 'browser smoke', format: 'text.v0' });

export const surface = {
  bytes: canonicalBytes(content),
  canonical: canonicalString(content),
  contentHash: contentHash(content),
  cidDigest: cidDigest(new Uint8Array()),
  cidV1Raw: cidV1Raw(new Uint8Array()),
  cidV1RawFromDigest: cidV1RawFromDigest(ZERO_BYTES32),
  wellFormed: isWellFormedUtf16('ok'),
  tag: tagToBytes32('layer:semantic'),
  tagBack: bytes32ToTag(tagToBytes32('layer:semantic')),
  tags: tagsToBytes32List(['a', 'b']),
  zero: isZeroBytes32(ZERO_BYTES32),
  address: assertAddress(`0x${'11'.repeat(20)}`),
  bytes32: assertBytes32(`0x${'22'.repeat(32)}`),
  commitmentHash: commitmentHash({
    owner: `0x${'11'.repeat(20)}`,
    contentHash: `0x${'22'.repeat(32)}`,
    cidDigest: `0x${'33'.repeat(32)}`,
    signer: `0x${'11'.repeat(20)}`,
    blockHeight: 1n,
    op: 0,
    prev: ZERO_BYTES32,
  }),
  commitmentDigest: commitmentDigest(
    {
      owner: `0x${'11'.repeat(20)}`,
      contentHash: `0x${'22'.repeat(32)}`,
      cidDigest: `0x${'33'.repeat(32)}`,
      signer: `0x${'11'.repeat(20)}`,
      blockHeight: 1n,
      op: 0,
      prev: ZERO_BYTES32,
    },
    { chainId: 84532, verifyingContract: `0x${'44'.repeat(20)}` },
  ),
  parsedVectors: parseVectors('[]', '[]'),
  abi: memoryRegistryAbi,
  errors: [
    new MenhirCoreError('SCHEMA_VIOLATION', 'x'),
    new NonNormalizedInputError(),
    new UnknownKeyError('k'),
    new SchemaViolationError('x'),
    new TagTooLongError('t', 33),
    new InvalidHexError('x'),
  ],
};
