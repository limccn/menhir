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

Chain-verifiable evidence (2026-10-20): the deployer
`0x330c67886612ba88b4895739f2e610f01f233d78` has **nonce 4**, so nonces 0–1
produced the two registries above and 2–3 the seed transactions. The orphan's
full address is not recorded anywhere by design (the crashed run died before
writing its record); its existence is inferred from the nonce plus the
journal's transcript, not from a deployment artifact. Do not treat the
truncated `0x5F1070…825a` as a usable identifier.

`deploy.ts` refuses to run when `deployments/base-sepolia.json` exists. Do not
delete that file to "re-deploy"; read the journal entry first.

## Commands

```powershell
# from the workspace root
pnpm --dir menhir/contracts test              # 50 tests, no network needed
pnpm --dir menhir/contracts gas:snapshot      # writes gas-snapshot.json
pnpm --dir menhir/contracts typecheck

# deploy (requires DEPLOYER_PRIVATE_KEY in env; throws away gas if misused)
$env:DEPLOYER_PRIVATE_KEY = '<throwaway>'
pnpm --dir menhir/contracts deploy:sepolia

# seed the demo corpus (idempotent: replays MemoryCommitted, keys on contentHash)
pnpm --dir menhir/contracts seed:sepolia
```

## Verification

Three independent paths. **Sourcify is the one that succeeded**; Blockscout
is rate-limited upstream on the free tier.

### 1. Sourcify — verified (`exact_match`)

```powershell
pnpm --dir menhir/contracts verify:sourcify   # address baked into the script
```

Status confirmed via `https://sourcify.dev/server/v2/contract/84532/0xC85ed11d3065739F1829A114e420584bEC3FDFEF`
→ `match: "exact_match"`. Repo UI:
`https://sourcify.dev/server/repo-ui/84532/0xC85ed11d3065739F1829A114e420584bEC3FDFEF`

`exact_match` is the strongest Sourcify outcome: the source, the compiler
settings, the metadata hash and the bytecode all match. It is not a partial
or metadata-patched match.

### 2. Bytecode reproduction (explorer-independent, always available)

```powershell
pnpm --dir menhir/contracts verify:local
```

Proves the deployed runtime reproduces from committed source with immutable
slots masked. Measured 2026-10-20:

```
runtime on-chain / local   5387 bytes each
immutable refs masked      7   (OZ EIP-712 caches)
RUNTIME MATCH              YES
creation input             6287 bytes, CREATION MATCH YES
eip712 name / chainId      MemoryRegistry / 84532
```

This answers "is the deployment what the repo says it is" without depending
on any explorer. It does **not** publish source.

### 3. Blockscout — currently limited

```powershell
pnpm --dir menhir/contracts verify:blockscout
```

Failure mode seen on 2026-10-20: the *minimal* compiler input fails, then
Hardhat retries with the full input and gets **HTTP 429**. Separately,
`https://base-sepolia.blockscout.com/api` returns
`{"message":"Too many requests..."}` for plain API calls too, so the free
tier is the constraint — not the build. Retry later; no code change is
required. The Blockscout record already serves correct creation and deployed
bytecode, so its index is intact.

**Do not "fix" a 429 by changing compiler settings.** Sourcify's
`exact_match` on the same artifact rules out a build mismatch.

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
