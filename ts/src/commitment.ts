import {
  encodeAbiParameters,
  hashTypedData,
  keccak256,
  type Hex,
} from 'viem';
import { InvalidHexError } from './errors.js';

export type Address = `0x${string}`;
export type Bytes32 = `0x${string}`;

export interface Commitment {
  owner: Address;
  contentHash: Bytes32;
  cidDigest: Bytes32;
  signer: Address;
  blockHeight: bigint;
  op: 0 | 1;
  prev: Bytes32;
}

/**
 * Pinned component order (menhir spec §2.1, D-8: op BEFORE prev).
 * The positional array below is the single source of order — never reorder
 * the interface and the array independently.
 */
const COMMITMENT_COMPONENTS = [
  { name: 'owner', type: 'address' },
  { name: 'contentHash', type: 'bytes32' },
  { name: 'cidDigest', type: 'bytes32' },
  { name: 'signer', type: 'address' },
  { name: 'blockHeight', type: 'uint64' },
  { name: 'op', type: 'uint8' },
  { name: 'prev', type: 'bytes32' },
] as const;

export const COMMITMENT_TYPES = {
  MemoryCommit: [
    { name: 'owner', type: 'address' },
    { name: 'contentHash', type: 'bytes32' },
    { name: 'cidDigest', type: 'bytes32' },
    { name: 'signer', type: 'address' },
    { name: 'blockHeight', type: 'uint64' },
    { name: 'op', type: 'uint8' },
    { name: 'prev', type: 'bytes32' },
  ],
} as const;

const HEX_32 = /^0x[0-9a-fA-F]{64}$/;
const HEX_20 = /^0x[0-9a-fA-F]{40}$/;

export function assertAddress(value: string, label = 'address'): Address {
  if (!HEX_20.test(value)) throw new InvalidHexError(`${label} must be 20-byte hex`);
  return value as Address;
}

export function assertBytes32(value: string, label = 'bytes32'): Bytes32 {
  if (!HEX_32.test(value)) throw new InvalidHexError(`${label} must be 32-byte hex`);
  return value as Bytes32;
}

function commitmentValues(c: Commitment): readonly unknown[] {
  return [
    c.owner,
    c.contentHash,
    c.cidDigest,
    c.signer,
    c.blockHeight,
    c.op,
    c.prev,
  ] as const;
}

/** keccak256(abi.encode(c)) — matches Solidity `commitmentHash` exactly. */
export function commitmentHash(c: Commitment): Bytes32 {
  return keccak256(
    encodeAbiParameters(COMMITMENT_COMPONENTS, commitmentValues(c) as never),
  );
}

export interface Eip712Domain {
  chainId: number;
  verifyingContract: Address;
}

/**
 * EIP-712 typed-data digest over the frozen domain
 * ("MemoryRegistry", "1", chainId, verifyingContract). Unexercised on-chain
 * in M1 (model A); frozen now for the M2+ relay mode.
 */
export function commitmentDigest(c: Commitment, domain: Eip712Domain): Bytes32 {
  return hashTypedData({
    domain: {
      name: 'MemoryRegistry',
      version: '1',
      chainId: domain.chainId,
      verifyingContract: domain.verifyingContract,
    },
    types: COMMITMENT_TYPES,
    primaryType: 'MemoryCommit',
    message: {
      owner: c.owner,
      contentHash: c.contentHash,
      cidDigest: c.cidDigest,
      signer: c.signer,
      blockHeight: c.blockHeight,
      op: c.op,
      prev: c.prev,
    },
  });
}

export const ZERO_BYTES32: Bytes32 = `0x${'0'.repeat(64)}`;

export function isZeroBytes32(value: Hex): boolean {
  return /^0x0{64}$/i.test(value);
}
