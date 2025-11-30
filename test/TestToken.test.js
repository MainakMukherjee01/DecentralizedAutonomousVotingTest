/**
 * Comprehensive Test Suite for TestToken Contract
 * 
 * This test suite covers:
 * - ERC20 standard functionality
 * - ERC20Votes (governance) functionality
 * - ERC20Permit (gasless approvals) functionality
 * - Minting and burning
 * - Access control
 * - Edge cases and security scenarios
 */
import { expect } from "chai";
import hre from "hardhat";

describe("TestToken - Comprehensive Test Suite", function () {
  let ethers, helpers;
  
  before(async function () {
    const network = await hre.network.connect();
    ethers = network.ethers;
    helpers = network.networkHelpers;
  });
  
  // Test fixture for deploying the contract
  async function deployTokenFixture() {
    const [owner, alice, bob, charlie, david] = await ethers.getSigners();

    const TestToken = await ethers.getContractFactory("TestToken");
    const initialSupply = ethers.parseUnits("1000000", 18); // 1 million tokens
    const token = await TestToken.deploy("Test DAO Token", "TDT", initialSupply);
    await token.waitForDeployment();

    return { token, owner, alice, bob, charlie, david, initialSupply };
  }

  describe("Deployment", function () {
    it("Should deploy with correct name, symbol, and decimals", async function () {
      const { token } = await helpers.loadFixture(deployTokenFixture);

      expect(await token.name()).to.equal("Test DAO Token");
      expect(await token.symbol()).to.equal("TDT");
      expect(await token.decimals()).to.equal(18);
    });

    it("Should mint initial supply to deployer", async function () {
      const { token, owner, initialSupply } = await helpers.loadFixture(deployTokenFixture);

      expect(await token.balanceOf(owner.address)).to.equal(initialSupply);
      expect(await token.totalSupply()).to.equal(initialSupply);
    });

    it("Should set deployer as owner", async function () {
      const { token, owner } = await helpers.loadFixture(deployTokenFixture);

      expect(await token.owner()).to.equal(owner.address);
    });

    it("Should deploy with zero initial supply if specified", async function () {
      const [owner] = await ethers.getSigners();
      const TestToken = await ethers.getContractFactory("TestToken");
      const token = await TestToken.deploy("Zero Token", "ZT", 0);
      await token.waitForDeployment();

      expect(await token.totalSupply()).to.equal(0);
      expect(await token.balanceOf(owner.address)).to.equal(0);
    });
  });

  describe("ERC20 Standard Functionality", function () {
    describe("Transfers", function () {
      it("Should transfer tokens between accounts", async function () {
        const { token, owner, alice } = await helpers.loadFixture(deployTokenFixture);
        const amount = ethers.parseUnits("100", 18);

        await expect(token.transfer(alice.address, amount))
          .to.emit(token, "Transfer")
          .withArgs(owner.address, alice.address, amount);

        expect(await token.balanceOf(alice.address)).to.equal(amount);
      });

      it("Should fail when sender has insufficient balance", async function () {
        const { token, alice, bob } = await helpers.loadFixture(deployTokenFixture);
        const amount = ethers.parseUnits("100", 18);

        await expect(
          token.connect(alice).transfer(bob.address, amount)
        ).to.be.rejected;
      });

      it("Should handle zero amount transfers", async function () {
        const { token, owner, alice } = await helpers.loadFixture(deployTokenFixture);

        await expect(token.transfer(alice.address, 0))
          .to.emit(token, "Transfer")
          .withArgs(owner.address, alice.address, 0);
      });

      it("Should fail transfer to zero address", async function () {
        const { token } = await helpers.loadFixture(deployTokenFixture);
        const amount = ethers.parseUnits("100", 18);

        await expect(
          token.transfer(ethers.ZeroAddress, amount)
        ).to.be.rejected;
      });
    });

    describe("Approvals and TransferFrom", function () {
      it("Should approve tokens for spender", async function () {
        const { token, owner, alice } = await helpers.loadFixture(deployTokenFixture);
        const amount = ethers.parseUnits("100", 18);

        await expect(token.approve(alice.address, amount))
          .to.emit(token, "Approval")
          .withArgs(owner.address, alice.address, amount);

        expect(await token.allowance(owner.address, alice.address)).to.equal(amount);
      });

      it("Should allow spender to transferFrom approved amount", async function () {
        const { token, owner, alice, bob } = await helpers.loadFixture(deployTokenFixture);
        const amount = ethers.parseUnits("100", 18);

        await token.approve(alice.address, amount);

        await expect(
          token.connect(alice).transferFrom(owner.address, bob.address, amount)
        ).to.emit(token, "Transfer")
          .withArgs(owner.address, bob.address, amount);

        expect(await token.balanceOf(bob.address)).to.equal(amount);
        expect(await token.allowance(owner.address, alice.address)).to.equal(0);
      });

      it("Should fail transferFrom when allowance is insufficient", async function () {
        const { token, owner, alice, bob } = await helpers.loadFixture(deployTokenFixture);
        const amount = ethers.parseUnits("100", 18);

        await token.approve(alice.address, amount / 2n);

        await expect(
          token.connect(alice).transferFrom(owner.address, bob.address, amount)
        ).to.be.rejected;
      });

      it("Should handle infinite approval (max uint256)", async function () {
        const { token, owner, alice, bob } = await helpers.loadFixture(deployTokenFixture);
        const amount = ethers.parseUnits("100", 18);

        await token.approve(alice.address, ethers.MaxUint256);

        await token.connect(alice).transferFrom(owner.address, bob.address, amount);

        // Infinite approval should not decrease
        expect(await token.allowance(owner.address, alice.address)).to.equal(ethers.MaxUint256);
      });
    });
  });

  describe("ERC20Votes Functionality", function () {
    describe("Delegation", function () {
      it("Should allow self-delegation", async function () {
        const { token, owner } = await helpers.loadFixture(deployTokenFixture);

        await expect(token.delegate(owner.address))
          .to.emit(token, "DelegateChanged")
          .withArgs(owner.address, ethers.ZeroAddress, owner.address);

        expect(await token.delegates(owner.address)).to.equal(owner.address);
      });

      it("Should update voting power after delegation", async function () {
        const { token, owner, initialSupply } = await helpers.loadFixture(deployTokenFixture);

        // Initially no voting power
        expect(await token.getVotes(owner.address)).to.equal(0);

        await token.delegate(owner.address);

        // After delegation, voting power equals balance
        expect(await token.getVotes(owner.address)).to.equal(initialSupply);
      });

      it("Should allow delegation to another address", async function () {
        const { token, owner, alice, initialSupply } = await helpers.loadFixture(deployTokenFixture);

        await token.delegate(alice.address);

        expect(await token.delegates(owner.address)).to.equal(alice.address);
        expect(await token.getVotes(alice.address)).to.equal(initialSupply);
        expect(await token.getVotes(owner.address)).to.equal(0);
      });
    });

    describe("Past Votes and Checkpoints", function () {
      it("Should track past votes at specific blocks", async function () {
        const { token, owner, alice, initialSupply } = await helpers.loadFixture(deployTokenFixture);

        await token.delegate(owner.address);
        const block1 = await ethers.provider.getBlockNumber();

        // Transfer half to alice
        await token.transfer(alice.address, initialSupply / 2n);
        await token.connect(alice).delegate(alice.address);

        // Check historical voting power
        expect(await token.getPastVotes(owner.address, block1)).to.equal(initialSupply);
        expect(await token.getVotes(owner.address)).to.equal(initialSupply / 2n);
      });
    });
  });

  describe("Minting Functionality", function () {
    it("Should allow owner to mint tokens", async function () {
      const { token, owner, alice, initialSupply } = await helpers.loadFixture(deployTokenFixture);
      const mintAmount = ethers.parseUnits("1000", 18);

    describe("Nonces (EIP-2612)", function () {
      it("Should return correct nonce for permit signatures", async function () {
        const { token, owner, alice } = await helpers.loadFixture(deployTokenFixture);

        // Initial nonce should be 0
        expect(await token.nonces(owner.address)).to.equal(0);
        expect(await token.nonces(alice.address)).to.equal(0);

        // Nonces are tracked for signature-based operations (permit, delegateBySig)
        // Regular delegate() doesn't increment nonces
        // The nonces function override ensures proper tracking for EIP-2612 compatibility
        const ownerNonce = await token.nonces(owner.address);
        expect(ownerNonce).to.equal(0);
      });
    });

      await expect(token.mint(alice.address, mintAmount))
        .to.emit(token, "Transfer")
        .withArgs(ethers.ZeroAddress, alice.address, mintAmount);

      expect(await token.balanceOf(alice.address)).to.equal(mintAmount);
      expect(await token.totalSupply()).to.equal(initialSupply + mintAmount);
    });

    it("Should prevent non-owner from minting", async function () {
      const { token, alice, bob } = await helpers.loadFixture(deployTokenFixture);
      const mintAmount = ethers.parseUnits("1000", 18);

      await expect(
        token.connect(alice).mint(bob.address, mintAmount)
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });

  describe("Burning Functionality", function () {
    it("Should allow owner to burn tokens from any address", async function () {
      const { token, owner, alice } = await helpers.loadFixture(deployTokenFixture);
      const amount = ethers.parseUnits("100", 18);

      await token.transfer(alice.address, amount);
      const totalSupplyBefore = await token.totalSupply();

      await expect(token['burn(address,uint256)'](alice.address, amount))
        .to.emit(token, "Transfer")
        .withArgs(alice.address, ethers.ZeroAddress, amount);

      expect(await token.balanceOf(alice.address)).to.equal(0);
      expect(await token.totalSupply()).to.equal(totalSupplyBefore - amount);
    });

    it("Should prevent non-owner from burning", async function () {
      const { token, alice, bob } = await helpers.loadFixture(deployTokenFixture);
      const amount = ethers.parseUnits("100", 18);

      await token.transfer(alice.address, amount);

      await expect(
        token.connect(bob)['burn(address,uint256)'](alice.address, amount)
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });

    it("Should allow holder to self-burn their own tokens", async function () {
      const { token, alice } = await helpers.loadFixture(deployTokenFixture);
      const amount = ethers.parseUnits("100", 18);

      await token.transfer(alice.address, amount);
      const totalSupplyBefore = await token.totalSupply();
      const balanceBefore = await token.balanceOf(alice.address);

      // Alice burns her own tokens using burn(uint256)
      await expect(token.connect(alice)['burn(uint256)'](amount))
        .to.emit(token, "Transfer")
        .withArgs(alice.address, ethers.ZeroAddress, amount);

      expect(await token.balanceOf(alice.address)).to.equal(balanceBefore - amount);
      expect(await token.totalSupply()).to.equal(totalSupplyBefore - amount);
    });

  describe("Access Control", function () {
    it("Should allow owner to transfer ownership", async function () {
      const { token, owner, alice } = await helpers.loadFixture(deployTokenFixture);

      await expect(token.transferOwnership(alice.address))
        .to.emit(token, "OwnershipTransferred")
        .withArgs(owner.address, alice.address);

      expect(await token.owner()).to.equal(alice.address);
    });

    it("Should allow new owner to perform owner functions", async function () {
      const { token, owner, alice, bob } = await helpers.loadFixture(deployTokenFixture);
      const mintAmount = ethers.parseUnits("1000", 18);

      await token.transferOwnership(alice.address);

      await expect(token.connect(alice).mint(bob.address, mintAmount))
        .to.emit(token, "Transfer");

      expect(await token.balanceOf(bob.address)).to.equal(mintAmount);
    });
  });
});
