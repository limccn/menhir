// AUTO-GENERATED from menhir/contracts artifacts. Do not edit by hand.
// Regenerate: pnpm --dir menhir/contracts exec hardhat compile && node scripts/export-abi.mjs

export const memoryRegistryAbi = [
  {
    "inputs": [],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "commitments",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "tagLists",
        "type": "uint256"
      }
    ],
    "name": "ArrayLengthMismatch",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "commitmentHash",
        "type": "bytes32"
      }
    ],
    "name": "DuplicateCommitment",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "provided",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "limit",
        "type": "uint64"
      }
    ],
    "name": "FutureBlockHeight",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidCommitment",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint8",
        "name": "op",
        "type": "uint8"
      }
    ],
    "name": "InvalidOp",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "roles",
        "type": "uint256"
      }
    ],
    "name": "InvalidRoles",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidShortString",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "signer",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "role",
        "type": "uint256"
      }
    ],
    "name": "NotAuthorized",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "prev",
        "type": "bytes32"
      }
    ],
    "name": "PredecessorUnknown",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "provided",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "actual",
        "type": "address"
      }
    ],
    "name": "SignerMismatch",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "str",
        "type": "string"
      }
    ],
    "name": "StringTooLong",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "length",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "max",
        "type": "uint256"
      }
    ],
    "name": "TooManyCommitments",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "commitmentHash",
        "type": "bytes32"
      }
    ],
    "name": "UnknownCommitment",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroAddress",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [],
    "name": "EIP712DomainChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "contentHash",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "commitmentHash",
        "type": "bytes32"
      },
      {
        "components": [
          {
            "internalType": "address",
            "name": "owner",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "contentHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "cidDigest",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "signer",
            "type": "address"
          },
          {
            "internalType": "uint64",
            "name": "blockHeight",
            "type": "uint64"
          },
          {
            "internalType": "uint8",
            "name": "op",
            "type": "uint8"
          },
          {
            "internalType": "bytes32",
            "name": "prev",
            "type": "bytes32"
          }
        ],
        "indexed": false,
        "internalType": "struct IMemoryRegistry.Commitment",
        "name": "commitment",
        "type": "tuple"
      },
      {
        "indexed": false,
        "internalType": "bytes32[]",
        "name": "tags",
        "type": "bytes32[]"
      }
    ],
    "name": "MemoryCommitted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "commitmentHash",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "by",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "replacedBy",
        "type": "bytes32"
      }
    ],
    "name": "MemoryRetracted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "signer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "roles",
        "type": "uint256"
      }
    ],
    "name": "SignerUpdated",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "DOMAIN_SEPARATOR",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MAX_BATCH",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "ROLE_COMMIT",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "ROLE_RETRACT",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "VALID_MASK",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "owner",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "contentHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "cidDigest",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "signer",
            "type": "address"
          },
          {
            "internalType": "uint64",
            "name": "blockHeight",
            "type": "uint64"
          },
          {
            "internalType": "uint8",
            "name": "op",
            "type": "uint8"
          },
          {
            "internalType": "bytes32",
            "name": "prev",
            "type": "bytes32"
          }
        ],
        "internalType": "struct IMemoryRegistry.Commitment",
        "name": "c",
        "type": "tuple"
      },
      {
        "internalType": "bytes32[]",
        "name": "tags",
        "type": "bytes32[]"
      }
    ],
    "name": "commit",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "owner",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "contentHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "cidDigest",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "signer",
            "type": "address"
          },
          {
            "internalType": "uint64",
            "name": "blockHeight",
            "type": "uint64"
          },
          {
            "internalType": "uint8",
            "name": "op",
            "type": "uint8"
          },
          {
            "internalType": "bytes32",
            "name": "prev",
            "type": "bytes32"
          }
        ],
        "internalType": "struct IMemoryRegistry.Commitment[]",
        "name": "cs",
        "type": "tuple[]"
      },
      {
        "internalType": "bytes32[][]",
        "name": "tagLists",
        "type": "bytes32[][]"
      }
    ],
    "name": "commitBatch",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "owner",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "contentHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "cidDigest",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "signer",
            "type": "address"
          },
          {
            "internalType": "uint64",
            "name": "blockHeight",
            "type": "uint64"
          },
          {
            "internalType": "uint8",
            "name": "op",
            "type": "uint8"
          },
          {
            "internalType": "bytes32",
            "name": "prev",
            "type": "bytes32"
          }
        ],
        "internalType": "struct IMemoryRegistry.Commitment",
        "name": "c",
        "type": "tuple"
      }
    ],
    "name": "commitmentDigest",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "owner",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "contentHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "cidDigest",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "signer",
            "type": "address"
          },
          {
            "internalType": "uint64",
            "name": "blockHeight",
            "type": "uint64"
          },
          {
            "internalType": "uint8",
            "name": "op",
            "type": "uint8"
          },
          {
            "internalType": "bytes32",
            "name": "prev",
            "type": "bytes32"
          }
        ],
        "internalType": "struct IMemoryRegistry.Commitment",
        "name": "c",
        "type": "tuple"
      }
    ],
    "name": "commitmentHash",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "eip712Domain",
    "outputs": [
      {
        "internalType": "bytes1",
        "name": "fields",
        "type": "bytes1"
      },
      {
        "internalType": "string",
        "name": "name",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "version",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "chainId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "verifyingContract",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "salt",
        "type": "bytes32"
      },
      {
        "internalType": "uint256[]",
        "name": "extensions",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "h",
        "type": "bytes32"
      }
    ],
    "name": "getCommitment",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "owner",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "contentHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "cidDigest",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "signer",
            "type": "address"
          },
          {
            "internalType": "uint64",
            "name": "blockHeight",
            "type": "uint64"
          },
          {
            "internalType": "uint8",
            "name": "op",
            "type": "uint8"
          },
          {
            "internalType": "bytes32",
            "name": "prev",
            "type": "bytes32"
          }
        ],
        "internalType": "struct IMemoryRegistry.Commitment",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "h",
        "type": "bytes32"
      }
    ],
    "name": "isActive",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "h",
        "type": "bytes32"
      }
    ],
    "name": "isDeep",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "h",
        "type": "bytes32"
      }
    ],
    "name": "isRetracted",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "h",
        "type": "bytes32"
      }
    ],
    "name": "replacedByOf",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "h",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "replacedBy",
        "type": "bytes32"
      }
    ],
    "name": "retract",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "h",
        "type": "bytes32"
      }
    ],
    "name": "retractionOf",
    "outputs": [
      {
        "internalType": "bool",
        "name": "retracted",
        "type": "bool"
      },
      {
        "internalType": "bytes32",
        "name": "replacedBy",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "signer",
        "type": "address"
      }
    ],
    "name": "rolesOf",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "signer",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "roles",
        "type": "uint256"
      }
    ],
    "name": "setSigner",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
