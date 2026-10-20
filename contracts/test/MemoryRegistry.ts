import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import {
  commitmentHash as tsCommitmentHash,
  type Commitment,
} from "@limccn/menhir-core";
import { loadVectors } from "@limccn/menhir-core/vectors";
import { getAddress, type Hex } from "viem";

const ZERO32 = `0x${"0".repeat(64)}` as Hex;

/** Deterministic 32-byte value from a small integer (no randomness in tests). */
function b32(n: number): Hex {
  return `0x${n.toString(16).padStart(64, "0")}` as Hex;
}

describe("MemoryRegistry", async function () {
  const { viem, networkHelpers } = await network.create();
  const publicClient = await viem.getPublicClient();
  const wallets = await viem.getWalletClients();
  // wallets[0] is the default sender used by deployContract/write calls —
  // make it the owner so owner-signed writes need no explicit account.
  // Addresses are checksummed for event/struct comparisons (viem's wallet
  // clients expose lowercase hex; reads return checksummed).
  const [ownerWallet, agentWallet, otherWallet] = wallets;
  const owner = getAddress(ownerWallet.account.address);
  const agent = getAddress(agentWallet.account.address);
  const other = getAddress(otherWallet.account.address);

  // Hardhat EDR gives each wallet a private key; accounts[0] deploys.
  async function deploy() {
    return viem.deployContract("MemoryRegistry");
  }

  async function currentBlock(): Promise<bigint> {
    return publicClient.getBlockNumber();
  }

  async function makeCommitment(
    overrides: Partial<Commitment> = {},
  ): Promise<Commitment> {
    const blockHeight = await currentBlock();
    return {
      owner: getAddress(owner),
      contentHash: b32(1),
      cidDigest: b32(2),
      signer: getAddress(owner),
      blockHeight,
      op: 0,
      prev: ZERO32,
      ...overrides,
    };
  }

  /** Solidity-side hash for the same struct (authoritative cross-check). */
  async function solidityHash(
    registry: Awaited<ReturnType<typeof deploy>>,
    c: Commitment,
  ): Promise<Hex> {
    return registry.read.commitmentHash([
      {
        owner: c.owner,
        contentHash: c.contentHash,
        cidDigest: c.cidDigest,
        signer: c.signer,
        blockHeight: c.blockHeight,
        op: c.op,
        prev: c.prev,
      },
    ]);
  }

  describe("commit", async function () {
    it("stores the commitment and emits MemoryCommitted", async function () {
      const registry = await deploy();
      const c = await makeCommitment();
      const h = tsCommitmentHash(c);

      await viem.assertions.emitWithArgs(
        registry.write.commit([c as never, [b32(100)]]),
        registry,
        "MemoryCommitted",
        [c.owner, c.contentHash, h, c as never, [b32(100)]],
      );

      const stored = await registry.read.getCommitment([h]);
      assert.equal(stored.owner.toLowerCase(), c.owner.toLowerCase());
      assert.equal(stored.contentHash, c.contentHash);
      assert.equal(stored.cidDigest, c.cidDigest);
      assert.equal(stored.signer.toLowerCase(), c.signer.toLowerCase());
      assert.equal(stored.blockHeight, c.blockHeight);
      assert.equal(stored.op, 0);
      assert.equal(stored.prev, c.prev);

      assert.equal(await registry.read.isDeep([h]), true);
      assert.equal(await registry.read.isActive([h]), true);
      assert.equal(await registry.read.isRetracted([h]), false);
    });

    it("TS commitmentHash == Solidity commitmentHash for the SHARED 100-struct corpus", async function () {
      // The corpus is the committed artifact from @limccn/menhir-core, not a loop
      // built here. A local loop proves only that two functions in this
      // process agree; the artifact is what migrates between repos and what
      // the golden values were frozen against. Gate G2 depends on this
      // distinction (core-ts PRD: "the golden corpus becomes the shared
      // contract").
      const registry = await deploy();
      const { commitments } = loadVectors();
      assert.equal(commitments.length, 100, "corpus must contain exactly 100 structs");

      for (const [index, vector] of commitments.entries()) {
        const c = vector.commitment;
        assert.equal(
          tsCommitmentHash(c),
          vector.commitmentHash,
          `TS hash drifted from the golden value at index ${index}`,
        );
        assert.equal(
          vector.commitmentHash,
          await solidityHash(registry, c),
          `Solidity hash != golden value at index ${index}`,
        );
      }
    });

    it("rejects op != 0 with InvalidOp", async function () {
      const registry = await deploy();
      const c = await makeCommitment({ op: 1 });
      await viem.assertions.revertWithCustomError(
        registry.write.commit([c as never, []]),
        registry,
        "InvalidOp",
      );
    });

    it("rejects zero owner/contentHash/cidDigest with InvalidCommitment", async function () {
      const registry = await deploy();
      const cases: Partial<Commitment>[] = [
        { owner: "0x0000000000000000000000000000000000000000" },
        { contentHash: ZERO32 },
        { cidDigest: ZERO32 },
      ];
      for (const overrides of cases) {
        const c = await makeCommitment(overrides);
        await viem.assertions.revertWithCustomError(
          registry.write.commit([c as never, []]),
          registry,
          "InvalidCommitment",
        );
      }
    });

    it("rejects signer != msg.sender with SignerMismatch", async function () {
      const registry = await deploy();
      const c = await makeCommitment({ signer: agent });
      await viem.assertions.revertWithCustomError(
        registry.write.commit([c as never, []]),
        registry,
        "SignerMismatch",
      );
    });

    it("rejects far-future blockHeight with FutureBlockHeight", async function () {
      const registry = await deploy();
      const c = await makeCommitment({
        blockHeight: (await currentBlock()) + 100n,
      });
      await viem.assertions.revertWithCustomError(
        registry.write.commit([c as never, []]),
        registry,
        "FutureBlockHeight",
      );
    });

    it("rejects unauthorized signer with NotAuthorized", async function () {
      const registry = await deploy();
      // signer honesty passes (msg.sender == signer), but the signer holds no
      // ROLE_COMMIT under the owner's namespace.
      const c = await makeCommitment({
        signer: getAddress(other),
      });
      await viem.assertions.revertWithCustomError(
        registry.write.commit([c as never, []], { account: otherWallet.account }),
        registry,
        "NotAuthorized",
      );
    });

    it("rejects unknown prev with PredecessorUnknown", async function () {
      const registry = await deploy();
      const c = await makeCommitment({ prev: b32(999) });
      await viem.assertions.revertWithCustomError(
        registry.write.commit([c as never, []]),
        registry,
        "PredecessorUnknown",
      );
    });

    it("rejects duplicate commitment with DuplicateCommitment", async function () {
      const registry = await deploy();
      const c = await makeCommitment();
      await registry.write.commit([c as never, []]);
      await viem.assertions.revertWithCustomError(
        registry.write.commit([c as never, []]),
        registry,
        "DuplicateCommitment",
      );
    });
  });

  describe("commitBatch", async function () {
    it("stores every item and emits one event per item", async function () {
      const registry = await deploy();
      const blockHeight = await currentBlock();
      const cs: Commitment[] = [1, 2, 3, 4, 5].map((i) => ({
        owner: owner,
        contentHash: b32(500 + i),
        cidDigest: b32(600 + i),
        signer: owner,
        blockHeight,
        op: 0 as const,
        prev: ZERO32,
      }));
      const tagLists = cs.map((_, i) => [b32(700 + i)]);

      await registry.write.commitBatch([cs as never, tagLists]);

      for (const c of cs) {
        const h = tsCommitmentHash(c);
        assert.equal(await registry.read.isActive([h]), true);
      }
    });

    it("rejects empty batch", async function () {
      const registry = await deploy();
      await viem.assertions.revertWithCustomError(
        registry.write.commitBatch([[], []]),
        registry,
        "TooManyCommitments",
      );
    });

    it("rejects batch larger than 64", async function () {
      const registry = await deploy();
      const blockHeight = await currentBlock();
      const cs: Commitment[] = Array.from({ length: 65 }, (_, i) => ({
        owner: owner,
        contentHash: b32(9000 + i),
        cidDigest: b32(10000 + i),
        signer: owner,
        blockHeight,
        op: 0 as const,
        prev: ZERO32,
      }));
      const tagLists = cs.map(() => [] as Hex[]);
      await viem.assertions.revertWithCustomError(
        registry.write.commitBatch([cs as never, tagLists]),
        registry,
        "TooManyCommitments",
      );
    });

    it("accepts exactly 64 items (EIP-7825 headroom boundary)", async function () {
      const registry = await deploy();
      const blockHeight = await currentBlock();
      const cs: Commitment[] = Array.from({ length: 64 }, (_, i) => ({
        owner: owner,
        contentHash: b32(11000 + i),
        cidDigest: b32(12000 + i),
        signer: owner,
        blockHeight,
        op: 0 as const,
        prev: ZERO32,
      }));
      const tagLists = cs.map(() => [] as Hex[]);
      await registry.write.commitBatch([cs as never, tagLists]);
      assert.equal(await registry.read.isActive([tsCommitmentHash(cs[63]!)]), true);
    });

    it("rejects tagLists length mismatch", async function () {
      const registry = await deploy();
      const c = await makeCommitment();
      await viem.assertions.revertWithCustomError(
        registry.write.commitBatch([[c as never], []]),
        registry,
        "ArrayLengthMismatch",
      );
    });
  });

  describe("retract", async function () {
    it("marks retracted and emits MemoryRetracted (pure delete)", async function () {
      const registry = await deploy();
      const c = await makeCommitment();
      const h = tsCommitmentHash(c);
      await registry.write.commit([c as never, []]);

      await viem.assertions.emitWithArgs(
        registry.write.retract([h, ZERO32]),
        registry,
        "MemoryRetracted",
        [h, owner, ZERO32],
      );

      assert.equal(await registry.read.isRetracted([h]), true);
      assert.equal(await registry.read.isActive([h]), false);
      assert.equal(await registry.read.isDeep([h]), true); // deep survives retract
      assert.equal(await registry.read.replacedByOf([h]), ZERO32);

      // stored struct is untouched
      const stored = await registry.read.getCommitment([h]);
      assert.equal(stored.contentHash, c.contentHash);
    });

    it("records replacedBy when given an existing successor", async function () {
      const registry = await deploy();
      const c1 = await makeCommitment({ contentHash: b32(20001) });
      const c2 = await makeCommitment({ contentHash: b32(20002) });
      const h1 = tsCommitmentHash(c1);
      const h2 = tsCommitmentHash(c2);
      await registry.write.commit([c1 as never, []]);
      await registry.write.commit([c2 as never, []]);

      await registry.write.retract([h1, h2]);
      const [retracted, replacedBy] = await registry.read.retractionOf([h1]);
      assert.equal(retracted, true);
      assert.equal(replacedBy, h2);
    });

    it("is idempotent: second retract is a silent no-op", async function () {
      const registry = await deploy();
      const c = await makeCommitment();
      const h = tsCommitmentHash(c);
      await registry.write.commit([c as never, []]);
      await registry.write.retract([h, ZERO32]);

      // Second call must not revert and must not emit.
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: await registry.write.retract([h, ZERO32]),
      });
      assert.equal(receipt.logs.length, 0);
      assert.equal(await registry.read.isRetracted([h]), true);
    });

    it("rejects unknown commitment", async function () {
      const registry = await deploy();
      await viem.assertions.revertWithCustomError(
        registry.write.retract([b32(424242), ZERO32]),
        registry,
        "UnknownCommitment",
      );
    });

    it("rejects unknown replacedBy", async function () {
      const registry = await deploy();
      const c = await makeCommitment();
      const h = tsCommitmentHash(c);
      await registry.write.commit([c as never, []]);
      await viem.assertions.revertWithCustomError(
        registry.write.retract([h, b32(555555)]),
        registry,
        "PredecessorUnknown",
      );
    });

    it("only owner or ROLE_RETRACT can retract", async function () {
      const registry = await deploy();
      const c = await makeCommitment();
      const h = tsCommitmentHash(c);
      await registry.write.commit([c as never, []]);

      await viem.assertions.revertWithCustomError(
        registry.write.retract([h, ZERO32], { account: otherWallet.account }),
        registry,
        "NotAuthorized",
      );
    });
  });

  describe("ACL", async function () {
    it("owner can grant ROLE_COMMIT to an agent and the agent can commit", async function () {
      const registry = await deploy();
      await registry.write.setSigner([agent, 1n]);

      const c = await makeCommitment({
        signer: agent,
        contentHash: b32(30001),
      });
      await registry.write.commit([c as never, []], { account: agentWallet.account });

      const h = tsCommitmentHash(c);
      assert.equal(await registry.read.isActive([h]), true);
      assert.equal(
        await registry.read.rolesOf([owner, agent]),
        1n,
      );
    });

    it("commit-only role cannot retract", async function () {
      const registry = await deploy();
      await registry.write.setSigner([agent, 1n]);
      const c = await makeCommitment({
        signer: agent,
        contentHash: b32(30002),
      });
      await registry.write.commit([c as never, []], { account: agentWallet.account });
      const h = tsCommitmentHash(c);

      await viem.assertions.revertWithCustomError(
        registry.write.retract([h, ZERO32], { account: agentWallet.account }),
        registry,
        "NotAuthorized",
      );
    });

    it("retract-only role can retract but not commit", async function () {
      const registry = await deploy();
      const c = await makeCommitment({ contentHash: b32(30003) });
      const h = tsCommitmentHash(c);
      await registry.write.commit([c as never, []]);

      await registry.write.setSigner([agent, 2n]);
      await registry.write.retract([h, ZERO32], { account: agentWallet.account });
      assert.equal(await registry.read.isRetracted([h]), true);

      const c2 = await makeCommitment({
        signer: agent,
        contentHash: b32(30004),
      });
      await viem.assertions.revertWithCustomError(
        registry.write.commit([c2 as never, []], { account: agentWallet.account }),
        registry,
        "NotAuthorized",
      );
    });

    it("both roles allow commit and retract", async function () {
      const registry = await deploy();
      await registry.write.setSigner([agent, 3n]);
      const c = await makeCommitment({
        signer: agent,
        contentHash: b32(30005),
      });
      const h = tsCommitmentHash(c);
      await registry.write.commit([c as never, []], { account: agentWallet.account });
      await registry.write.retract([h, ZERO32], { account: agentWallet.account });
      assert.equal(await registry.read.isRetracted([h]), true);
    });

    it("revocation (roles = 0) blocks further writes", async function () {
      const registry = await deploy();
      await registry.write.setSigner([agent, 3n]);
      await registry.write.setSigner([agent, 0n]);

      const c = await makeCommitment({
        signer: agent,
        contentHash: b32(30006),
      });
      await viem.assertions.revertWithCustomError(
        registry.write.commit([c as never, []], { account: agentWallet.account }),
        registry,
        "NotAuthorized",
      );
    });

    it("emits SignerUpdated with the new role mask", async function () {
      const registry = await deploy();
      await viem.assertions.emitWithArgs(
        registry.write.setSigner([agent, 3n]),
        registry,
        "SignerUpdated",
        [owner, agent, 3n],
      );
    });

    it("rejects zero signer and out-of-mask roles", async function () {
      const registry = await deploy();
      await viem.assertions.revertWithCustomError(
        registry.write.setSigner([
          "0x0000000000000000000000000000000000000000",
          1n,
        ]),
        registry,
        "ZeroAddress",
      );
      await viem.assertions.revertWithCustomError(
        registry.write.setSigner([agent, 4n]),
        registry,
        "InvalidRoles",
      );
    });

    it("non-owner cannot grant roles on another owner's account", async function () {
      const registry = await deploy();
      // other grants themselves a role over owner — this creates an entry on
      // their own ACL namespace only, never affecting owner's commitments.
      await registry.write.setSigner([other, 3n], {
        account: otherWallet.account,
      });
      assert.equal(
        await registry.read.rolesOf([owner, other]),
        0n,
      );

      const c = await makeCommitment({
        signer: other,
        contentHash: b32(30007),
      });
      await viem.assertions.revertWithCustomError(
        registry.write.commit([c as never, []], { account: otherWallet.account }),
        registry,
        "NotAuthorized",
      );
    });
  });

  describe("invariants", async function () {
    it("event count == stored count; retracted never becomes active again", async function () {
      const registry = await deploy();
      const from = await currentBlock();
      const blockHeight = from;

      const cs: Commitment[] = [];
      for (let i = 0; i < 8; i += 1) {
        cs.push({
          owner: owner,
          contentHash: b32(40000 + i),
          cidDigest: b32(41000 + i),
          signer: owner,
          blockHeight,
          op: 0,
          prev: i === 0 ? ZERO32 : tsCommitmentHash(cs[i - 1]!),
        });
      }

      for (const c of cs) await registry.write.commit([c as never, []]);

      const events = await publicClient.getContractEvents({
        address: registry.address,
        abi: registry.abi,
        eventName: "MemoryCommitted",
        fromBlock: from,
      });
      assert.equal(events.length, cs.length);

      // retract the middle ones and re-read
      for (const c of [cs[2]!, cs[4]!, cs[6]!]) {
        await registry.write.retract([tsCommitmentHash(c), ZERO32]);
      }
      for (let i = 0; i < cs.length; i += 1) {
        const h = tsCommitmentHash(cs[i]!);
        const expectedActive = i !== 2 && i !== 4 && i !== 6;
        assert.equal(await registry.read.isActive([h]), expectedActive);
        assert.equal(await registry.read.isDeep([h]), true);
      }
    });

    it("prev-chain version linking is queryable via getCommitment", async function () {
      const registry = await deploy();
      const blockHeight = await currentBlock();
      const v1: Commitment = {
        owner: owner,
        contentHash: b32(50001),
        cidDigest: b32(50002),
        signer: owner,
        blockHeight,
        op: 0,
        prev: ZERO32,
      };
      const h1 = tsCommitmentHash(v1);
      const v2: Commitment = { ...v1, contentHash: b32(50003), prev: h1 };
      const h2 = tsCommitmentHash(v2);

      await registry.write.commit([v1 as never, []]);
      await registry.write.commit([v2 as never, []]);

      assert.equal((await registry.read.getCommitment([h2])).prev, h1);
      assert.equal((await registry.read.getCommitment([h1])).prev, ZERO32);
    });
  });

  describe("EIP-712", async function () {
    it("exposes a stable domain separator", async function () {
      const registry = await deploy();
      const ds1 = await registry.read.DOMAIN_SEPARATOR();
      const ds2 = await registry.read.DOMAIN_SEPARATOR();
      assert.equal(ds1, ds2);
      assert.notEqual(ds1, ZERO32);
    });

    it("commitmentDigest differs from commitmentHash (typed-data vs abi.encode)", async function () {
      const registry = await deploy();
      const c = await makeCommitment();
      const digest = await registry.read.commitmentDigest([c as never]);
      const hash = tsCommitmentHash(c);
      assert.notEqual(digest, hash);
    });
  });
});
