/**
 * Deterministic golden-corpus generator (core-ts implement.md Phase E).
 *
 * Run: `pnpm --dir menhir/ts generate:vectors`
 *
 * Rerunning MUST produce byte-identical files (CI asserts via `git diff
 * --exit-code`). That determinism is the point: the corpus is a cross-
 * implementation contract consumed by the Solidity test, so a change in the
 * artifacts must be an explicit, reviewable event — never a side effect of
 * running the generator on a different day or machine.
 *
 * No randomness at all here, deliberately: a seeded PRNG would still depend
 * on the PRNG implementation. Every entry below is a literal.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalString, contentHash, parseMemoryContent } from '../src/canon.js';
import { cidDigest, cidV1Raw } from '../src/cid.js';
import { commitmentHash, type Commitment } from '../src/commitment.js';
import type { ContentVector, CommitmentVector } from '../src/vectors.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'vectors');

// ---------------------------------------------------------------------------
// Content corpus
// ---------------------------------------------------------------------------

/**
 * Raw inputs. Kept as `unknown` so every vector also exercises
 * `parseMemoryContent` on the way in — a schema regression breaks the corpus
 * regeneration rather than silently producing a different hash.
 */
const CONTENT_INPUTS: unknown[] = [
  // --- RFC 8785 §3.2.2 "Sample JSON data" (the appendix example) ------------
  // The whole appendix object does not fit MemoryContent's top-level schema,
  // so its scalar/array/number behaviours are exercised through `meta`.
  {
    text: 'rfc8785 sample data',
    format: 'text.v0',
    meta: {
      numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 1e-27],
      string: '€$\u000F\u000A\u0009"\\\u0000\u0008\u000C\u000D',
      literals: [null, true, false],
    },
  },
  { text: 'empty meta object', format: 'text.v0', meta: {} },
  { text: 'minimal', format: 'text.v0' },

  // --- CJK / emoji (user content is Chinese-heavy) ---------------------------
  { text: '用户偏好：Python 用于脚本，TypeScript 用于库。', format: 'text.v0' },
  { text: '带引号"内容"与反斜杠\\以及换行\n第二行', format: 'text.v0' },
  { text: 'emoji 🙂👨‍👩‍👧‍👦🏳️‍🌈', format: 'text.v0', meta: { emoji: '🔐🧠' } },
  { text: '中文标签', format: 'text.v0', refs: ['layer:semantic', 'topic:记忆'] },

  // --- JCS number edge cases -------------------------------------------------
  { text: 'numbers', format: 'text.v0', meta: { neg: -0, exp: 1e21, small: 5e-324 } },
  { text: 'integers', format: 'text.v0', meta: { a: 0, b: -1, c: 9007199254740991 } },

  // --- Structure -------------------------------------------------------------
  { text: 'deep meta', format: 'text.v0', meta: { a: { b: { c: { d: { e: 1 } } } } } },
  { text: 'array meta', format: 'text.v0', meta: { list: [1, 'two', false, null, []] } },
  { text: 'empty refs', format: 'text.v0', refs: [] },
  { text: 'refs', format: 'text.v0', refs: ['bafkreicc7pjshatzqedd2y5htx7vsec5i53em72htdj6acxo64ihg2h5wa', '0x' + 'ab'.repeat(32)] },
  { text: 'key order matters', format: 'text.v0', meta: { z: 1, a: 2, m: 3 } },
  { text: 'unicode escapes', format: 'text.v0', meta: { s: '\u0001\u001f\u007f' } },
];

// A few hundred more entries so the corpus is non-trivial without being
// unreadable: deterministic combinations, not random values.
for (let i = 0; i < 40; i += 1) {
  CONTENT_INPUTS.push({
    text: `cjk-${i}-记忆条目-${i % 7}`,
    format: 'text.v0',
    meta: { index: i, bucket: i % 5, nested: { even: i % 2 === 0, minus: -i } },
    ...(i % 3 === 0 ? { refs: [`ref-${i}`] } : {}),
  });
}

const contents: ContentVector[] = CONTENT_INPUTS.map((raw) => {
  const content = parseMemoryContent(raw);
  const canonical = canonicalString(content);
  const bytes = new TextEncoder().encode(canonical);
  return {
    content,
    canonical,
    contentHash: contentHash(content),
    cidDigest: cidDigest(bytes),
    cidV1Raw: cidV1Raw(bytes),
  };
});

// ---------------------------------------------------------------------------
// Commitment corpus — exactly 100 structs
// ---------------------------------------------------------------------------

const ADDR = (n: number): `0x${string}` =>
  `0x${n.toString(16).padStart(40, '0')}` as `0x${string}`;
const B32 = (n: number): `0x${string}` =>
  `0x${n.toString(16).padStart(64, '0')}` as `0x${string}`;
const ZERO32 = `0x${'0'.repeat(64)}` as `0x${string}`;

const commitments: CommitmentVector[] = [];
for (let i = 0; i < 100; i += 1) {
  const commitment: Commitment = {
    owner: ADDR(0x1000 + (i % 10)),
    contentHash: B32(0x2000 + i),
    cidDigest: B32(0x4000 + i),
    signer: ADDR(0x1000 + (i % 10)),
    blockHeight: BigInt(48_300_000 + i),
    op: 0,
    // Chains: every 4th entry is a root, the rest link to the previous entry.
    prev: i % 4 === 0 ? ZERO32 : B32(0x2000 + i - 1),
  };
  commitments.push({ commitment, commitmentHash: commitmentHash(commitment) });
}

// ---------------------------------------------------------------------------
// Serialize (stable field order, bigint as decimal string)
// ---------------------------------------------------------------------------

function serializeCommitment(v: CommitmentVector): string {
  const c = v.commitment;
  return JSON.stringify({
    commitment: {
      owner: c.owner,
      contentHash: c.contentHash,
      cidDigest: c.cidDigest,
      signer: c.signer,
      blockHeight: c.blockHeight.toString(),
      op: c.op,
      prev: c.prev,
    },
    commitmentHash: v.commitmentHash,
  });
}

writeFileSync(
  join(outDir, 'contents.json'),
  `${JSON.stringify(
    contents.map((v) => ({
      content: v.content,
      canonical: v.canonical,
      contentHash: v.contentHash,
      cidDigest: v.cidDigest,
      cidV1Raw: v.cidV1Raw,
    })),
    null,
    2,
  )}\n`,
);

writeFileSync(
  join(outDir, 'commitments.json'),
  `[\n${commitments.map((v) => `  ${serializeCommitment(v)}`).join(',\n')}\n]\n`,
);

console.log(`wrote ${contents.length} content vectors, ${commitments.length} commitment vectors`);
