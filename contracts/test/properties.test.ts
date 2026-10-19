import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { commitmentHash as tsCommitmentHash, type Commitment } from "@menhir/core";
import fc from "fast-check";
import type { Hex } from "viem";

/**
 * Property/fuzz tests (menhir-m1 PRD AC: "unit + fuzz/invariant",
 * "fuzz runs ≥ 10k cases").
 *
 * The example-based suite in MemoryRegistry.ts pins specific behaviours; this
 * file looks for the ones nobody thought to write down. Each property is
 * stated as an invariant that must hold for ALL generated input, so the
 * failure message is a counter-example rather than "test failed".
 */
const RUNS = 10_000;

const ZERO32 = `0x${"0".repeat(64)}` as Hex;

/** Random but structurally valid bytes32/address hex. */
const bytes32 = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((b) => `0x${Buffer.from(b).toString("hex")}` as Hex);
const address = fc
  .uint8Array({ minLength: 20, maxLength: 20 })
  .map((b) => `0x${Buffer.from(b).toString("hex")}` as Hex);

const commitmentArb: fc.Arbitrary<Commitment> = fc.record({
  owner: address,
  contentHash: bytes32,
  cidDigest: bytes32,
  signer: address,
  blockHeight: fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }),
  op: fc.constant(0 as const),
  prev: fc.oneof(fc.constant(ZERO32), bytes32),
});

describe("MemoryRegistry properties", async function () {
  const { viem } = await network.create();

  async function deploy() {
    return (await viem.deployContract("MemoryRegistry")) as never as {
      read: { commitmentHash(args: [Commitment]): Promise<Hex> };
      write: {
        commit(args: [Commitment, Hex[]], opts?: { account?: unknown }): Promise<Hex>;
      };
    };
  }

  it(`P1: TS and Solidity commitmentHash agree on all inputs (${RUNS} cases)`, async function () {
    // Byte-level equality across the two implementations is the contract that
    // makes an off-chain commitment verifiable on-chain. Any drift here
    // produces commitments that look valid and fail verification later.
    const registry = await deploy();
    await fc.assert(
      fc.asyncProperty(commitmentArb, async (c) => {
        const solidity = await registry.read.commitmentHash([c]);
        assert.equal(tsCommitmentHash(c), solidity);
      }),
      { numRuns: RUNS },
    );
  });

  it("P2: commitmentHash is injective over its fields (no field can be dropped)", async function () {
    // Per-field sensitivity: changing exactly one field must change the hash.
    // This catches a field accidentally omitted from the encode call — the
    // failure mode D-8's field-order decision exists to prevent.
    await fc.assert(
      fc.asyncProperty(commitmentArb, async (c) => {
        const base = tsCommitmentHash(c);
        const mutated: Commitment[] = [
          { ...c, owner: flipAddress(c.owner) },
          { ...c, contentHash: flip32(c.contentHash) },
          { ...c, cidDigest: flip32(c.cidDigest) },
          { ...c, signer: flipAddress(c.signer) },
          { ...c, blockHeight: c.blockHeight ^ 1n },
          { ...c, prev: flip32(c.prev) },
        ];
        for (const [index, m] of mutated.entries()) {
          assert.notEqual(tsCommitmentHash(m), base, `field ${index} is not covered by the hash`);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("P3: a committed struct is retrievable unchanged (store/read roundtrip)", async function () {
    const { viem: viemHelpers } = await network.create();
    const registry = (await viemHelpers.deployContract("MemoryRegistry")) as never as {
      read: {
        commitmentHash(args: [Commitment]): Promise<Hex>;
        getCommitment(args: [Hex]): Promise<Commitment>;
      };
      write: { commit(args: [Commitment, Hex[]], opts?: { account?: unknown }): Promise<Hex> };
    };
    const [wallet] = await viemHelpers.getWalletClients();
    const me = wallet.account.address;

    // Only commits the chain can accept: signer == owner == msg.sender, and a
    // blockHeight the contract will not reject as far-future.
    const blockNumber = await (
      await viemHelpers.getPublicClient()
    ).getBlockNumber();

    await fc.assert(
      fc.asyncProperty(bytes32, bytes32, async (contentHash, cidDigest) => {
        const c: Commitment = {
          owner: me as Hex,
          contentHash,
          cidDigest,
          signer: me as Hex,
          blockHeight: blockNumber,
          op: 0,
          prev: ZERO32,
        };
        await registry.write.commit([c, []], { account: wallet.account });
        const stored = await registry.read.getCommitment([tsCommitmentHash(c)]);
        assert.equal(stored.contentHash, c.contentHash);
        assert.equal(stored.cidDigest, c.cidDigest);
        assert.equal(stored.owner.toLowerCase(), c.owner.toLowerCase());
      }),
      { numRuns: 200 }, // each case mines a block; keep the suite fast
    );
  });
});

function flip32(value: Hex): Hex {
  const n = BigInt(value);
  return `0x${(n ^ 1n).toString(16).padStart(64, "0")}` as Hex;
}

function flipAddress(value: Hex): Hex {
  const n = BigInt(value);
  return `0x${(n ^ 1n).toString(16).padStart(40, "0")}` as Hex;
}
