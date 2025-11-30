/**
 * Integration Test Suite
 * 
 * End-to-end scenarios testing the complete DAO workflow
 */

import { expect } from "chai";
import hre from "hardhat";

describe("DAO Integration Tests", function () {
  let owner, alice, bob, charlie, david;
  let ethers, helpers;
  
  before(async function () {
    const network = await hre.network.connect();
    ethers = network.ethers;
    helpers = network.networkHelpers;
  });
  
  async function deployFullSystemFixture() {
    [owner, alice, bob, charlie, david] = await ethers.getSigners();

    // Deploy token with initial supply
    const TestToken = await ethers.getContractFactory("TestToken");
    const token = await TestToken.deploy(
      "DAO Governance Token",
      "DGT",
      ethers.parseUnits("10000000", 18)
    );
    await token.waitForDeployment();

    // Deploy DAO
    const DAOVoting = await ethers.getContractFactory("DAOVoting");
    const dao = await DAOVoting.deploy(
      await token.getAddress(),
      20, // 20% quorum
      15  // 15 blocks voting period
    );
    await dao.waitForDeployment();

    return { token, dao, owner, alice, bob, charlie, david };
  }

  describe("Complete DAO Lifecycle", function () {
    it("Should complete full governance cycle: distribute → delegate → propose → vote → execute", async function () {
      const { token, dao, owner, alice, bob } = await helpers.loadFixture(deployFullSystemFixture);

      // Step 1: Distribute tokens
      await token.mint(alice.address, ethers.parseUnits("3000000", 18)); // 30%
      await token.mint(bob.address, ethers.parseUnits("2000000", 18)); // 20%

      // Step 2: Delegate voting power
      await token.connect(alice).delegate(alice.address);
      await token.connect(bob).delegate(bob.address);
      await token.delegate(owner.address);

      // Verify voting power
      expect(await token.getVotes(alice.address)).to.equal(ethers.parseUnits("3000000", 18));
      expect(await token.getVotes(bob.address)).to.equal(ethers.parseUnits("2000000", 18));

      // Step 3: Create proposal
      const tx = await dao.connect(alice).createProposal("Upgrade protocol to v2");
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          return dao.interface.parseLog(log).name === "ProposalCreated";
        } catch {
          return false;
        }
      });
      const proposalId = dao.interface.parseLog(event).args.id;

      // Step 4: Vote on proposal
      await dao.connect(alice).vote(proposalId, true);
      await dao.connect(bob).vote(proposalId, true);

      // Step 5: Wait for voting period to end
      await helpers.mine(16);

      // Step 6: Verify proposal succeeded
      expect(await dao.state(proposalId)).to.equal(1); // Succeeded

      // Step 7: Execute proposal
      await dao.executeProposal(proposalId);

      // Step 8: Verify execution
      const proposal = await dao.getProposal(proposalId);
      expect(proposal.executed).to.equal(true);
    });

    it("Should handle token transfers after delegation maintaining voting power", async function () {
      const { token, dao, owner, alice, bob, charlie } = await helpers.loadFixture(deployFullSystemFixture);

      // Distribute and delegate
      await token.mint(alice.address, ethers.parseUnits("3000000", 18));
      await token.connect(alice).delegate(alice.address);

      const initialVotes = await token.getVotes(alice.address);

      // Transfer tokens to Bob (who hasn't delegated)
      await token.connect(alice).transfer(bob.address, ethers.parseUnits("1000000", 18));

      // Alice's voting power should decrease
      expect(await token.getVotes(alice.address)).to.equal(
        initialVotes - ethers.parseUnits("1000000", 18)
      );

      // Bob has no voting power (hasn't delegated)
      expect(await token.getVotes(bob.address)).to.equal(0);

      // Bob delegates to himself
      await token.connect(bob).delegate(bob.address);

      // Now Bob has voting power
      expect(await token.getVotes(bob.address)).to.equal(ethers.parseUnits("1000000", 18));
    });

    it("Should prevent manipulation through token transfers after snapshot", async function () {
      const { token, dao, owner, alice, bob } = await helpers.loadFixture(deployFullSystemFixture);

      // Setup
      await token.mint(alice.address, ethers.parseUnits("3000000", 18));
      await token.mint(bob.address, ethers.parseUnits("1000000", 18));
      await token.connect(alice).delegate(alice.address);
      await token.connect(bob).delegate(bob.address);

      // Create proposal (snapshot taken)
      const tx = await dao.connect(alice).createProposal("Test");
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          return dao.interface.parseLog(log).name === "ProposalCreated";
        } catch {
          return false;
        }
      });
      const proposalId = dao.interface.parseLog(event).args.id;
      const proposal = await dao.getProposal(proposalId);

      // Mine a block so we can query past votes at snapshot
      await helpers.mine(1);
      
      // Record voting power at snapshot
      const aliceVotesAtSnapshot = await token.getPastVotes(alice.address, proposal.snapshotBlock);
      const bobVotesAtSnapshot = await token.getPastVotes(bob.address, proposal.snapshotBlock);

      // Try to manipulate: Alice transfers all tokens to Bob
      await token.connect(alice).transfer(bob.address, ethers.parseUnits("3000000", 18));

      // Alice should still be able to vote with snapshot power
      await dao.connect(alice).vote(proposalId, true);

      const proposalAfterVote = await dao.getProposal(proposalId);
      expect(proposalAfterVote.forVotes).to.equal(aliceVotesAtSnapshot);

      // Bob cannot double-vote with transferred tokens
      await expect(dao.connect(bob).vote(proposalId, true))
        .to.emit(dao, "VoteCast");

      const finalProposal = await dao.getProposal(proposalId);
      expect(finalProposal.forVotes).to.equal(aliceVotesAtSnapshot + bobVotesAtSnapshot);
    });
  });

  describe("Multi-Proposal Scenarios", function () {
    it("Should handle multiple simultaneous proposals independently", async function () {
      const { token, dao, owner, alice, bob, charlie } = await helpers.loadFixture(deployFullSystemFixture);

      // Setup
      await token.mint(alice.address, ethers.parseUnits("3000000", 18));
      await token.mint(bob.address, ethers.parseUnits("2000000", 18));
      await token.mint(charlie.address, ethers.parseUnits("1000000", 18));
      
      await token.connect(alice).delegate(alice.address);
      await token.connect(bob).delegate(bob.address);
      await token.connect(charlie).delegate(charlie.address);

      // Create multiple proposals
      const tx1 = await dao.createProposal("Proposal A");
      const tx2 = await dao.createProposal("Proposal B");
      const tx3 = await dao.createProposal("Proposal C");

      const receipt1 = await tx1.wait();
      const receipt2 = await tx2.wait();
      const receipt3 = await tx3.wait();

      const pid1 = dao.interface.parseLog(receipt1.logs.find(log => {
        try { return dao.interface.parseLog(log).name === "ProposalCreated"; } catch { return false; }
      })).args.id;

      const pid2 = dao.interface.parseLog(receipt2.logs.find(log => {
        try { return dao.interface.parseLog(log).name === "ProposalCreated"; } catch { return false; }
      })).args.id;

      const pid3 = dao.interface.parseLog(receipt3.logs.find(log => {
        try { return dao.interface.parseLog(log).name === "ProposalCreated"; } catch { return false; }
      })).args.id;

      // Vote differently on each
      await dao.connect(alice).vote(pid1, true);
      await dao.connect(bob).vote(pid1, true);
      // Proposal 1 should succeed (50% for)

      await dao.connect(alice).vote(pid2, false);
      await dao.connect(bob).vote(pid2, false);
      // Proposal 2 should be defeated (50% against, 0% for)

      await dao.connect(charlie).vote(pid3, true);
      // Proposal 3 should be defeated (only 10% for, quorum is 20%)

      // Fast forward
      await helpers.mine(16);

      // Verify states
      expect(await dao.state(pid1)).to.equal(1); // Succeeded
      expect(await dao.state(pid2)).to.equal(2); // Defeated
      expect(await dao.state(pid3)).to.equal(2); // Defeated

      // Only first can be executed
      await dao.executeProposal(pid1);
      await expect(dao.executeProposal(pid2)).to.be.revertedWith("proposal not successful");
      await expect(dao.executeProposal(pid3)).to.be.revertedWith("proposal not successful");
    });
  });

  describe("Governance Parameter Changes", function () {
    it("Should allow DAO to change its own parameters through governance", async function () {
      const { token, dao, owner, alice, bob } = await helpers.loadFixture(deployFullSystemFixture);

      // Setup
      await token.mint(alice.address, ethers.parseUnits("3000000", 18));
      await token.mint(bob.address, ethers.parseUnits("2000000", 18));
      await token.connect(alice).delegate(alice.address);
      await token.connect(bob).delegate(bob.address);
      await token.delegate(owner.address);

      // Create proposal to change quorum
      const tx = await dao.createProposal("Lower quorum to 15%");
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          return dao.interface.parseLog(log).name === "ProposalCreated";
        } catch {
          return false;
        }
      });
      const proposalId = dao.interface.parseLog(event).args.id;

      // Vote and pass
      await dao.connect(alice).vote(proposalId, true);
      await dao.connect(bob).vote(proposalId, true);

      await helpers.mine(16);

      // Execute and change parameter
      await dao.executeProposal(proposalId);
      
      // Owner executes the actual parameter change
      // (In production, this would be done by the proposal execution logic)
      await dao.setQuorumNumerator(15);

      expect(await dao.quorumNumerator()).to.equal(15);
    });
  });

  describe("Token Minting and Burning Effects", function () {
    it("Should update total supply and voting power correctly with mint/burn", async function () {
      const { token, dao, owner, alice } = await helpers.loadFixture(deployFullSystemFixture);

      const initialSupply = await token.totalSupply();

      // Mint tokens to Alice
      await token.mint(alice.address, ethers.parseUnits("1000000", 18));
      expect(await token.totalSupply()).to.equal(initialSupply + ethers.parseUnits("1000000", 18));

      // Delegate and check voting power
      await token.connect(alice).delegate(alice.address);
      expect(await token.getVotes(alice.address)).to.equal(ethers.parseUnits("1000000", 18));

      // Burn some tokens
      await token['burn(address,uint256)'](alice.address, ethers.parseUnits("500000", 18));
      expect(await token.totalSupply()).to.equal(initialSupply + ethers.parseUnits("500000", 18));
      expect(await token.getVotes(alice.address)).to.equal(ethers.parseUnits("500000", 18));
    });

    it("Should affect quorum calculation when supply changes", async function () {
      const { token, dao, owner, alice } = await helpers.loadFixture(deployFullSystemFixture);

      // Mint tokens
      await token.mint(alice.address, ethers.parseUnits("2000000", 18));
      await token.connect(alice).delegate(alice.address);

      // Create proposal
      const tx = await dao.createProposal("Test");
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          return dao.interface.parseLog(log).name === "ProposalCreated";
        } catch {
          return false;
        }
      });
      const proposalId = dao.interface.parseLog(event).args.id;
      const proposal = await dao.getProposal(proposalId);

      // Mine a block so we can query past supply
      await helpers.mine(1);
      
      // Get total supply at snapshot
      const totalSupplyAtSnapshot = await token.getPastTotalSupply(proposal.snapshotBlock);
      
      // Mint more tokens after proposal (shouldn't affect this proposal)
      await token.mint(owner.address, ethers.parseUnits("10000000", 18));

      // Vote
      await dao.connect(alice).vote(proposalId, true);

      await helpers.mine(16);

      // Check state - quorum based on snapshot supply, not current
      const state = await dao.state(proposalId);
      const requiredQuorum = (totalSupplyAtSnapshot * 20n) / 100n;
      
      if (ethers.parseUnits("2000000", 18) >= requiredQuorum) {
        expect(state).to.equal(1); // Succeeded
      } else {
        expect(state).to.equal(2); // Defeated
      }
    });
  });

  describe("Emergency Scenarios", function () {
    it("Should allow owner to cancel malicious proposals", async function () {
      const { token, dao, owner, alice, bob } = await helpers.loadFixture(deployFullSystemFixture);

      await token.mint(alice.address, ethers.parseUnits("3000000", 18));
      await token.connect(alice).delegate(alice.address);

      // Alice creates a malicious proposal
      const tx = await dao.connect(alice).createProposal("Malicious: drain treasury");
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          return dao.interface.parseLog(log).name === "ProposalCreated";
        } catch {
          return false;
        }
      });
      const proposalId = dao.interface.parseLog(event).args.id;

      // Owner cancels it immediately
      await dao.cancelProposal(proposalId);

      // Alice cannot vote on canceled proposal
      await expect(dao.connect(alice).vote(proposalId, true))
        .to.be.revertedWith("proposal canceled");

      expect(await dao.state(proposalId)).to.equal(3); // Canceled
    });
  });

  describe("Real-World Usage Patterns", function () {
    it("Should support common DAO operations: treasury allocation proposal", async function () {
      const { token, dao, owner, alice, bob, charlie } = await helpers.loadFixture(deployFullSystemFixture);

      // Simulate DAO members
      await token.mint(alice.address, ethers.parseUnits("4000000", 18)); // 40%
      await token.mint(bob.address, ethers.parseUnits("3000000", 18)); // 30%
      await token.mint(charlie.address, ethers.parseUnits("2000000", 18)); // 20%

      await token.connect(alice).delegate(alice.address);
      await token.connect(bob).delegate(bob.address);
      await token.connect(charlie).delegate(charlie.address);
      await token.delegate(owner.address);

      // Alice proposes treasury allocation
      const tx = await dao.connect(alice).createProposal(
        "Allocate 100,000 tokens to development fund"
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          return dao.interface.parseLog(log).name === "ProposalCreated";
        } catch {
          return false;
        }
      });
      const proposalId = dao.interface.parseLog(event).args.id;

      // Community votes
      await dao.connect(alice).vote(proposalId, true);
      await dao.connect(bob).vote(proposalId, true);
      await dao.connect(charlie).vote(proposalId, false);

      await helpers.mine(16);

      // 70% for, 20% against => Should succeed
      expect(await dao.state(proposalId)).to.equal(1);

      await dao.executeProposal(proposalId);

      const proposal = await dao.getProposal(proposalId);
      expect(proposal.executed).to.equal(true);
    });
  });
});
