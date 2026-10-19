import { describe, expect, it } from 'vitest';

import * as core from '../src/index.js';

/**
 * Public API snapshot (core-ts PRD AC).
 *
 * A deliberate lock: adding an export is a contract change that every
 * consumer (longstone, hisaishi, longstone-ui, the Solidity harness) inherits.
 * The snapshot makes that visible in review instead of showing up as a
 * surprise at a consumer's build.
 *
 * To change it: update the list below in the same commit as the export, and
 * say why in the journal.
 */
const EXPECTED_EXPORTS = [
  // canon
  'canonicalBytes',
  'canonicalString',
  'contentHash',
  'isWellFormedUtf16',
  'parseMemoryContent',
  // cid
  'base32Decode',
  'base32Encode',
  'cidDigest',
  'cidV1Raw',
  'cidV1RawFromDigest',
  'cidV1RawToDigest',
  // commitment
  'COMMITMENT_TYPES',
  'ZERO_BYTES32',
  'assertAddress',
  'assertBytes32',
  'commitmentDigest',
  'commitmentHash',
  'isZeroBytes32',
  // tags
  'bytes32ToTag',
  'tagToBytes32',
  'tagsToBytes32List',
  // vectors (pure) + abi
  'parseVectors',
  'memoryRegistryAbi',
  // errors
  'InvalidHexError',
  'MenhirCoreError',
  'NonNormalizedInputError',
  'SchemaViolationError',
  'TagTooLongError',
  'UnknownKeyError',
].sort();

describe('public API surface', () => {
  it('matches the pinned snapshot', () => {
    expect(Object.keys(core).sort()).toEqual(EXPECTED_EXPORTS);
  });

  it('exports no value named like a Node builtin leak', () => {
    for (const name of Object.keys(core)) {
      expect(name.startsWith('node:')).toBe(false);
    }
  });

  it('error classes share a code discriminant', () => {
    const errors = [
      new core.NonNormalizedInputError(),
      new core.UnknownKeyError('k'),
      new core.SchemaViolationError('x'),
      new core.TagTooLongError('t', 33),
      new core.InvalidHexError('x'),
    ] as const;
    for (const error of errors) {
      expect(error).toBeInstanceOf(core.MenhirCoreError);
      expect(typeof error.code).toBe('string');
    }
    expect(new Set(errors.map((e) => e.code)).size).toBe(errors.length);
  });
});
