const { ethers } = require("ethers");
const dotenv = require('dotenv');
dotenv.config();

const contractName = '';
const data = require(`../artifacts/contracts/${contractName}.sol/${contractName}.json`);

const providerURL = process.env.CHAIN;
const privateKey = process.env.PRIVATE_KEY;
const contractABI = data.abi;

const contractAddress = '';

const execution = async () => {  
  const provider = new ethers.JsonRpcProvider(providerURL);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(contractAddress, contractABI, wallet);
};

execution().catch((error) => {
  console.error("Error deploying contract:", error);
});

