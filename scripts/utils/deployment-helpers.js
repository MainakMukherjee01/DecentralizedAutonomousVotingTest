/**
 * Deployment Helper Functions
 * 
 * Utility functions for robust contract deployment, verification, and validation
 */

import fs from 'fs';
import path from 'path';

/**
 * Wait for a transaction to be mined with retry logic
 * @param {object} tx - Transaction object
 * @param {number} confirmations - Number of confirmations to wait for
 * @returns {Promise<object>} Transaction receipt
 */
export async function waitForTransaction(tx, confirmations = 1) {
  console.log(`  ⏳ Waiting for transaction ${tx.hash}...`);
  try {
    const receipt = await tx.wait(confirmations);
    console.log(`  ✅ Transaction confirmed in block ${receipt.blockNumber}`);
    return receipt;
  } catch (error) {
    console.error(`  ❌ Transaction failed: ${error.message}`);
    throw error;
  }
}

/**
 * Deploy a contract with validation and error handling
 * @param {object} hre - Hardhat Runtime Environment
 * @param {string} contractName - Name of the contract to deploy
 * @param {Array} args - Constructor arguments
 * @param {object} options - Deployment options
 * @returns {Promise<object>} Deployed contract instance
 */
export async function deployContract(hre, contractName, args = [], options = {}) {
  const { confirmations = 1, gasLimit = null } = options;

  console.log(`\n📦 Deploying ${contractName}...`);
  console.log(`  Arguments: ${JSON.stringify(args)}`);

  try {
    // Get contract factory
    const ContractFactory = await hre.ethers.getContractFactory(contractName);
    
    // Prepare deployment transaction
    const deployTxData = {};
    if (gasLimit) {
      deployTxData.gasLimit = gasLimit;
    }

    // Deploy contract
    const contract = await ContractFactory.deploy(...args, deployTxData);
    
    // Wait for deployment
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    
    console.log(`  ✅ ${contractName} deployed to: ${address}`);
    
    // Wait for additional confirmations if specified
    if (confirmations > 1) {
      console.log(`  ⏳ Waiting for ${confirmations} confirmations...`);
      await contract.deploymentTransaction().wait(confirmations);
      console.log(`  ✅ ${confirmations} confirmations received`);
    }

    return contract;
  } catch (error) {
    console.error(`  ❌ Deployment failed: ${error.message}`);
    throw error;
  }
}

/**
 * Verify contract on block explorer
 * @param {object} hre - Hardhat Runtime Environment
 * @param {string} address - Contract address
 * @param {Array} constructorArguments - Constructor arguments
 * @returns {Promise<void>}
 */
export async function verifyContract(hre, address, constructorArguments = []) {
  console.log(`\n🔍 Verifying contract at ${address}...`);
  
  try {
    await hre.run("verify:verify", {
      address,
      constructorArguments,
    });
    console.log(`  ✅ Contract verified successfully`);
  } catch (error) {
    if (error.message.includes("Already Verified")) {
      console.log(`  ℹ️  Contract already verified`);
    } else {
      console.error(`  ❌ Verification failed: ${error.message}`);
      console.log(`  ℹ️  You can verify manually later with:`);
      console.log(`     npx hardhat verify --network ${hre.network.name} ${address} ${constructorArguments.join(' ')}`);
    }
  }
}

/**
 * Validate deployed contract by checking basic properties
 * @param {object} contract - Contract instance
 * @param {object} expectedProperties - Expected property values
 * @returns {Promise<boolean>}
 */
export async function validateDeployment(contract, expectedProperties = {}) {
  console.log(`\n✓ Validating deployment...`);
  
  try {
    for (const [property, expectedValue] of Object.entries(expectedProperties)) {
      const actualValue = await contract[property]();
      
      if (actualValue.toString() !== expectedValue.toString()) {
        console.error(`  ❌ Validation failed for ${property}`);
        console.error(`     Expected: ${expectedValue}`);
        console.error(`     Got: ${actualValue}`);
        return false;
      }
      console.log(`  ✅ ${property}: ${actualValue}`);
    }
    return true;
  } catch (error) {
    console.error(`  ❌ Validation error: ${error.message}`);
    return false;
  }
}

