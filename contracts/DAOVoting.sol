// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title DAOVoting - Token-weighted DAO proposal & voting contract
/// @notice Uses OpenZeppelin ERC20Votes to count voting power at snapshot block (block number at proposal creation).
/// @dev Requires the provided token to implement IERC5805-like snapshot via getPastVotes & getPastTotalSupply (ERC20Votes).
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";

contract DAOVoting is Ownable, ReentrancyGuard {
    ERC20Votes public immutable governanceToken;

    uint16 public quorumNumerator; // e.g., 20 -> 20% quorum
    uint16 public constant QUORUM_DENOMINATOR = 100;

    uint256 public votingPeriodBlocks; // number of blocks that voting remains open

    uint256 private _nextProposalId;

    enum ProposalState { Active, Succeeded, Defeated, Canceled, Executed, Unknown }

    struct Proposal {
        uint256 id;
        address proposer;
        string description;
        uint256 snapshotBlock;
        uint256 startBlock;
        uint256 endBlock;
        uint256 forVotes;
        uint256 againstVotes;
        bool canceled;
        bool executed;
    }

    // proposalId => Proposal
    mapping(uint256 => Proposal) public proposals;
    // proposalId => voter => voted?
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event ProposalCreated(
        uint256 indexed id,
        address indexed proposer,
        uint256 snapshotBlock,
        uint256 startBlock,
        uint256 endBlock,
        string description
    );

    event VoteCast(address indexed voter, uint256 indexed proposalId, bool support, uint256 weight);
    event ProposalExecuted(uint256 indexed id);
    event ProposalCanceled(uint256 indexed id);
    event QuorumChanged(uint16 newNumerator);
    event VotingPeriodChanged(uint256 newVotingPeriodBlocks);

    constructor(
        address _governanceToken,
        uint16 _quorumNumerator,
        uint256 _votingPeriodBlocks
    ) Ownable(msg.sender) {
        require(_governanceToken != address(0), "token zero");
        require(_quorumNumerator > 0 && _quorumNumerator <= QUORUM_DENOMINATOR, "invalid quorum");
        require(_votingPeriodBlocks > 0, "voting period zero");

        governanceToken = ERC20Votes(_governanceToken);
        quorumNumerator = _quorumNumerator;
        votingPeriodBlocks = _votingPeriodBlocks;

        _nextProposalId = 1; // start IDs at 1
    }

    /// @notice Create a proposal. Snapshot block is current block number.
    function createProposal(string calldata description) external returns (uint256) {
        uint256 snapshot = block.number; // snapshot block for votes
        uint256 start = block.number;
        uint256 end = block.number + votingPeriodBlocks;

        uint256 pid = _nextProposalId++;
        proposals[pid] = Proposal({
            id: pid,
            proposer: msg.sender,
            description: description,
            snapshotBlock: snapshot,
            startBlock: start,
            endBlock: end,
            forVotes: 0,
            againstVotes: 0,
            canceled: false,
            executed: false
        });

        emit ProposalCreated(pid, msg.sender, snapshot, start, end, description);
        return pid;
    }

    /// @notice Cast a vote (token-weighted) at the proposal snapshot
    function vote(uint256 proposalId, bool support) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        require(p.id != 0, "proposal not found");
        require(!p.canceled, "proposal canceled");
        require(block.number >= p.startBlock, "voting not started");
        require(block.number <= p.endBlock, "voting ended");
        require(!hasVoted[proposalId][msg.sender], "already voted");

        uint256 weight = governanceToken.getPastVotes(msg.sender, p.snapshotBlock);
        require(weight > 0, "no voting power at snapshot");

        hasVoted[proposalId][msg.sender] = true;

        if (support) {
            p.forVotes += weight;
        } else {
            p.againstVotes += weight;
        }

        emit VoteCast(msg.sender, proposalId, support, weight);
    }

    /// @notice Returns proposal state
    function state(uint256 proposalId) public view returns (ProposalState) {
        Proposal storage p = proposals[proposalId];
        if (p.id == 0) return ProposalState.Unknown;
        if (p.canceled) return ProposalState.Canceled;
        if (p.executed) return ProposalState.Executed;
        if (block.number <= p.endBlock) return ProposalState.Active;

        // voting ended; check quorum & votes
        uint256 totalSupplyAtSnapshot = governanceToken.getPastTotalSupply(p.snapshotBlock);
        uint256 requiredQuorum = (totalSupplyAtSnapshot * quorumNumerator) / QUORUM_DENOMINATOR;
        if (p.forVotes >= requiredQuorum && p.forVotes > p.againstVotes) {
            return ProposalState.Succeeded;
        } else {
            return ProposalState.Defeated;
        }
    }

    /// @notice Execute a proposal (logical execution — caller-defined; here we only mark executed)
    function executeProposal(uint256 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        require(p.id != 0, "proposal not found");
        require(!p.canceled, "proposal canceled");
        require(!p.executed, "already executed");
        require(block.number > p.endBlock, "voting not ended");

        ProposalState st = state(proposalId);
        require(st == ProposalState.Succeeded, "proposal not successful");

        p.executed = true;

        emit ProposalExecuted(proposalId);
        // Note: For on-chain actions, this contract could integrate a governor module that calls targets.
        // We keep execution as a logical state change for simplicity / auditability.
    }

    /// @notice Cancel a proposal (owner only)
    function cancelProposal(uint256 proposalId) external onlyOwner {
        Proposal storage p = proposals[proposalId];
        require(p.id != 0, "proposal not found");
        require(!p.canceled, "already canceled");
        require(!p.executed, "already executed");

        p.canceled = true;
        emit ProposalCanceled(proposalId);
    }

    /// @notice Set quorum percentage numerator (owner only)
    function setQuorumNumerator(uint16 newNumerator) external onlyOwner {
        require(newNumerator > 0 && newNumerator <= QUORUM_DENOMINATOR, "invalid quorum");
        quorumNumerator = newNumerator;
        emit QuorumChanged(newNumerator);
    }

    /// @notice Set voting period in blocks (owner only)
    function setVotingPeriodBlocks(uint256 newVotingPeriodBlocks) external onlyOwner {
        require(newVotingPeriodBlocks > 0, "voting period zero");
        votingPeriodBlocks = newVotingPeriodBlocks;
        emit VotingPeriodChanged(newVotingPeriodBlocks);
    }

    // Read helpers
    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

}
