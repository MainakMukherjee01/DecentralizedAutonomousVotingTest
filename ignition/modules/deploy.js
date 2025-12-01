/**
 * Enterprise-Grade Deployment Script for DAO Voting System
 * 
 * This script handles the complete deployment process including:
 * - Pre-deployment validation
 * - Contract deployment with error handling
 * - Post-deployment verification
 * - Configuration management
 * - Deployment artifact generation
 * 
 * Usage:
 *   npx hardhat run scripts/deploy.js --network localhost
 *   npx hardhat run scripts/deploy.js --network sepolia
 *   SKIP_VERIFICATION=true npx hardhat run scripts/deploy.js --network mainnet
 */

import hre from "hardhat";
import { getConfig, validateConfig } from "../../deploy.config.js";
import {
    checkBalance,
    confirmDeployment,
    deployContract,
    estimateDeploymentGas,
    saveDeployment,
    validateDeployment,
    verifyContract
} from "../../scripts/utils/deployment-helpers.js";

/**
 * Main deployment function
 */
async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("   DAO VOTING SYSTEM - ENTERPRISE DEPLOYMENT SCRIPT");
  console.log("═══════════════════════════════════════════════════════════\n");

  // ============================================================
  // 1. ENVIRONMENT SETUP
  // ============================================================
  console.log("📋 Step 1: Environment Setup");
  console.log("────────────────────────────────────────────────────────────");

  const network = hre.network.name;
  console.log(`Network: ${network}`);
  console.log(`Chain ID: ${(await hre.ethers.provider.getNetwork()).chainId}`);

  // Get deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${hre.ethers.formatEther(balance)} ETH`);

  // ============================================================
  // 2. LOAD AND VALIDATE CONFIGURATION
  // ============================================================
  console.log("\n📋 Step 2: Configuration Validation");
  console.log("────────────────────────────────────────────────────────────");

  let config;
  try {
    config = getConfig(network);
    validateConfig(config);
    console.log("✅ Configuration validated successfully");
    console.log(`  Token: ${config.token.name} (${config.token.symbol})`);
    console.log(`  Initial Supply: ${config.token.initialSupply} tokens`);
    console.log(`  Quorum: ${config.dao.quorumNumerator}%`);
    console.log(`  Voting Period: ${config.dao.votingPeriodBlocks} blocks`);
  } catch (error) {
    console.error(`❌ Configuration error: ${error.message}`);
    process.exit(1);
  }

  // ============================================================
  // 3. GAS ESTIMATION
  // ============================================================
  console.log("\n📋 Step 3: Gas Estimation");
  console.log("────────────────────────────────────────────────────────────");

  let totalGasEstimate = 0n;
  try {
    // Estimate TestToken deployment
    const tokenGas = await estimateDeploymentGas(
      hre,
      "TestToken",
      [config.token.name, config.token.symbol, hre.ethers.parseUnits(config.token.initialSupply, 18)]
    );
    totalGasEstimate += tokenGas.estimatedCost;

    // Check balance before proceeding
    const sufficientBalance = await checkBalance(hre, deployer, totalGasEstimate * 2n); // 2x buffer
    if (!sufficientBalance && network !== "hardhat") {
      console.error("❌ Deployment aborted: Insufficient balance");
      process.exit(1);
    }
  } catch (error) {
    console.warn(`⚠️  Gas estimation failed: ${error.message}`);
    console.log("   Proceeding with deployment anyway...");
  }

  // ============================================================
  // 4. DEPLOYMENT CONFIRMATION
  // ============================================================
  if (network !== "hardhat" && network !== "localhost") {
    const confirmed = await confirmDeployment(
      `You are about to deploy to ${network}. Continue?`
    );
    if (!confirmed) {
      console.log("❌ Deployment cancelled by user");
      process.exit(0);
    }
  }

  // ============================================================
  // 5. DEPLOY TESTTOKEN CONTRACT
  // ============================================================
  console.log("\n📋 Step 4: TestToken Deployment");
  console.log("────────────────────────────────────────────────────────────");

  let token;
  let tokenAddress;
  const tokenArgs = [
    config.token.name,
    config.token.symbol,
    hre.ethers.parseUnits(config.token.initialSupply, 18),
  ];

  try {
    token = await deployContract(hre, "TestToken", tokenArgs, {
      confirmations: network === "hardhat" || network === "localhost" ? 1 : 2,
    });
    tokenAddress = await token.getAddress();

    // Validate TestToken deployment
    const tokenValid = await validateDeployment(token, {
      name: config.token.name,
      symbol: config.token.symbol,
      decimals: 18n,
    });

    if (!tokenValid) {
      throw new Error("TestToken validation failed");
    }

    console.log("✅ TestToken deployed and validated successfully");
  } catch (error) {
    console.error(`❌ TestToken deployment failed: ${error.message}`);
    process.exit(1);
  }

  // ============================================================
  // 6. DEPLOY DAOVOTING CONTRACT
  // ============================================================
  console.log("\n📋 Step 5: DAOVoting Deployment");
  console.log("────────────────────────────────────────────────────────────");

  let dao;
  let daoAddress;
  const daoArgs = [
    tokenAddress,
    config.dao.quorumNumerator,
    config.dao.votingPeriodBlocks,
  ];

  try {
    dao = await deployContract(hre, "DAOVoting", daoArgs, {
      confirmations: network === "hardhat" || network === "localhost" ? 1 : 2,
    });
    daoAddress = await dao.getAddress();

    // Validate DAOVoting deployment
    const daoValid = await validateDeployment(dao, {
      quorumNumerator: config.dao.quorumNumerator,
      votingPeriodBlocks: config.dao.votingPeriodBlocks,
    });

    if (!daoValid) {
      throw new Error("DAOVoting validation failed");
    }

    // Verify governance token is correctly set
    const govTokenAddr = await dao.governanceToken();
    if (govTokenAddr.toLowerCase() !== tokenAddress.toLowerCase()) {
      throw new Error("Governance token address mismatch");
    }

    console.log("✅ DAOVoting deployed and validated successfully");
  } catch (error) {
    console.error(`❌ DAOVoting deployment failed: ${error.message}`);
    process.exit(1);
  }

  // ============================================================
  // 7. POST-DEPLOYMENT SETUP
  // ============================================================
  console.log("\n📋 Step 6: Post-Deployment Setup");
  console.log("────────────────────────────────────────────────────────────");

  try {
    // Check deployer's token balance
    const deployerBalance = await token.balanceOf(deployer.address);
    console.log(`✅ Deployer token balance: ${hre.ethers.formatUnits(deployerBalance, 18)} ${config.token.symbol}`);

    // Verify deployer can delegate voting power to themselves
    const currentDelegate = await token.delegates(deployer.address);
    if (currentDelegate === hre.ethers.ZeroAddress) {
      console.log("⚠️  Note: Deployer has not delegated voting power yet");
      console.log("   Run: await token.delegate(deployer.address)");
    } else {
      console.log(`✅ Deployer voting power delegated to: ${currentDelegate}`);
    }

    // Check voting power
    const votingPower = await token.getVotes(deployer.address);
    console.log(`  Current voting power: ${hre.ethers.formatUnits(votingPower, 18)}`);

  } catch (error) {
    console.warn(`⚠️  Post-deployment checks failed: ${error.message}`);
  }

  // ============================================================
  // 8. CONTRACT VERIFICATION
  // ============================================================
  if (config.verification?.enabled && process.env.SKIP_VERIFICATION !== "true") {
    console.log("\n📋 Step 7: Contract Verification");
    console.log("────────────────────────────────────────────────────────────");

    // Wait a bit for contract to propagate
    console.log("⏳ Waiting 30 seconds for contract propagation...");
    await new Promise(resolve => setTimeout(resolve, 30000));

    await verifyContract(hre, tokenAddress, tokenArgs);
    await verifyContract(hre, daoAddress, daoArgs);
  } else {
    console.log("\n📋 Step 7: Contract Verification");
    console.log("────────────────────────────────────────────────────────────");
    console.log("⏭️  Skipped (verification disabled or SKIP_VERIFICATION=true)");
  }

  // ============================================================
  // 9. SAVE DEPLOYMENT ARTIFACTS
  // ============================================================
  console.log("\n📋 Step 8: Saving Deployment Artifacts");
  console.log("────────────────────────────────────────────────────────────");

  const deploymentInfo = {
    deployer: deployer.address,
    chainId: (await hre.ethers.provider.getNetwork()).chainId.toString(),
    contracts: {
      TestToken: {
        address: tokenAddress,
        constructorArgs: tokenArgs,
        name: config.token.name,
        symbol: config.token.symbol,
        initialSupply: config.token.initialSupply,
      },
      DAOVoting: {
        address: daoAddress,
        constructorArgs: daoArgs,
        governanceToken: tokenAddress,
        quorumNumerator: config.dao.quorumNumerator,
        votingPeriodBlocks: config.dao.votingPeriodBlocks,
      },
    },
    verification: {
      enabled: config.verification?.enabled || false,
      completed: config.verification?.enabled && process.env.SKIP_VERIFICATION !== "true",
    },
  };

  saveDeployment(network, deploymentInfo);

  // ============================================================
  // 10. DEPLOYMENT SUMMARY
  // ============================================================
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("   DEPLOYMENT COMPLETED SUCCESSFULLY");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`\n📊 Deployment Summary:`);
  console.log(`────────────────────────────────────────────────────────────`);
  console.log(`Network:              ${network}`);
  console.log(`Deployer:             ${deployer.address}`);
  console.log(`TestToken:            ${tokenAddress}`);
  console.log(`DAOVoting:            ${daoAddress}`);
  console.log(`Token Supply:         ${config.token.initialSupply} ${config.token.symbol}`);
  console.log(`Quorum:               ${config.dao.quorumNumerator}%`);
  console.log(`Voting Period:        ${config.dao.votingPeriodBlocks} blocks`);
  console.log(`────────────────────────────────────────────────────────────`);
  
  console.log(`\n📝 Next Steps:`);
  console.log(`  1. Delegate voting power: await token.delegate(yourAddress)`);
  console.log(`  2. Create a proposal: await dao.createProposal("description")`);
  console.log(`  3. Vote on proposal: await dao.vote(proposalId, true)`);
  
  console.log(`\n💡 Useful Commands:`);
  console.log(`  Verify contracts manually:`);
  console.log(`    npx hardhat verify --network ${network} ${tokenAddress} "${config.token.name}" "${config.token.symbol}" "${hre.ethers.parseUnits(config.token.initialSupply, 18)}"`);
  console.log(`    npx hardhat verify --network ${network} ${daoAddress} ${tokenAddress} ${config.dao.quorumNumerator} ${config.dao.votingPeriodBlocks}`);
  
  console.log("\n");
}

// Execute deployment with error handling
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n═══════════════════════════════════════════════════════════");
    console.error("   DEPLOYMENT FAILED");
    console.error("═══════════════════════════════════════════════════════════");
    console.error(error);
    process.exit(1);
  });
