// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IMemoryRegistry} from "./IMemoryRegistry.sol";

/**
 * @title MemoryRegistry
 * @notice Content-addressed commitment registry for agent memory.
 *         Single contract: registry + ACL + EIP-712 domain (menhir spec D-6).
 *         No proxy, no initializer, no ETH flows, no external calls.
 */
contract MemoryRegistry is IMemoryRegistry, EIP712 {
    uint256 public constant ROLE_COMMIT = 1 << 0;
    uint256 public constant ROLE_RETRACT = 1 << 1;
    uint256 public constant VALID_MASK = ROLE_COMMIT | ROLE_RETRACT;

    uint256 public constant MAX_BATCH = 64;

    bytes32 private constant MEMORY_COMMIT_TYPEHASH =
        keccak256(
            "MemoryCommit(address owner,bytes32 contentHash,bytes32 cidDigest,address signer,uint64 blockHeight,uint8 op,bytes32 prev)"
        );

    mapping(bytes32 => Commitment) private _commitments; // key = commitmentHash
    mapping(bytes32 => bool) private _retracted; // monotonic
    mapping(bytes32 => bytes32) private _replacedBy; // written only if nonzero
    mapping(address => mapping(address => uint256)) private _roles;

    constructor() EIP712("MemoryRegistry", "1") {}

    // ---------------------------------------------------------------- writes

    function commit(
        Commitment calldata c,
        bytes32[] calldata tags
    ) external override {
        bytes32 h = _validateAndStore(c);
        emit MemoryCommitted(c.owner, c.contentHash, h, c, tags);
    }

    function commitBatch(
        Commitment[] calldata cs,
        bytes32[][] calldata tagLists
    ) external override {
        uint256 len = cs.length;
        if (len == 0 || len > MAX_BATCH) revert TooManyCommitments(len, MAX_BATCH);
        if (len != tagLists.length) revert ArrayLengthMismatch(len, tagLists.length);

        for (uint256 i = 0; i < len; i += 1) {
            bytes32 h = _validateAndStore(cs[i]);
            emit MemoryCommitted(cs[i].owner, cs[i].contentHash, h, cs[i], tagLists[i]);
        }
    }

    function retract(bytes32 h, bytes32 replacedBy) external override {
        if (!_exists(h)) revert UnknownCommitment(h);

        // Idempotent: already retracted -> silent no-op (no event, no write).
        if (_retracted[h]) return;

        address owner = _commitments[h].owner;
        if (msg.sender != owner) {
            _requireRole(owner, msg.sender, ROLE_RETRACT);
        }

        if (replacedBy != bytes32(0) && !_exists(replacedBy)) {
            revert PredecessorUnknown(replacedBy);
        }

        _retracted[h] = true;
        if (replacedBy != bytes32(0)) {
            _replacedBy[h] = replacedBy;
        }

        emit MemoryRetracted(h, msg.sender, replacedBy);
    }

    function setSigner(address signer, uint256 roles) external override {
        if (signer == address(0)) revert ZeroAddress();
        if (roles & ~VALID_MASK != 0) revert InvalidRoles(roles);
        _roles[msg.sender][signer] = roles;
        emit SignerUpdated(msg.sender, signer, roles);
    }

    // ------------------------------------------------------------- ACL view

    function rolesOf(
        address owner,
        address signer
    ) external view override returns (uint256) {
        return _roles[owner][signer];
    }

    // ----------------------------------------------------------------- views

    function commitmentHash(
        Commitment calldata c
    ) external pure override returns (bytes32) {
        return keccak256(abi.encode(c));
    }

    function getCommitment(
        bytes32 h
    ) external view override returns (Commitment memory) {
        return _commitments[h];
    }

    function isDeep(bytes32 h) external view override returns (bool) {
        return _exists(h);
    }

    function isActive(bytes32 h) external view override returns (bool) {
        return _exists(h) && !_retracted[h];
    }

    function isRetracted(bytes32 h) external view override returns (bool) {
        return _retracted[h];
    }

    function replacedByOf(bytes32 h) external view override returns (bytes32) {
        return _replacedBy[h];
    }

    function retractionOf(
        bytes32 h
    ) external view override returns (bool retracted, bytes32 replacedBy) {
        return (_retracted[h], _replacedBy[h]);
    }

    function DOMAIN_SEPARATOR() external view override returns (bytes32) {
        return _domainSeparatorV4();
    }

    function commitmentDigest(
        Commitment calldata c
    ) external view override returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        MEMORY_COMMIT_TYPEHASH,
                        c.owner,
                        c.contentHash,
                        c.cidDigest,
                        c.signer,
                        c.blockHeight,
                        c.op,
                        c.prev
                    )
                )
            );
    }

    // -------------------------------------------------------------- internal

    function _exists(bytes32 h) private view returns (bool) {
        return _commitments[h].contentHash != bytes32(0);
    }

    function _requireRole(
        address owner,
        address signer,
        uint256 role
    ) private view {
        if (_roles[owner][signer] & role == 0) {
            revert NotAuthorized(owner, signer, role);
        }
    }

    function _validateAndStore(
        Commitment calldata c
    ) private returns (bytes32 h) {
        if (c.op != 0) revert InvalidOp(c.op);
        if (
            c.owner == address(0) ||
            c.contentHash == bytes32(0) ||
            c.cidDigest == bytes32(0)
        ) {
            revert InvalidCommitment();
        }
        if (c.signer != msg.sender) revert SignerMismatch(c.signer, msg.sender);

        uint64 limit = uint64(block.number) + 1;
        if (c.blockHeight > limit) revert FutureBlockHeight(c.blockHeight, limit);

        if (msg.sender != c.owner) {
            _requireRole(c.owner, msg.sender, ROLE_COMMIT);
        }

        if (c.prev != bytes32(0) && !_exists(c.prev)) {
            revert PredecessorUnknown(c.prev);
        }

        h = keccak256(abi.encode(c));
        if (_exists(h)) revert DuplicateCommitment(h);

        _commitments[h] = c;
    }
}
