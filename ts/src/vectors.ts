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
 * bundle; loading the files from disk lives in `@menhir/core/vectors`
 * (`src/vectors-node.ts`), the package's only Node-only entry point.
 *
 * `blockHeight` is stored as a decimal string in the artifacts (JSON has no
 * bigint) and restored here.
 */
export function parseVectors(contentsJson: string, commitmentsJson: string): Vectors {
  const contents = JSON.parse(contentsJson) as ContentVector[];
  const rawCommitments = JSON.parse(commitmentsJson) as Array<{
    commitment: Record<string, unknown>;
    commitmentHash: `0x${string}`;
  }>;

  const commitments: CommitmentVector[] = rawCommitments.map((entry) => ({
    commitmentHash: entry.commitmentHash,
    commitment: {
      ...(entry.commitment as unknown as Commitment),
      blockHeight: BigInt(entry.commitment.blockHeight as string),
      op: Number(entry.commitment.op) as 0 | 1,
    },
  }));

  return { contents, commitments };
}
