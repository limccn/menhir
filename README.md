# menhir

On-chain memory commitments for MemoryOverEth. Two packages:

| Package | What it is |
|---|---|
| [`ts/`](./ts) — `@menhir/core` | Canonicalization (JCS RFC 8785), `keccak256`/`sha256` digests, CID and tag codecs, commitment hashing, and the generated registry ABI |
| [`contracts/`](./contracts) — `@menhir/contracts` | `MemoryRegistry`: content-addressed commitments with ACL and an EIP-712 domain, no proxy, no upgrades |

`@menhir/core` exists so one byte sequence is hashed identically by the
contract, the browser, the gateway and the CLI. The Solidity test consumes the
package's committed 100-struct corpus through `@menhir/core/vectors`, so a hash
drift fails a test rather than producing a commitment that looks valid on chain.

## Deployed (Base Sepolia, 84532)

```
registry   0xC85ed11d3065739F1829A114e420584bEC3FDFEF
deploy tx  0x844b436a68feceba77e0bc10270c6a8132bd5ea0de2a3c5b234b2d1e197b56e8
block      48306141
record     contracts/deployments/base-sepolia.json   (never gitignore)
verified   Sourcify exact_match
```

Operational details — endpoints, the two-registry history, verification
troubleshooting and the gas baseline — live in [Getting-Started.md](./Getting-Started.md).

## Develop

```powershell
# from a MemoryOverEth workspace root, or assemble one as CI does
pnpm --dir menhir/ts test          # 94 tests
pnpm --dir menhir/ts typecheck
pnpm --dir menhir/ts check:browser
pnpm --dir menhir/contracts test   # 50 tests (incl. 10k fuzz)
pnpm --dir menhir/contracts typecheck
```

The two packages depend on each other through the workspace (`@menhir/core:
workspace:*`), so they must be installed together.

## Conventions

Captured in `.trellis/spec/menhir/backend/` in the MemoryOverEth workspace:
`getLogs` windows are adaptive (Base Sepolia caps at 200 blocks), the sequencer
accepts only `eth_sendRawTransaction`, and every hash rule has exactly one
implementation.

## License

Apache-2.0. See [LICENSE](./LICENSE).
