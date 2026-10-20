/**
 * Explorer-independent verification (fallback when Blockscout/Sourcify are
 * rate-limited or unavailable).
 *
 * What it proves — and what it does not:
 *
 *   PROVES  the runtime bytecode deployed at <address> is byte-identical to
 *           the runtime this repo produces from the committed source, modulo
 *           immutable slots (which are filled at construction, not compile).
 *   PROVES  the creation input fetched from the deploy transaction matches the
 *           committed build artifact exactly (constructor args included).
 *   DOES NOT publish source to any explorer. A human or tool reading the
 *           explorer still sees "not verified"; only the bytecode equivalence
 *           is established here.
 *
 * This distinction matters: "unverified on the explorer" and "not reproducible"
 * are different claims, and it is the second one that would be alarming.
 *
 * Usage:
 *   pnpm --dir menhir/contracts verify:local [--network baseSepolia]
 */
import { readFileSync } from "node:fs";
import { network } from "hardhat";

const ZERO_PAD = (n: number) => `0x${"0".repeat(n)}`;

interface Artifact {
  bytecode: string;
  deployedBytecode: string;
  abi: readonly unknown[];
  immutableReferences?: Record<string, Array<{ length: number; start: number }>>;
}

function stripHex(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

/**
 * Blank every immutable slot in a runtime bytecode string.
 *
 * Immutables are written into the runtime code at deploy time (EIP-170 allows
 * this because they are not part of the code hash used for verification by
 * some toolchains). Comparing raw runtime bytes without masking them yields a
 * false mismatch for every contract using OZ's EIP712 caches.
 */
function maskImmutables(runtime: string, artifact: Artifact): string {
  const bytes = stripHex(runtime);
  const chars = bytes.split("");
  for (const refs of Object.values(artifact.immutableReferences ?? {})) {
    for (const ref of refs) {
      const start = ref.start * 2;
      const end = start + ref.length * 2;
      for (let i = start; i < end && i < chars.length; i += 1) chars[i] = "0";
    }
  }
  return chars.join("");
}

async function main() {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();

  const deployment = JSON.parse(
    readFileSync(new URL("../deployments/base-sepolia.json", import.meta.url), "utf8"),
  ) as { address: `0x${string}`; txHash: `0x${string}`; blockNumber: string; chainId: number };

  if (deployment.chainId !== chainId) {
    throw new Error(
      `deployment record is for chain ${deployment.chainId}, connected to ${chainId}`,
    );
  }

  const artifact = JSON.parse(
    readFileSync(
      new URL(
        "../artifacts/src/MemoryRegistry.sol/MemoryRegistry.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as Artifact;

  console.log(`registry   ${deployment.address}`);
  console.log(`chain      ${chainId}`);

  // 1. Runtime bytecode, immutables masked.
  const onchainRuntime = (await publicClient.getBytecode({ address: deployment.address })) ?? "0x";
  if (onchainRuntime === "0x") throw new Error("no code at the recorded address");

  const maskedChain = maskImmutables(onchainRuntime, artifact);
  const maskedLocal = maskImmutables(artifact.deployedBytecode, artifact);
  const runtimeMatch = maskedChain === maskedLocal;

  console.log(`runtime on-chain  ${stripHex(onchainRuntime).length / 2} bytes`);
  console.log(`runtime local     ${stripHex(artifact.deployedBytecode).length / 2} bytes`);
  console.log(`immutable slots   ${Object.keys(artifact.immutableReferences ?? {}).length} refs masked`);
  console.log(`RUNTIME MATCH     ${runtimeMatch ? "YES" : "NO"}`);

  // 2. Creation input from the deploy transaction, compared exactly.
  //    Constructor args live at the tail; the contract has a no-arg
  //    constructor, so creation input == artifact bytecode.
  const tx = await publicClient.getTransaction({ hash: deployment.txHash });
  if (tx.to !== null && tx.to !== undefined) {
    throw new Error(`deploy tx ${deployment.txHash} is not a contract creation`);
  }
  const creationMatch = tx.input.toLowerCase() === artifact.bytecode.toLowerCase();
  console.log(`creation input    ${stripHex(tx.input).length / 2} bytes from tx ${deployment.txHash}`);
  console.log(`CREATION MATCH    ${creationMatch ? "YES" : "NO"}`);

  // 3. Sanity: the deployed contract answers as expected.
  const domainSeparator = (await publicClient.readContract({
    address: deployment.address,
    abi: artifact.abi ?? [],
    functionName: "DOMAIN_SEPARATOR",
  } as never)) as `0x${string}`;
  // EIP-5267 eip712Domain returns (fields, name, version, chainId,
  // verifyingContract, salt, extensions) — chainId is index 3, not 1.
  const eip712 = (await publicClient.readContract({
    address: deployment.address,
    abi: artifact.abi ?? [],
    functionName: "eip712Domain",
  } as never)) as readonly unknown[];
  console.log(`domain separator  ${domainSeparator}`);
  console.log(`eip712 name       ${String(eip712[1])}`);
  console.log(`eip712 chainId    ${String(eip712[3])}`);
  if (Number(eip712[3]) !== chainId) {
    throw new Error(`EIP-712 chainId ${String(eip712[3])} != connected chain ${chainId}`);
  }

  if (!runtimeMatch || !creationMatch) {
    console.error("\nVERIFICATION FAILED — deployed code is not reproducible from this source.");
    process.exitCode = 1;
    return;
  }
  console.log("\nVERIFIED (bytecode-level): deployed code reproduces exactly from the committed source.");
  console.log("Explorer publication is a separate step and may still be pending.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
