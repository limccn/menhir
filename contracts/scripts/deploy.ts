import { network } from "hardhat";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// hardhat-viem v3 split deployment into two calls:
//   deployContract()            -> sends AND waits, returns only the contract
//   sendDeploymentTransaction() -> sends, returns { contract, deploymentTransaction }
// `contract.deploymentTransaction` (a hardhat-viem v2 / ethers-wrapper accessor)
// does not exist on the v3 contract instance.
//
// Anything after the send can still throw — the tx is already mined. If this
// script dies past sendDeploymentTransaction(), a contract EXISTS on chain
// even though no record was written. Check the deployer's nonce before
// re-running, or you will deploy a second registry.
//
// `--network localhost` targets LOCALHOST_RPC_URL (default 127.0.0.1:8545)
// regardless of the --port passed to `hardhat node`.
const connection = await network.create();
const { viem } = connection;
const networkName = connection.networkName;

const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();

console.log("Network:", networkName);
console.log("Deployer:", deployer.account.address);
console.log("Chain id:", await publicClient.getChainId());
console.log("Block:", await publicClient.getBlockNumber());

// One registry per network is the M1 premise: the UI reads a single address
// and has no notion of "which deployment is canonical". Refuse to add a
// second one silently.
const fileName = networkName === "baseSepolia" ? "base-sepolia" : networkName;
const outDir = path.resolve("deployments");
const outFile = path.join(outDir, `${fileName}.json`);

try {
  await access(outFile);
  console.error(
    `Refusing to deploy: ${outFile} already records a deployment.\n` +
      "Delete it if you really mean to deploy a second registry.",
  );
  process.exit(1);
} catch {
  // no previous deployment — expected
}

const { contract: registry, deploymentTransaction } =
  await viem.sendDeploymentTransaction("MemoryRegistry");

console.log("Deployment tx sent:", deploymentTransaction.hash);

const receipt = await publicClient.waitForTransactionReceipt({
  hash: deploymentTransaction.hash,
});

const deployment = {
  network: networkName,
  chainId: await publicClient.getChainId(),
  address: registry.address,
  txHash: deploymentTransaction.hash,
  blockNumber: receipt.blockNumber.toString(),
  deployedAt: new Date().toISOString(),
};

await mkdir(outDir, { recursive: true });
await writeFile(outFile, `${JSON.stringify(deployment, null, 2)}\n`);

console.log("MemoryRegistry deployed:", deployment.address);
console.log("tx:", deployment.txHash);
console.log("saved:", outFile);
