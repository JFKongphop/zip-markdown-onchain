// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title RaxcAuditReport
/// @notice ERC-8183 audit record contract — stores full markdown report as bytes on-chain.
///         Each audit task gets a permanent, verifiable, human-readable report stored in contract storage.
contract RaxcAuditReport {
  enum RiskLevel {
    None,
    Low,
    Medium,
    High,
    Critical
  }

  struct AuditRecord {
    address requester; // wallet that requested the audit
    string contractName; // name of the audited contract
    RiskLevel riskLevel; // risk classification
    uint64 confidence; // 0-100
    string vulnerabilityType; // e.g. "Reentrancy", "Flash Loan"
    bytes32 reportHash; // keccak256 of reportData for integrity verification
    bytes reportData; // full markdown report as raw bytes
    uint256 createdAt;
    uint256 completedAt;
  }

  mapping(uint256 => AuditRecord) private _records;
  uint256 public recordCount;

  // requester → list of their task IDs
  mapping(address => uint256[]) private _requesterTasks;

  event AuditCreated(
    uint256 indexed taskId,
    address indexed requester,
    string contractName,
    uint256 timestamp
  );

  event AuditFinalized(
    uint256 indexed taskId,
    RiskLevel riskLevel,
    uint64 confidence,
    bytes32 reportHash,
    uint256 timestamp
  );

  /// @notice Create a new audit task — call before running the agent
  /// @param contractName Name of the Solidity contract being audited
  /// @return taskId The assigned task ID
  function createAudit(
    string calldata contractName
  ) external returns (uint256 taskId) {
    taskId = recordCount++;
    _records[taskId] = AuditRecord({
      requester: msg.sender,
      contractName: contractName,
      riskLevel: RiskLevel.None,
      confidence: 0,
      vulnerabilityType: "",
      reportHash: bytes32(0),
      reportData: "",
      createdAt: block.timestamp,
      completedAt: 0
    });
    _requesterTasks[msg.sender].push(taskId);
    emit AuditCreated(taskId, msg.sender, contractName, block.timestamp);
  }

  /// @notice Finalize an audit with the full markdown report stored on-chain
  /// @param taskId           Task ID from createAudit()
  /// @param riskLevel        Risk classification (0=None .. 4=Critical)
  /// @param confidence       Confidence score 0-100
  /// @param vulnerabilityType E.g. "Reentrancy"
  /// @param reportMarkdown   Full markdown report as UTF-8 bytes
  function finalizeAudit(
    uint256 taskId,
    RiskLevel riskLevel,
    uint64 confidence,
    string calldata vulnerabilityType,
    bytes calldata reportMarkdown
  ) external {
    AuditRecord storage r = _records[taskId];
    require(r.createdAt != 0, "Task does not exist");
    require(r.completedAt == 0, "Already finalized");
    require(confidence <= 100, "Confidence must be 0-100");

    bytes32 hash = keccak256(reportMarkdown);

    r.riskLevel = riskLevel;
    r.confidence = confidence;
    r.vulnerabilityType = vulnerabilityType;
    r.reportHash = hash;
    r.reportData = reportMarkdown;
    r.completedAt = block.timestamp;

    emit AuditFinalized(taskId, riskLevel, confidence, hash, block.timestamp);
  }

  /// @notice Read the full audit record
  function getAudit(uint256 taskId) external view returns (AuditRecord memory) {
    require(_records[taskId].createdAt != 0, "Task does not exist");
    return _records[taskId];
  }

  /// @notice Read only the markdown report bytes (cheaper call if you only need the report)
  function getReport(uint256 taskId) external view returns (bytes memory) {
    require(_records[taskId].createdAt != 0, "Task does not exist");
    return _records[taskId].reportData;
  }

  /// @notice Verify report integrity — returns true if provided bytes match stored hash
  function verifyReport(
    uint256 taskId,
    bytes calldata reportMarkdown
  ) external view returns (bool) {
    require(_records[taskId].createdAt != 0, "Task does not exist");
    return keccak256(reportMarkdown) == _records[taskId].reportHash;
  }

  /// @notice Get all task IDs for a requester
  function getTasksByRequester(
    address requester
  ) external view returns (uint256[] memory) {
    return _requesterTasks[requester];
  }
}
