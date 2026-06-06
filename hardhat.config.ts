import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-gas-reporter"
import dotenv from 'dotenv';
dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      outputSelection: {
        "*": {
          "*": ["storageLayout"],
        },
      },
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  gasReporter: {
    enabled: false,
  },
  networks: {
    hardhat: {
      allowBlocksWithSameTimestamp: true,
    },
    mainnet: {
      url: process.env.MAINNET! || "",
      accounts: [process.env.PRIVATE_KEY!]
    },
    holesky: {
      url: process.env.HOLESKY! || "",
      accounts: [process.env.PRIVATE_KEY!]
    },
    sepolia: {
      url: process.env.SEPOLIA! || "",
      accounts: [process.env.PRIVATE_KEY!]
    },
    arbitrumSepolia: {
      url: process.env.ARBITRUM_SEPOLIA! || "",
      accounts: [process.env.PRIVATE_KEY!]
    }
  },
  etherscan: {
    apiKey: {
      mainnet:         process.env.ETHERSCAN_API_KEY! || "",
      holesky:         process.env.ETHERSCAN_API_KEY! || "",
      sepolia:         process.env.ETHERSCAN_API_KEY! || "",
      arbitrumSepolia: process.env.ARBISCAN_API_KEY!  || "",
    },
    customChains: [
      {
        network: "holesky",
        chainId: 17000,
        urls: {
          apiURL: "https://api-holesky.etherscan.io/api",
          browserURL: "https://holesky.etherscan.io"
        }
      },
      {
        network: "arbitrumSepolia",
        chainId: 421614,
        urls: {
          apiURL: "https://api-sepolia.arbiscan.io/api",
          browserURL: "https://sepolia.arbiscan.io"
        }
      }
    ]
  }
};

export default config;
