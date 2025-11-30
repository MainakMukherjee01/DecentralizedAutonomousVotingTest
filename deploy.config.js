/**
 * Deployment Configuration for DAO Voting System
 * 
 * This file contains all network-specific configurations for deploying
 * the TestToken and DAOVoting contracts across different environments.
 */

export const deploymentConfig = {
  // Local development network configuration
  localhost: {
    token: {
      name: "DAO Test Token",
      symbol: "DTT",
      initialSupply: "1000000", // 1 million tokens (in ether units)
    },
    dao: {
      quorumNumerator: 20, // 20% quorum required
      votingPeriodBlocks: 20, // ~5 minutes on most networks
    },
    verification: {
      enabled: false,
    },
  },

  // Hardhat network (for testing)
  hardhat: {
    token: {
      name: "DAO Test Token",
      symbol: "DTT",
      initialSupply: "1000000",
    },
    dao: {
      quorumNumerator: 20,
      votingPeriodBlocks: 5, // Shorter for faster tests
    },
    verification: {
      enabled: false,
    },
  },

  // Sepolia testnet configuration
  sepolia: {
    token: {
      name: "DAO Governance Token",
      symbol: "DGT",
      initialSupply: "10000000", // 10 million tokens
    },
    dao: {
      quorumNumerator: 15, // 15% quorum
      votingPeriodBlocks: 7200, // ~24 hours (12s blocks)
    },
    verification: {
      enabled: true,
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
  },

  // Ethereum Mainnet configuration
  mainnet: {
    token: {
      name: "DAO Governance Token",
      symbol: "DGT",
      initialSupply: "100000000", // 100 million tokens
    },
    dao: {
      quorumNumerator: 10, // 10% quorum
      votingPeriodBlocks: 50400, // ~1 week (12s blocks)
    },
    verification: {
      enabled: true,
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
  },

  // Polygon configuration
  polygon: {
    token: {
      name: "DAO Governance Token",
      symbol: "DGT",
      initialSupply: "100000000",
    },
    dao: {
      quorumNumerator: 10,
      votingPeriodBlocks: 201600, // ~1 week (3s blocks)
    },
    verification: {
      enabled: true,
      apiKey: process.env.POLYGONSCAN_API_KEY,
    },
  },

  // Arbitrum configuration
  arbitrum: {
    token: {
      name: "DAO Governance Token",
      symbol: "DGT",
      initialSupply: "100000000",
    },
    dao: {
      quorumNumerator: 10,
      votingPeriodBlocks: 302400, // ~1 week (2s blocks)
    },
    verification: {
      enabled: true,
      apiKey: process.env.ARBISCAN_API_KEY,
    },
  },
};

/**
 * Get configuration for a specific network
 * @param {string} networkName - Name of the network
 * @returns {object} Network-specific configuration
 */
export function getConfig(networkName) {
  const config = deploymentConfig[networkName];
  if (!config) {
    throw new Error(`No configuration found for network: ${networkName}`);
  }
  return config;
}

/**
 * Validate configuration before deployment
 * @param {object} config - Configuration object to validate
 * @throws {Error} If configuration is invalid
 */
export function validateConfig(config) {
  // Validate token configuration
  if (!config.token.name || typeof config.token.name !== 'string') {
    throw new Error('Invalid token name');
  }
  if (!config.token.symbol || typeof config.token.symbol !== 'string') {
    throw new Error('Invalid token symbol');
  }
  if (!config.token.initialSupply || isNaN(config.token.initialSupply)) {
    throw new Error('Invalid initial supply');
  }

  // Validate DAO configuration
  if (!config.dao.quorumNumerator || config.dao.quorumNumerator <= 0 || config.dao.quorumNumerator > 100) {
    throw new Error('Quorum numerator must be between 1 and 100');
  }
  if (!config.dao.votingPeriodBlocks || config.dao.votingPeriodBlocks <= 0) {
    throw new Error('Voting period must be greater than 0');
  }

  return true;
}
