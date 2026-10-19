import { defineConfig } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";

export default defineConfig({
  plugins: [hardhatToolboxViem],
  paths: {
    sources: "./src",
    tests: "./test",
  },
  solidity: {
    version: "0.8.37",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {
      type: "edr-simulated",
    },
    // Hardhat's implicit `localhost` always targets 127.0.0.1:8545, so
    // `hardhat node --port 8550` + `--network localhost` silently talks to
    // the wrong (or a stale) node. Declaring it explicitly keeps the port in
    // one place: set LOCALHOST_RPC_URL when running a node elsewhere.
    localhost: {
      type: "http",
      url: process.env.LOCALHOST_RPC_URL ?? "http://127.0.0.1:8545",
    },
    baseSepolia: {
      type: "http",
      url: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
    },
  },
});
