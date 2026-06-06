// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title RaxcAgentMemory
/// @notice ERC-7857-inspired intelligent agent NFT — stores compact JSON memory summaries as bytes on-chain.
///         Each token = one persistent agent identity. After every audit the agent writes its
///         JSON summary directly into the token's memory storage. The agent reads this back
///         at the start of the next audit to build long-context memory.
contract RaxcAgentMemory is ERC721, Ownable {
  struct MemoryEntry {
    bytes summaryJson; // compact JSON: contract_name, vuln_type, risk, confidence, explanation, etc.
    bytes32 contentHash; // keccak256(summaryJson) for integrity verification
    uint256 timestamp;
    string description; // human label e.g. "RAXC Audit: DeFiVault 2026-06-05"
  }

  uint256 private _nextTokenId;

  /// @notice Authorized agent wallet per token (Rust process that calls pushMemory)
  mapping(uint256 => address) public agentAddress;

  /// @notice Full memory history per token — newest last
  mapping(uint256 => MemoryEntry[]) private _memory;

  event AgentMinted(
    uint256 indexed tokenId,
    address indexed owner,
    address indexed agent
  );
  event MemoryPushed(
    uint256 indexed tokenId,
    uint256 indexed entryIndex,
    bytes32 contentHash,
    string description,
    uint256 timestamp
  );

  constructor() ERC721("RAXC Agent Memory", "RAXC-MEM") Ownable(msg.sender) {}

  /// @notice Mint a new agent identity
  /// @param to    Owner address
  /// @param agent Authorized agent wallet (Rust process) that will call pushMemory()
  /// @return tokenId The new token ID
  function mint(
    address to,
    address agent
  ) external onlyOwner returns (uint256 tokenId) {
    tokenId = _nextTokenId++;
    _safeMint(to, tokenId);
    agentAddress[tokenId] = agent;
    emit AgentMinted(tokenId, to, agent);
  }

  /// @notice Push a new memory entry after an audit completes
  /// @param tokenId      Token to update
  /// @param summaryJson  Compact JSON summary as UTF-8 bytes
  /// @param description  Human-readable label for this memory entry
  function pushMemory(
    uint256 tokenId,
    bytes calldata summaryJson,
    string calldata description
  ) external {
    require(_ownerOf(tokenId) != address(0), "Token does not exist");
    require(
      msg.sender == agentAddress[tokenId] || msg.sender == ownerOf(tokenId),
      "Not authorized"
    );
    require(summaryJson.length > 0, "Empty memory");

    bytes32 hash = keccak256(summaryJson);
    uint256 idx = _memory[tokenId].length;

    _memory[tokenId].push(
      MemoryEntry({
        summaryJson: summaryJson,
        contentHash: hash,
        timestamp: block.timestamp,
        description: description
      })
    );

    emit MemoryPushed(tokenId, idx, hash, description, block.timestamp);
  }

  /// @notice Get all memory entries for a token (full history)
  function getMemory(
    uint256 tokenId
  ) external view returns (MemoryEntry[] memory) {
    require(_ownerOf(tokenId) != address(0), "Token does not exist");
    return _memory[tokenId];
  }

  /// @notice Get the N most recent memory entries (for agent context injection)
  /// @param tokenId Token to query
  /// @param n       Max number of recent entries to return
  function getRecentMemory(
    uint256 tokenId,
    uint256 n
  ) external view returns (MemoryEntry[] memory) {
    require(_ownerOf(tokenId) != address(0), "Token does not exist");
    MemoryEntry[] storage all = _memory[tokenId];
    uint256 total = all.length;
    if (total == 0) return new MemoryEntry[](0);

    uint256 count = n < total ? n : total;
    MemoryEntry[] memory result = new MemoryEntry[](count);
    for (uint256 i = 0; i < count; i++) {
      result[i] = all[total - count + i];
    }
    return result;
  }

  /// @notice Get a single memory entry by index
  function getMemoryAt(
    uint256 tokenId,
    uint256 index
  ) external view returns (MemoryEntry memory) {
    require(_ownerOf(tokenId) != address(0), "Token does not exist");
    require(index < _memory[tokenId].length, "Index out of bounds");
    return _memory[tokenId][index];
  }

  /// @notice Total number of memory entries for a token
  function memoryCount(uint256 tokenId) external view returns (uint256) {
    return _memory[tokenId].length;
  }

  /// @notice Verify a memory entry's integrity
  function verifyMemory(
    uint256 tokenId,
    uint256 index,
    bytes calldata summaryJson
  ) external view returns (bool) {
    require(index < _memory[tokenId].length, "Index out of bounds");
    return keccak256(summaryJson) == _memory[tokenId][index].contentHash;
  }

  /// @notice Update the authorized agent wallet for a token
  function setAgentAddress(uint256 tokenId, address agent) external {
    require(msg.sender == ownerOf(tokenId), "Not token owner");
    agentAddress[tokenId] = agent;
  }
}
