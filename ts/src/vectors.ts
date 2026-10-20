import type { Commitment } from './commitment.js';
import type { MemoryContent } from './canon.js';

export interface CommitmentVector {
  commitment: Commitment;
  commitmentHash: `0x${string}`;
}

export interface ContentVector {
  content: MemoryContent;
  canonical: string;
  contentHash: `0x${string}`;
  cidDigest: `0x${string}`;
  cidV1Raw: string;
}

export interface Vectors {
  contents: ContentVector[];
  commitments: CommitmentVector[];
}

/**
 * Parse the committed golden corpus from already-read text.
 *
 * Pure — no filesystem access. This module is therefore safe for the browser
 * bundle; loading the files from disk lives in `@limccn/menhir-core/vectors`
 * (`src/vectors-node.ts`), the package's only Node-only entry point.
 *
 * `blockHeight` is stored as a decimal string in the artifacts (JSON has no
 * bigint) and restored here.
 */
function fail(message: string): never {
  // Artifacts are internal, so a bare Error is right here: these are not
  // caller-input failures needing a typed code, they mean the committed corpus
  // itself is malformed.
  throw new Error(`invalid vector artifact: ${message}`);
}

function parseContentVector(entry: unknown, index: number): ContentVector {
  if (typeof entry !== 'object' || entry === null) fail(`contents[${index}] is not an object`);
  const v = entry as Record<string, unknown>;
  for (const field of ['canonical', 'contentHash', 'cidDigest', 'cidV1Raw'] as const) {
    if (typeof v[field] !== 'string') fail(`contents[${index}].${field} must be a string`);
  }
  if (typeof v.content !== 'object' || v.content === null) {
    fail(`contents[${index}].content must be an object`);
  }
  return entry as ContentVector;
}

function parseCommitmentVector(entry: unknown, index: number): CommitmentVector {
  if (typeof entry !== 'object' || entry === null) fail(`commitments[${index}] is not an object`);
  const v = entry as Record<string, unknown>;
  if (typeof v.commitmentHash !== 'string') {
    fail(`commitments[${index}].commitmentHash must be a string`);
  }
  if (typeof v.commitment !== 'object' || v.commitment === null) {
    fail(`commitments[${index}].commitment must be an object`);
  }
  const c = v.commitment as Record<string, unknown>;

  for (const field of ['owner', 'contentHash', 'cidDigest', 'signer', 'prev'] as const) {
    if (typeof c[field] !== 'string') fail(`commitments[${index}].${field} must be a string`);
  }
  // blockHeight is a decimal string on disk (JSON has no bigint). BigInt()
  // throws SyntaxError on garbage; convert that into a message naming the row.
  if (typeof c.blockHeight !== 'string') {
    fail(`commitments[${index}].blockHeight must be a decimal string`);
  }
  let blockHeight: bigint;
  try {
    blockHeight = BigInt(c.blockHeight);
  } catch {
    fail(`commitments[${index}].blockHeight is not a decimal integer: ${c.blockHeight}`);
  }
  if (blockHeight < 0n) fail(`commitments[${index}].blockHeight must be non-negative`);

  const op = c.op;
  if (op !== 0 && op !== 1) fail(`commitments[${index}].op must be 0 or 1, got ${String(op)}`);

  return {
    commitmentHash: v.commitmentHash as `0x${string}`,
    commitment: { ...(c as unknown as Commitment), blockHeight, op },
  };
}

export function parseVectors(contentsJson: string, commitmentsJson: string): Vectors {
  let rawContents: unknown;
  let rawCommitments: unknown;
  try {
    rawContents = JSON.parse(contentsJson);
    rawCommitments = JSON.parse(commitmentsJson);
  } catch (error) {
    fail(`not valid JSON: ${(error as Error).message}`);
  }

  if (!Array.isArray(rawContents)) fail('contents.json must be an array');
  if (!Array.isArray(rawCommitments)) fail('commitments.json must be an array');

  return {
    contents: rawContents.map(parseContentVector),
    commitments: rawCommitments.map(parseCommitmentVector),
  };
}
