# Getting Started — menhir M1

Operational runbook for the MemoryRegistry on Base Sepolia. Written for a
local Windows-native dev box (no WSL, no docker — pitfall M1-13/M1-17).

> **Testnet only.** The deploy key is a throwaway. Never reuse it on mainnet,
> and never paste it into a shell command or a file that gets committed.

## Endpoints (probe-verified 2026-10-16, menhir spec §10.5)

| Purpose | URL | Note |
|---|---|---|
| Reads | `https://sepolia.base.org` | general RPC; **never** the `pending` tag (M1-7) |
| Writes (broadcast) | `https://sepolia-sequencer.base.org` | `eth_sendRawTransaction` **only** (M1-18) |

`eth_blockNumber` against the sequencer returns **403 by design**. That is
expected behaviour, not an outage — do not "fix" it by pointing writes at the
general endpoint.

The public RPC caps `eth_getLogs` at **200 blocks** and rejects oversized
requests at the HTTP layer with no range wording. `contracts/scripts/lib/scanLogs.ts`
discovers the cap by halving; do not reintroduce a fixed 10k window.

## Deployment record (canonical)

```
network        baseSepolia (chainId 84532)
address        0xC85ed11d3065739F1829A114e420584bEC3FDFEF
deploy tx      0x844b436a68feceba77e0bc10270c6a8132bd5ea0de2a3c5b234b2d1e197b56e8
deployed block 48306141
record         contracts/deployments/base-sepolia.json
```

`contracts/deployments/` must **never** be gitignored or deleted: it is the
only authoritative pointer to the live deployment.

### Two registries exist (history)

A 2026-10-19 deploy script crash happened *after* the tx was mined, so the
key has two deployments:

| Address | Nonce | Status |
|---|---|---|
| `0x5F1070…825a` | 0 | orphaned — no record, no seed, **not canonical** |
| `0xC85ed1…DFEF` | 1 | canonical — recorded, seeded |

`deploy.ts` refuses to run when `deployments/base-sepolia.json` exists. Do not
delete that file to "re-deploy"; read the journal entry first.

## Commands

```powershell
# from the workspace root
pnpm --dir menhir/contracts test              # 39 tests, no network needed
pnpm --dir menhir/contracts gas:snapshot      # writes gas-snapshot.json
pnpm --dir menhir/contracts typecheck

# deploy (requires DEPLOYER_PRIVATE_KEY in env; throws away gas if misused)
$env:DEPLOYER_PRIVATE_KEY = '<throwaway>'
pnpm --dir menhir/contracts deploy:sepolia

# seed the demo corpus (idempotent: replays MemoryCommitted, keys on contentHash)
pnpm --dir menhir/contracts seed:sepolia
```

## Verification

Blockscout (free, no API key — decision D-11):

```powershell
npx hardhat verify blockscout --network baseSepolia 0xC85ed11d3065739F1829A114e420584bEC3FDFEF
```

Explorer: `https://base-sepolia.blockscout.com/address/0xC85ed11d3065739F1829A114e420584bEC3FDFEF`

**If verification fails with "Fail - Unable to verify"**, check the public
rate limit first — `https://base-sepolia.blockscout.com/api` returns
`{"message":"Too many requests..."}` when throttled, and Hardhat surfaces
that as a generic failure. Wait and retry before suspecting the build.

The local artifact and the on-chain bytecode were compared byte-for-byte on
2026-10-19: the creation input is 6287 bytes and matches exactly. Immutable
slots (OpenZeppelin EIP-712 caches) legitimately differ between the artifact
template and the deployed runtime — that is expected, not drift.

## Faucet

Coinbase CDP faucet (primary), thirdweb 0.01 ETH/day (backup) — M1-14.
The delegated agent key must be funded before `seed:sepolia` can broadcast.

## Gas baseline

`gas-snapshot.json` is committed. Measured 2026-10-19 against menhir spec §8
(±20% band):

| Op | Spec | Measured (avg) | Verdict |
|---|---|---|---|
| commit | ~140k | 131,058 | within band |
| retract (pure delete) | ~47k | 51,222 (mixed cases) | within band |
| retract (with replacedBy) | ~69k | 75,392 | within band |
| commitBatch ×64 | ~8.3M | 6,511,292 | within band |
| deployment | — | 1,230,840 | recorded |
