import { network } from "hardhat";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  canonicalBytes,
  cidDigest,
  cidV1Raw,
  commitmentHash,
  contentHash,
  type Commitment,
  type MemoryContent,
} from "@menhir/core";
import type { Hex } from "viem";

import { scanLogs } from "./lib/scanLogs.js";

// Seeds a deployed registry with a small, coherent set of memories so the UI
// has real state to render. Everything here is derived with @menhir/core —
// the same code the browser runs — so a bug in the digest rules would show up
// as a mismatch rather than a plausible-looking fixture.
//
// Seeded state:
//   seed-1  active, tags [layer:deep, topic:seed]          -> verified
//   seed-2  active, tags [layer:semantic]                   -> version chain root
//   seed-3  active, prev = seed-2                           -> successor
//   seed-2  retracted, replacedBy = seed-3                  -> tombstone + link
//   ACL     agent granted ROLE_COMMIT                       -> may commit for owner
//
// Re-running against the same registry is safe. Note that commitmentHash
// covers `blockHeight`, so the hash changes with the block and cannot be used
// to detect a previous run. The stable key is `contentHash` (keccak256 of the
// canonical bytes): if this owner already anchored these bytes, the script
// finds that commitment by replaying MemoryCommitted logs and skips it.

const ZERO32 = `0x${"0".repeat(64)}` as Hex;

type Roles = { commit: bigint; retract: bigint };

interface Seeded {
  label: string;
  hash: Hex;
  cid: string;
  contentHash: Hex;
  cidDigest: Hex;
  canonical: string;
  tags: string[];
}

const connection = await network.create();
const { viem } = connection;
const networkName = connection.networkName;

const publicClient = await viem.getPublicClient();
const [ownerWallet, agentWallet] = await viem.getWalletClients();
if (ownerWallet === undefined) {
  throw new Error(
    `No wallet client on network "${networkName}". Seeding writes to chain, so it ` +
      "needs a funded signer: set DEPLOYER_PRIVATE_KEY, or run against the " +
      "local simulated network / a node with unlocked accounts.",
  );
}

const owner = ownerWallet.account.address;
const agent = agentWallet?.account.address;

const deploymentsDir = path.resolve("deployments");
const candidate = path.join(
  deploymentsDir,
  networkName === "baseSepolia" ? "base-sepolia.json" : `${networkName}.json`,
);

let registryAddress: Hex;
let deployBlock: bigint;
try {
  const record = JSON.parse(await readFile(candidate, "utf8")) as {
    address: Hex;
    chainId: number;
    blockNumber: string;
  };
  registryAddress = record.address;
  deployBlock = BigInt(record.blockNumber);
  const liveChainId = await publicClient.getChainId();
  if (record.chainId !== liveChainId) {
    throw new Error(
      `${candidate} records chainId ${record.chainId} but the network reports ${liveChainId}`,
    );
  }
} catch (error) {
  if (error instanceof Error && !error.message.includes("ENOENT")) throw error;
  throw new Error(
    `No deployment record at ${candidate}. Run deploy first:\n` +
      "  hardhat run scripts/deploy.ts --network <network>",
  );
}

// Refuse to seed an address with no code: a silent no-op here would look like
// "the UI is broken" much later.
const code = await publicClient.getCode({ address: registryAddress });
if (code === undefined || code === "0x") {
  throw new Error(`no contract deployed at ${registryAddress} on ${networkName}`);
}

const registry = await viem.getContractAt("MemoryRegistry", registryAddress);

console.log("Network:", networkName);
console.log("Registry:", registryAddress);
console.log("Owner:", owner);
console.log("Agent:", agent ?? "(none — ACL step skipped)");

/** Content object → the bytes, digests, and CID the UI will recompute. */
function build(text: string, tags: string[]) {
  const content: MemoryContent = { text, format: "text.v0" };
  const bytes = canonicalBytes(content);
  return {
    canonical: new TextDecoder().decode(bytes),
    contentHash: contentHash(content),
    cidDigest: cidDigest(bytes),
    cid: cidV1Raw(bytes),
    tags,
  };
}

const committed: Seeded[] = [];

/**
 * Existing commitments by (owner, contentHash). Replaying MemoryCommitted is
 * the only way to answer "did I already anchor these exact bytes?" — the
 * contract stores by commitmentHash, and that hash covers blockHeight.
 *
 * Starts at the deployment block, not 0: Base Sepolia is past 48M blocks and
 * a from-genesis range is rejected outright by public RPCs. The scan itself
 * adapts its window at runtime — public endpoints cap getLogs spans (Base
 * Sepolia's allows 200 blocks and rejects larger requests with an opaque HTTP
 * error), so this value is only the initial upper bound, not the real chunk.
 */
const SCAN_CHUNK = 10_000n;

