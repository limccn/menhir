// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

interface IMemoryRegistry {
    struct Commitment {
        address owner; // user's sovereign wallet
        bytes32 contentHash; // keccak256(JCS(MemoryContent))
        bytes32 cidDigest; // sha256(canonical bytes) — NOT the CID multihash (D-9)
        address signer; // == msg.sender in M1 (model A)
        uint64 blockHeight; // advisory; <= block.number + 1
        uint8 op; // 0 = put in M1; 1 reserved for M3 compaction
        bytes32 prev; // predecessor commitmentHash; 0 = new version chain
    }

    // writes
    function commit(Commitment calldata c, bytes32[] calldata tags) external;

    function commitBatch(
        Commitment[] calldata cs,
        bytes32[][] calldata tagLists
    ) external;

    function retract(bytes32 commitmentHash, bytes32 replacedBy) external;

    // ACL management
    function setSigner(address signer, uint256 roles) external;

    function rolesOf(
        address owner,
        address signer
    ) external view returns (uint256);

    // views
    function commitmentHash(
        Commitment calldata c
    ) external pure returns (bytes32);

    function getCommitment(
        bytes32 h
    ) external view returns (Commitment memory);

    function isDeep(bytes32 h) external view returns (bool);

    function isActive(bytes32 h) external view returns (bool);

    function isRetracted(bytes32 h) external view returns (bool);

    function replacedByOf(bytes32 h) external view returns (bytes32);

    function retractionOf(
        bytes32 h
    ) external view returns (bool retracted, bytes32 replacedBy);

    // EIP-712
    function DOMAIN_SEPARATOR() external view returns (bytes32);

    function commitmentDigest(
        Commitment calldata c
    ) external view returns (bytes32);

    event MemoryCommitted(
        address indexed owner,
        bytes32 indexed contentHash,
        bytes32 indexed commitmentHash,
        Commitment commitment,
        bytes32[] tags
    );
    event MemoryRetracted(
        bytes32 indexed commitmentHash,
        address indexed by,
        bytes32 replacedBy
    );
    event SignerUpdated(
        address indexed owner,
        address indexed signer,
        uint256 roles
    );

    error InvalidOp(uint8 op);
    error InvalidCommitment();
    error SignerMismatch(address provided, address actual);
    error FutureBlockHeight(uint64 provided, uint64 limit);
    error NotAuthorized(address owner, address signer, uint256 role);
    error PredecessorUnknown(bytes32 prev);
    error DuplicateCommitment(bytes32 commitmentHash);
    error TooManyCommitments(uint256 length, uint256 max);
    error ArrayLengthMismatch(uint256 commitments, uint256 tagLists);
    error UnknownCommitment(bytes32 commitmentHash);
    error ZeroAddress();
    error InvalidRoles(uint256 roles);
}