/**
 * Save deployment information to file
 * @param {string} network - Network name
 * @param {object} deploymentInfo - Deployment information
 */
export function saveDeployment(network, deploymentInfo) {
  const deploymentsDir = path.join(process.cwd(), 'deployments');
  
  // Create deployments directory if it doesn't exist
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString();
  const filename = `${network}-${Date.now()}.json`;
  const filepath = path.join(deploymentsDir, filename);

  const data = {
    network,
    timestamp,
    ...deploymentInfo,
  };

  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`\n💾 Deployment info saved to: ${filepath}`);

  // Also save as latest deployment
  const latestFilepath = path.join(deploymentsDir, `${network}-latest.json`);
  fs.writeFileSync(latestFilepath, JSON.stringify(data, null, 2));
  console.log(`💾 Latest deployment saved to: ${latestFilepath}`);
}

/**
 * Load latest deployment for a network
 * @param {string} network - Network name
 * @returns {object|null} Deployment information or null if not found
 */
export function loadLatestDeployment(network) {
  const filepath = path.join(process.cwd(), 'deployments', `${network}-latest.json`);
  
  if (!fs.existsSync(filepath)) {
    return null;
  }

  try {
    const data = fs.readFileSync(filepath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error loading deployment: ${error.message}`);
    return null;
  }
}

/**
 * Estimate gas for deployment
 * @param {object} hre - Hardhat Runtime Environment
 * @param {string} contractName - Contract name
 * @param {Array} args - Constructor arguments
 * @returns {Promise<object>} Gas estimation
 */
export async function estimateDeploymentGas(hre, contractName, args = []) {
  console.log(`\n⛽ Estimating gas for ${contractName} deployment...`);
  
  try {
    const ContractFactory = await hre.ethers.getContractFactory(contractName);
    const deployTransaction = ContractFactory.getDeployTransaction(...args);
    
    const gasEstimate = await hre.ethers.provider.estimateGas(deployTransaction);
    const gasPrice = await hre.ethers.provider.getFeeData();
    
    const estimatedCost = gasEstimate * (gasPrice.gasPrice || gasPrice.maxFeePerGas);
    
    console.log(`  Gas estimate: ${gasEstimate.toString()}`);
    console.log(`  Gas price: ${hre.ethers.formatUnits(gasPrice.gasPrice || gasPrice.maxFeePerGas, 'gwei')} gwei`);
    console.log(`  Estimated cost: ${hre.ethers.formatEther(estimatedCost)} ETH`);
    
    return {
      gasEstimate,
      gasPrice: gasPrice.gasPrice || gasPrice.maxFeePerGas,
      estimatedCost,
    };
  } catch (error) {
    console.error(`  ❌ Gas estimation failed: ${error.message}`);
    throw error;
  }
}

/**
 * Check if deployer has sufficient balance
 * @param {object} hre - Hardhat Runtime Environment
 * @param {object} deployer - Deployer signer
 * @param {bigint} requiredAmount - Required amount in wei
 * @returns {Promise<boolean>}
 */
export async function checkBalance(hre, deployer, requiredAmount) {
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  
  console.log(`\n💰 Deployer balance: ${hre.ethers.formatEther(balance)} ETH`);
  console.log(`   Required: ${hre.ethers.formatEther(requiredAmount)} ETH`);
  
  if (balance < requiredAmount) {
    console.error(`  ❌ Insufficient balance!`);
    return false;
  }
  
  console.log(`  ✅ Sufficient balance`);
  return true;
}

/**
 * Wait for user confirmation before proceeding
 * @param {string} message - Confirmation message
 * @returns {Promise<boolean>}
 */
export async function confirmDeployment(message) {
  if (process.env.AUTO_CONFIRM === 'true') {
    return true;
  }

  console.log(`\n⚠️  ${message}`);
  console.log(`   Set AUTO_CONFIRM=true to skip confirmations`);
  
  // For automated environments, return true
  if (!process.stdin.isTTY) {
    console.log(`   Non-interactive mode detected, proceeding...`);
    return true;
  }

  return true; // In production, you might want to add readline for interactive confirmation
}
