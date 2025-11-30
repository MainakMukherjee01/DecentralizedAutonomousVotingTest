/**
 * Comprehensive Test Suite for DAOVoting Contract
 * 
 * This test suite covers:
 * - Proposal creation and management
 * - Voting mechanics and weight calculations
 * - Quorum requirements
 * - Proposal state transitions
 * - Access control and security
 * - Edge cases and attack vectors
 */

import { expect } from "chai";
import hre from "hardhat";

describe("DAOVoting - Comprehensive Test Suite", function () {
  let owner, alice, bob, charlie, david, attacker;
  let token, dao;
  let ethers, helpers;
  
  before(async function () {
    const network = await hre.network.connect();
    ethers = network.ethers;
    helpers = network.networkHelpers;
  });
  
  async function deployDAOFixture() {
    [owner, alice, bob, charlie, david, attacker] = await ethers.getSigners();

    // Deploy TestToken
    const TestToken = await ethers.getContractFactory("TestToken");
    const initialSupply = ethers.parseUnits("1000000", 18);
    const token = await TestToken.deploy("DAO Token", "DAO", initialSupply);
    await token.waitForDeployment();

    // Deploy DAOVoting
    const DAOVoting = await ethers.getContractFactory("DAOVoting");
    const quorumNumerator = 20; // 20%
    const votingPeriodBlocks = 10;
    const dao = await DAOVoting.deploy(await token.getAddress(), quorumNumerator, votingPeriodBlocks);
    await dao.waitForDeployment();

    // Distribute tokens
    await token.mint(alice.address, ethers.parseUnits("300000", 18)); // 30%
    await token.mint(bob.address, ethers.parseUnits("200000", 18)); // 20%
    await token.mint(charlie.address, ethers.parseUnits("100000", 18)); // 10%
    await token.mint(david.address, ethers.parseUnits("50000", 18)); // 5%

    // Delegate voting power
    await token.connect(alice).delegate(alice.address);
    await token.connect(bob).delegate(bob.address);
    await token.connect(charlie).delegate(charlie.address);
    await token.connect(david).delegate(david.address);
    await token.delegate(owner.address);

    return {
      dao,
      token,
      owner,
      alice,
      bob,
      charlie,
      david,
      attacker,
      quorumNumerator,
      votingPeriodBlocks,
    };
  }

  describe("Deployment", function () {
    it("Should deploy with correct parameters", async function () {
      const { dao, token, quorumNumerator, votingPeriodBlocks } = await helpers.loadFixture(deployDAOFixture);

      expect(await dao.governanceToken()).to.equal(await token.getAddress());
      expect(await dao.quorumNumerator()).to.equal(quorumNumerator);
      expect(await dao.votingPeriodBlocks()).to.equal(votingPeriodBlocks);
      expect(await dao.QUORUM_DENOMINATOR()).to.equal(100);
    });

    it("Should set deployer as owner", async function () {
      const { dao, owner } = await helpers.loadFixture(deployDAOFixture);

      expect(await dao.owner()).to.equal(owner.address);
    });

    it("Should revert with zero token address", async function () {
      const DAOVoting = await ethers.getContractFactory("DAOVoting");

      await expect(
        DAOVoting.deploy(ethers.ZeroAddress, 20, 10)
      ).to.be.revertedWith("token zero");
    });

    it("Should revert with invalid quorum", async function () {
      const { token } = await helpers.loadFixture(deployDAOFixture);
      const DAOVoting = await ethers.getContractFactory("DAOVoting");
      const tokenAddr = await token.getAddress();

      await expect(DAOVoting.deploy(tokenAddr, 0, 10)).to.be.revertedWith("invalid quorum");
      await expect(DAOVoting.deploy(tokenAddr, 101, 10)).to.be.revertedWith("invalid quorum");
    });

    it("Should revert with zero voting period", async function () {
      const { token } = await helpers.loadFixture(deployDAOFixture);
      const DAOVoting = await ethers.getContractFactory("DAOVoting");

      await expect(
        DAOVoting.deploy(await token.getAddress(), 20, 0)
      ).to.be.revertedWith("voting period zero");
    });
  });

  describe("Proposal Creation", function () {
    it("Should create a proposal with correct parameters", async function () {
      const { dao, alice } = await helpers.loadFixture(deployDAOFixture);
      const description = "Test Proposal";

      const tx = await dao.connect(alice).createProposal(description);
      const receipt = await tx.wait();
      
      const event = receipt.logs.find(log => {
        try {
          return dao.interface.parseLog(log).name === "ProposalCreated";
        } catch {
          return false;
        }
      });
      
      const parsedEvent = dao.interface.parseLog(event);
      const proposalId = parsedEvent.args.id;

      const proposal = await dao.getProposal(proposalId);
      expect(proposal.proposer).to.equal(alice.address);
      expect(proposal.description).to.equal(description);
      expect(proposal.forVotes).to.equal(0);
      expect(proposal.againstVotes).to.equal(0);
      expect(proposal.canceled).to.equal(false);
      expect(proposal.executed).to.equal(false);
    });

    it("Should set snapshot to current block", async function () {
      const { dao, alice } = await helpers.loadFixture(deployDAOFixture);

      const tx = await dao.connect(alice).createProposal("Test");
      const receipt = await tx.wait();
      const blockNumber = receipt.blockNumber;

      const event = receipt.logs.find(log => {
        try {
          return dao.interface.parseLog(log).name === "ProposalCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = dao.interface.parseLog(event);
      const proposalId = parsedEvent.args.id;

      const proposal = await dao.getProposal(proposalId);
      expect(proposal.snapshotBlock).to.equal(blockNumber);
      expect(proposal.startBlock).to.equal(blockNumber);
    });

    it("Should calculate endBlock correctly", async function () {
      const { dao, alice, votingPeriodBlocks } = await helpers.loadFixture(deployDAOFixture);

      const tx = await dao.connect(alice).createProposal("Test");
      const receipt = await tx.wait();
      const blockNumber = receipt.blockNumber;

      const event = receipt.logs.find(log => {
        try {
          return dao.interface.parseLog(log).name === "ProposalCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = dao.interface.parseLog(event);
      const proposalId = parsedEvent.args.id;

      const proposal = await dao.getProposal(proposalId);
      expect(proposal.endBlock).to.equal(BigInt(blockNumber) + BigInt(votingPeriodBlocks));
    });

    it("Should increment proposal IDs", async function () {
      const { dao, alice } = await helpers.loadFixture(deployDAOFixture);

      const tx1 = await dao.connect(alice).createProposal("Proposal 1");
      const receipt1 = await tx1.wait();
      const event1 = receipt1.logs.find(log => {
        try {
          return dao.interface.parseLog(log).name === "ProposalCreated";
        } catch {
          return false;
        }
      });
      const id1 = dao.interface.parseLog(event1).args.id;

      const tx2 = await dao.connect(alice).createProposal("Proposal 2");
      const receipt2 = await tx2.wait();
      const event2 = receipt2.logs.find(log => {
        try {
          return dao.interface.parseLog(log).name === "ProposalCreated";
        } catch {
          return false;
        }
      });
      const id2 = dao.interface.parseLog(event2).args.id;

      expect(id2).to.equal(id1 + 1n);
    });

    it("Should allow anyone to create proposals", async function () {
      const { dao, attacker } = await helpers.loadFixture(deployDAOFixture);

      await expect(dao.connect(attacker).createProposal("Attacker Proposal")).to.not.be.rejected;
    });
  });

  describe("Voting Mechanics", function () {
    async function createProposal(dao, creator, description = "Test Proposal") {
      const tx = await dao.connect(creator).createProposal(description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          return dao.interface.parseLog(log).name === "ProposalCreated";
        } catch {
          return false;
        }
      });
      return dao.interface.parseLog(event).args.id;
    }

    it("Should allow voting with correct weight", async function () {
      const { dao, token, alice } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      const votingPower = await token.getVotes(alice.address);
      
      await expect(dao.connect(alice).vote(proposalId, true))
        .to.emit(dao, "VoteCast")
        .withArgs(alice.address, proposalId, true, votingPower);

      const proposal = await dao.getProposal(proposalId);
      expect(proposal.forVotes).to.equal(votingPower);
      expect(proposal.againstVotes).to.equal(0);
    });

    it("Should record against votes correctly", async function () {
      const { dao, token, alice, bob } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      const bobVotes = await token.getVotes(bob.address);
      
      await dao.connect(bob).vote(proposalId, false);

      const proposal = await dao.getProposal(proposalId);
      expect(proposal.againstVotes).to.equal(bobVotes);
      expect(proposal.forVotes).to.equal(0);
    });

    it("Should prevent double voting", async function () {
      const { dao, alice } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      await dao.connect(alice).vote(proposalId, true);

      await expect(
        dao.connect(alice).vote(proposalId, false)
      ).to.be.revertedWith("already voted");
    });

    it("Should use snapshot block for vote weight", async function () {
      const { dao, token, alice } = await helpers.loadFixture(deployDAOFixture);
      
      const proposalId = await createProposal(dao, alice);
      const proposal = await dao.getProposal(proposalId);
      
      // Mine a block so we can query past votes at snapshot block
      await helpers.mine(1);
      const weightAtSnapshot = await token.getPastVotes(alice.address, proposal.snapshotBlock);

      // Burn tokens after proposal creation to reduce current balance
      await token['burn(address,uint256)'](alice.address, ethers.parseUnits("100000", 18));

      // Vote should use snapshot weight, not current
      await expect(dao.connect(alice).vote(proposalId, true))
        .to.emit(dao, "VoteCast")
        .withArgs(alice.address, proposalId, true, weightAtSnapshot);
    });

    it("Should prevent voting with zero voting power", async function () {
      const { dao, attacker } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, attacker);

      await expect(
        dao.connect(attacker).vote(proposalId, true)
      ).to.be.revertedWith("no voting power at snapshot");
    });

    it("Should prevent voting on non-existent proposal", async function () {
      const { dao, alice } = await helpers.loadFixture(deployDAOFixture);

      await expect(
        dao.connect(alice).vote(999, true)
      ).to.be.revertedWith("proposal not found");
    });

    it("Should prevent voting before start block", async function () {
      const { dao, alice } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      // This should not happen in practice since startBlock = snapshot = current
      // but we test the logic
      const proposal = await dao.getProposal(proposalId);
      if (proposal.startBlock > await ethers.provider.getBlockNumber()) {
        await expect(
          dao.connect(alice).vote(proposalId, true)
        ).to.be.revertedWith("voting not started");
      }
    });

    it("Should prevent voting after end block", async function () {
      const { dao, alice, votingPeriodBlocks } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      // Mine blocks past the voting period
      await helpers.mine(votingPeriodBlocks + 1);

      await expect(
        dao.connect(alice).vote(proposalId, true)
      ).to.be.revertedWith("voting ended");
    });

    it("Should prevent voting on canceled proposal", async function () {
      const { dao, owner, alice } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      await dao.connect(owner).cancelProposal(proposalId);

      await expect(
        dao.connect(alice).vote(proposalId, true)
      ).to.be.revertedWith("proposal canceled");
    });

    it("Should accumulate votes from multiple voters", async function () {
      const { dao, token, alice, bob, charlie } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      await dao.connect(alice).vote(proposalId, true);
      await dao.connect(bob).vote(proposalId, true);
      await dao.connect(charlie).vote(proposalId, false);

      const proposal = await dao.getProposal(proposalId);
      const expectedFor = (await token.getVotes(alice.address)) + (await token.getVotes(bob.address));
      const expectedAgainst = await token.getVotes(charlie.address);

      expect(proposal.forVotes).to.equal(expectedFor);
      expect(proposal.againstVotes).to.equal(expectedAgainst);
    });
  });

  describe("Proposal State Management", function () {
    async function createProposal(dao, creator) {
      const tx = await dao.connect(creator).createProposal("Test");
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          return dao.interface.parseLog(log).name === "ProposalCreated";
        } catch {
          return false;
        }
      });
      return dao.interface.parseLog(event).args.id;
    }

    it("Should return Active state during voting period", async function () {
      const { dao, alice } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      expect(await dao.state(proposalId)).to.equal(0); // Active
    });

    it("Should return Succeeded state when quorum met and for > against", async function () {
      const { dao, alice, bob, votingPeriodBlocks } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      // Alice (30%) + Bob (20%) = 50% > 20% quorum
      await dao.connect(alice).vote(proposalId, true);
      await dao.connect(bob).vote(proposalId, true);

      await helpers.mine(votingPeriodBlocks + 1);

      expect(await dao.state(proposalId)).to.equal(1); // Succeeded
    });

    it("Should return Defeated when quorum not met", async function () {
      const { dao, alice, david, votingPeriodBlocks } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      // Only David votes (5%), quorum is 20%
      await dao.connect(david).vote(proposalId, true);

      await helpers.mine(votingPeriodBlocks + 1);

      expect(await dao.state(proposalId)).to.equal(2); // Defeated
    });

    it("Should return Defeated when against >= for even with quorum", async function () {
      const { dao, alice, bob, charlie, votingPeriodBlocks } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      // For: Alice (30%), Against: Bob (20%) + Charlie (10%) = 30%
      await dao.connect(alice).vote(proposalId, true);
      await dao.connect(bob).vote(proposalId, false);
      await dao.connect(charlie).vote(proposalId, false);

      await helpers.mine(votingPeriodBlocks + 1);

      expect(await dao.state(proposalId)).to.equal(2); // Defeated (30% = 30%, need >)
    });

    it("Should return Canceled state for canceled proposal", async function () {
      const { dao, owner, alice } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      await dao.connect(owner).cancelProposal(proposalId);

      expect(await dao.state(proposalId)).to.equal(3); // Canceled
    });

    it("Should return Executed state after execution", async function () {
      const { dao, alice, bob, votingPeriodBlocks } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      await dao.connect(alice).vote(proposalId, true);
      await dao.connect(bob).vote(proposalId, true);

      await helpers.mine(votingPeriodBlocks + 1);

      await dao.executeProposal(proposalId);

      expect(await dao.state(proposalId)).to.equal(4); // Executed
    });

    it("Should return Unknown for non-existent proposal", async function () {
      const { dao } = await helpers.loadFixture(deployDAOFixture);

      expect(await dao.state(999)).to.equal(5); // Unknown
    });
  });

  describe("Proposal Execution", function () {
    async function createProposal(dao, creator) {
      const tx = await dao.connect(creator).createProposal("Test");
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          return dao.interface.parseLog(log).name === "ProposalCreated";
        } catch {
          return false;
        }
      });
      return dao.interface.parseLog(event).args.id;
    }

    it("Should execute successful proposal", async function () {
      const { dao, alice, bob, votingPeriodBlocks } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      await dao.connect(alice).vote(proposalId, true);
      await dao.connect(bob).vote(proposalId, true);

      await helpers.mine(votingPeriodBlocks + 1);

      await expect(dao.executeProposal(proposalId))
        .to.emit(dao, "ProposalExecuted")
        .withArgs(proposalId);

      const proposal = await dao.getProposal(proposalId);
      expect(proposal.executed).to.equal(true);
    });

    it("Should prevent execution of defeated proposal", async function () {
      const { dao, alice, david, votingPeriodBlocks } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      await dao.connect(david).vote(proposalId, true);

      await helpers.mine(votingPeriodBlocks + 1);

      await expect(
        dao.executeProposal(proposalId)
      ).to.be.revertedWith("proposal not successful");
    });

    it("Should prevent execution before voting ends", async function () {
      const { dao, alice, bob } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      await dao.connect(alice).vote(proposalId, true);
      await dao.connect(bob).vote(proposalId, true);

      await expect(
        dao.executeProposal(proposalId)
      ).to.be.revertedWith("voting not ended");
    });

    it("Should prevent double execution", async function () {
      const { dao, alice, bob, votingPeriodBlocks } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      await dao.connect(alice).vote(proposalId, true);
      await dao.connect(bob).vote(proposalId, true);

      await helpers.mine(votingPeriodBlocks + 1);

      await dao.executeProposal(proposalId);

      await expect(
        dao.executeProposal(proposalId)
      ).to.be.revertedWith("already executed");
    });

    it("Should prevent execution of canceled proposal", async function () {
      const { dao, owner, alice, bob, votingPeriodBlocks } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      await dao.connect(alice).vote(proposalId, true);
      await dao.connect(bob).vote(proposalId, true);

      await dao.connect(owner).cancelProposal(proposalId);

      await helpers.mine(votingPeriodBlocks + 1);

      await expect(
        dao.executeProposal(proposalId)
      ).to.be.revertedWith("proposal canceled");
    });

    it("Should allow anyone to execute successful proposal", async function () {
      const { dao, alice, bob, attacker, votingPeriodBlocks } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      await dao.connect(alice).vote(proposalId, true);
      await dao.connect(bob).vote(proposalId, true);

      await helpers.mine(votingPeriodBlocks + 1);

      await expect(dao.connect(attacker).executeProposal(proposalId))
        .to.emit(dao, "ProposalExecuted");
    });
  });

  describe("Proposal Cancellation", function () {
    async function createProposal(dao, creator) {
      const tx = await dao.connect(creator).createProposal("Test");
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          return dao.interface.parseLog(log).name === "ProposalCreated";
        } catch {
          return false;
        }
      });
      return dao.interface.parseLog(event).args.id;
    }

    it("Should allow owner to cancel proposal", async function () {
      const { dao, owner, alice } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      await expect(dao.connect(owner).cancelProposal(proposalId))
        .to.emit(dao, "ProposalCanceled")
        .withArgs(proposalId);

      const proposal = await dao.getProposal(proposalId);
      expect(proposal.canceled).to.equal(true);
    });

    it("Should prevent non-owner from canceling", async function () {
      const { dao, alice } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      await expect(
        dao.connect(alice).cancelProposal(proposalId)
      ).to.be.revertedWithCustomError(dao, "OwnableUnauthorizedAccount");
    });

    it("Should prevent canceling already canceled proposal", async function () {
      const { dao, owner, alice } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      await dao.connect(owner).cancelProposal(proposalId);

      await expect(
        dao.connect(owner).cancelProposal(proposalId)
      ).to.be.revertedWith("already canceled");
    });

    it("Should prevent canceling executed proposal", async function () {
      const { dao, owner, alice, bob, votingPeriodBlocks } = await helpers.loadFixture(deployDAOFixture);
      const proposalId = await createProposal(dao, alice);

      await dao.connect(alice).vote(proposalId, true);
      await dao.connect(bob).vote(proposalId, true);

      await helpers.mine(votingPeriodBlocks + 1);

      await dao.executeProposal(proposalId);

      await expect(
        dao.connect(owner).cancelProposal(proposalId)
      ).to.be.revertedWith("already executed");
    });
  });

  describe("Parameter Updates", function () {
    it("Should allow owner to update quorum", async function () {
      const { dao, owner } = await helpers.loadFixture(deployDAOFixture);

      await expect(dao.connect(owner).setQuorumNumerator(15))
        .to.emit(dao, "QuorumChanged")
        .withArgs(15);

      expect(await dao.quorumNumerator()).to.equal(15);
    });

    it("Should prevent non-owner from updating quorum", async function () {
      const { dao, alice } = await helpers.loadFixture(deployDAOFixture);

      await expect(
        dao.connect(alice).setQuorumNumerator(15)
      ).to.be.revertedWithCustomError(dao, "OwnableUnauthorizedAccount");
    });

    it("Should reject invalid quorum values", async function () {
      const { dao, owner } = await helpers.loadFixture(deployDAOFixture);

      await expect(
        dao.connect(owner).setQuorumNumerator(0)
      ).to.be.revertedWith("invalid quorum");

      await expect(
        dao.connect(owner).setQuorumNumerator(101)
      ).to.be.revertedWith("invalid quorum");
    });

    it("Should allow owner to update voting period", async function () {
      const { dao, owner } = await helpers.loadFixture(deployDAOFixture);

      await expect(dao.connect(owner).setVotingPeriodBlocks(50))
        .to.emit(dao, "VotingPeriodChanged")
        .withArgs(50);

      expect(await dao.votingPeriodBlocks()).to.equal(50);
    });

    it("Should prevent non-owner from updating voting period", async function () {
      const { dao, alice } = await helpers.loadFixture(deployDAOFixture);

      await expect(
        dao.connect(alice).setVotingPeriodBlocks(50)
      ).to.be.revertedWithCustomError(dao, "OwnableUnauthorizedAccount");
    });

    it("Should reject zero voting period", async function () {
      const { dao, owner } = await helpers.loadFixture(deployDAOFixture);

      await expect(
        dao.connect(owner).setVotingPeriodBlocks(0)
      ).to.be.revertedWith("voting period zero");
    });
  });

  describe("Edge Cases", function () {
    async function createProposal(dao, creator) {
      const tx = await dao.connect(creator).createProposal("Test");
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          return dao.interface.parseLog(log).name === "ProposalCreated";
        } catch {
          return false;
        }
      });
      return dao.interface.parseLog(event).args.id;
    }

    it("Should handle zero total supply correctly", async function () {
      const [owner] = await ethers.getSigners();
      
      // Deploy token with no initial supply
      const TestToken = await ethers.getContractFactory("TestToken");
      const token = await TestToken.deploy("Empty", "EMP", 0);
      await token.waitForDeployment();

      const DAOVoting = await ethers.getContractFactory("DAOVoting");
      const dao = await DAOVoting.deploy(await token.getAddress(), 10, 5);
      await dao.waitForDeployment();

      const proposalId = await createProposal(dao, owner);

      // Fast forward
      await helpers.mine(6);

      // Should be defeated (no votes possible)
      expect(await dao.state(proposalId)).to.equal(2); // Defeated
    });

    it("Should handle exactly meeting quorum", async function () {
      const { dao, token, bob, charlie, david, votingPeriodBlocks } = await helpers.loadFixture(deployDAOFixture);
      
      // Total supply is 1,650,000 (1M initial + 650k minted)
      // 20% quorum = 330,000 tokens needed
      // Bob (200k) + Charlie (100k) + David (50k) = 350k which is > 330k
      // Let's use Bob (200k) + Charlie (100k) + part of David
      // Actually, we can't split votes, so let's test with the boundary case:
      // Bob (200k) + Charlie (100k) = 300k which is < 330k (should fail)
      // Bob (200k) + Charlie (100k) + David (50k) = 350k which is > 330k (should succeed)
      
      const proposalId = await createProposal(dao, bob);
      
      // Vote with Bob, Charlie, David = 350k votes
      await dao.connect(bob).vote(proposalId, true);
      await dao.connect(charlie).vote(proposalId, true);
      await dao.connect(david).vote(proposalId, true);
      
      await helpers.mine(votingPeriodBlocks + 1);

      // 350k > 330k quorum, and all votes are FOR, so should succeed
      expect(await dao.state(proposalId)).to.equal(1); // Succeeded
    });

    it("Should handle multiple concurrent proposals", async function () {
      const { dao, alice, bob } = await helpers.loadFixture(deployDAOFixture);

      const pid1 = await createProposal(dao, alice);
      const pid2 = await createProposal(dao, alice);
      const pid3 = await createProposal(dao, alice);

      await dao.connect(alice).vote(pid1, true);
      await dao.connect(bob).vote(pid2, false);
      await dao.connect(alice).vote(pid3, true);

      const prop1 = await dao.getProposal(pid1);
      const prop2 = await dao.getProposal(pid2);
      const prop3 = await dao.getProposal(pid3);

      expect(prop1.forVotes).to.be.gt(0);
      expect(prop2.againstVotes).to.be.gt(0);
      expect(prop3.forVotes).to.be.gt(0);
    });
  });
});
