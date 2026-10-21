# @limccn/menhir-core

Canonicalization and digest primitives shared by every MemoryOverEth component.

The library exists so that one byte sequence is hashed the same way by the
Solidity contract, the browser, the gateway and the CLI. When those disagree,
commitments look valid on chain and fail verification later — the failure mode
this package is designed to make impossible.

## What it provides

| Export | Purpose |
|---|---|
| `parseMemoryContent` / `canonicalBytes` / `canonicalString` | Schema gate + JCS (RFC 8785) canonical bytes |
| `contentHash` | `keccak256(canonicalBytes)` — the EVM integrity root |
| `cidDigest` | `sha256(canonicalBytes)` — the retrieval-layer root (D-9) |
| `cidV1Raw` / `cidV1RawFromDigest` / `cidV1RawToDigest` | CIDv1 raw string helpers (metadata only) |
| `commitmentHash` | `keccak256(abi.encode(commitment))` — byte-identical to Solidity |
| `commitmentDigest` | EIP-712 typed-data digest (frozen domain, exercised in M2+) |
| `tagToBytes32` / `bytes32ToTag` / `tagsToBytes32List` | UTF-8, right zero-pad, ≤32 bytes |
| `memoryRegistryAbi` | Generated from the compiled contract — never hand-edited |

`@limccn/menhir-core/vectors` is the one Node-only subpath: it loads the committed
golden corpus from disk. The package root is browser-safe, and the build
enforces that — `vectors-node.ts` is excluded from the browser program, so a
`node:*` import anywhere else fails to compile.

## Validation is not optional

`canonicalBytes`/`canonicalString` validate on every call, not only in
`parseMemoryContent`: callers can hand-build a `MemoryContent`, and a gate that
lived only in the parser would be bypassable. Validation snapshots the object
once and hashes the snapshot, so a getter or `toJSON` cannot supply bytes that
were never checked.

An own `"__proto__"` member is snapshotted with `Object.defineProperty`, exactly
as `JSON.parse` represents it, so it is serialized and hashed like any other
member instead of being dropped (M-2). It cannot become the object's prototype.

## Install

```powershell
pnpm add @limccn/menhir-core
```

Node 24+. ESM only.

## Test

```powershell
pnpm test        # 96 tests
pnpm typecheck
pnpm check:browser
```

## License

Apache-2.0. See [LICENSE](./LICENSE).