async function existingByContentHash(): Promise<Map<string, Hex>> {
  const latest = await publicClient.getBlockNumber();

  const logs = await scanLogs({
    fromBlock: deployBlock,
    toBlock: latest,
    initialChunkSize: SCAN_CHUNK,
    fetchLogs: (fromBlock, toBlock) =>
      publicClient.getContractEvents({
        address: registryAddress,
        abi: registry.abi,
        eventName: "MemoryCommitted",
        args: { owner },
        fromBlock,
        toBlock,
      }),
  });

  const byContentHash = new Map<string, Hex>();
  for (const log of logs) {
    const args = log.args as {
      contentHash?: Hex;
      commitmentHash?: Hex;
    };
    if (args.contentHash !== undefined && args.commitmentHash !== undefined) {
      // Newest wins: a later version of the same bytes supersedes the older.
      byContentHash.set(args.contentHash.toLowerCase(), args.commitmentHash);
    }
  }

  return byContentHash;
}

const existing = await existingByContentHash();

async function commit(
  built: ReturnType<typeof build>,
  prev: Hex,
  label: string,
): Promise<Hex> {
  const prior = existing.get(built.contentHash.toLowerCase());
  if (prior !== undefined) {
    console.log(`  ${label}: already anchored as ${prior} — skipped`);
    committed.push({ label, hash: prior, ...built });
    return prior;
  }

  const c: Commitment = {
    owner,
    contentHash: built.contentHash,
    cidDigest: built.cidDigest,
    signer: owner,
    blockHeight: await publicClient.getBlockNumber(),
    op: 0,
    prev,
  };
  const h = commitmentHash(c);

  const tx = await registry.write.commit([
    c as never,
    built.tags.map(tagToBytes32),
  ]);
  await publicClient.waitForTransactionReceipt({ hash: tx });

  console.log(`  ${label}: ${h}`);
  committed.push({ label, hash: h, ...built });
  return h;
}

function tagToBytes32(tag: string): Hex {
  const bytes = new TextEncoder().encode(tag);
  if (bytes.length > 32) throw new Error(`tag too long: ${tag}`);
  return `0x${Buffer.from(bytes).toString("hex").padEnd(64, "0")}` as Hex;
}

console.log("Seeding commitments…");

const active = build("A memory anchored by the menhir seed script.", [
  "layer:deep",
  "topic:seed",
]);
const activeHash = await commit(active, ZERO32, "seed-1 (active)");

const root = build("The first version of a superseded memory.", [
  "layer:semantic",
]);
const rootHash = await commit(root, ZERO32, "seed-2 (version root)");

const successor = build("The successor version that replaces seed-2.", [
  "layer:semantic",
]);
const successorHash = await commit(successor, rootHash, "seed-3 (successor)");

// Retract the root, pointing at its successor. Idempotent on chain.
const rootRetracted = await registry.read.isRetracted([rootHash]);
if (!rootRetracted) {
  const tx = await registry.write.retract([rootHash, successorHash]);
  await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log(`  retracted seed-2 -> ${successorHash}`);
} else {
  console.log("  seed-2 already retracted — skipped");
}

// ACL: let the agent commit on the owner's behalf.
if (agent !== undefined) {
  const roles = (await registry.read.rolesOf([owner, agent])) as bigint;
  const wants = 1n; // ROLE_COMMIT
  if ((roles & wants) !== wants) {
    const tx = await registry.write.setSigner([agent, roles | wants]);
    await publicClient.waitForTransactionReceipt({ hash: tx });
    console.log(`  granted ROLE_COMMIT to ${agent}`);
  } else {
    console.log("  agent already holds ROLE_COMMIT — skipped");
  }
}

const summary = {
  network: networkName,
  chainId: await publicClient.getChainId(),
  registry: registryAddress,
  owner,
  ...(agent === undefined ? {} : { agent }),
  seeded: committed.map((s) => ({
    label: s.label,
    commitmentHash: s.hash,
    cid: s.cid,
    contentHash: s.contentHash,
    cidDigest: s.cidDigest,
    canonical: s.canonical,
    tags: s.tags,
    retracted: s.label === "seed-2 (version root)",
  })),
  seededAt: new Date().toISOString(),
};

const outDir = path.resolve("deployments");
const outFile = path.join(outDir, `seed-${networkName}.json`);
await mkdir(outDir, { recursive: true });
await writeFile(outFile, `${JSON.stringify(summary, null, 2)}\n`);

console.log("");
console.log("Seeded memories — paste a commitment hash into the UI's Verify view:");
for (const s of committed) {
  console.log(`  ${s.label.padEnd(22)} ${s.hash}`);
}
console.log("");
console.log("CID for gateway retrieval:");
for (const s of committed) console.log(`  ${s.label.padEnd(22)} ${s.cid}`);
console.log("");
console.log("saved:", outFile);
