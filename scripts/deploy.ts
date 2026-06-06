import hre, { ethers } from 'hardhat';

// ─── config ──────────────────────────────────────────────────────────────────
// Set AGENT_ADDRESS in .env or override here.
// This wallet will be authorized to call pushMemory() on token 0.
const AGENT_ADDRESS: string = process.env.AGENT_ADDRESS ?? '';

// ─── helpers ─────────────────────────────────────────────────────────────────
async function deployAndVerify(
  name: string,
  constructorArgs: unknown[] = []
): Promise<string> {
  console.log(`\nDeploying ${name}...`);
  const Factory = await ethers.getContractFactory(name);
  const contract = await Factory.deploy(...constructorArgs);

  const deployTx = contract.deploymentTransaction();
  console.log(`  tx hash : ${deployTx?.hash}`);

  await deployTx?.wait(3);
  const address = await contract.getAddress();
  console.log(`  address : ${address}`);

  try {
    await hre.run('verify:verify', {
      address,
      contract: `contracts/${name}.sol:${name}`,
      constructorArguments: constructorArgs,
    });
    console.log(`  verified on Etherscan ✔`);
  } catch (e: any) {
    if (e?.message?.includes('Already Verified')) {
      console.log(`  already verified ✔`);
    } else {
      console.warn(`  verification failed:`, e?.message ?? e);
    }
  }

  return address;
}

// ─── main ────────────────────────────────────────────────────────────────────
const deploy = async () => {
  const [deployer] = await ethers.getSigners();
  const network = hre.network.name;
  console.log(`Network  : ${network}`);
  console.log(`Deployer : ${deployer.address}`);
  console.log(`Balance  : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  // 1. Deploy RaxcAuditReport (no constructor args)
  const auditReportAddress = await deployAndVerify('RaxcAuditReport');

  // 2. Deploy RaxcAgentMemory (Ownable — deployer becomes owner)
  const agentMemoryAddress = await deployAndVerify('RaxcAgentMemory');

  // 3. Optionally mint token 0 if AGENT_ADDRESS is provided
  if (AGENT_ADDRESS && AGENT_ADDRESS !== '') {
    console.log(`\nMinting agent token 0 → owner: ${deployer.address}, agent: ${AGENT_ADDRESS}`);
    const agentMemory = await ethers.getContractAt('RaxcAgentMemory', agentMemoryAddress);
    const mintTx = await agentMemory.mint(deployer.address, AGENT_ADDRESS);
    await mintTx.wait(1);
    console.log(`  token 0 minted ✔  (tx: ${mintTx.hash})`);
  } else {
    console.log(`\n  Skipping mint — set AGENT_ADDRESS in .env to auto-mint token 0.`);
  }

  // ─── summary ───────────────────────────────────────────────────────────────
  console.log('\n========== Deployment Summary ==========');
  console.log(`Network         : ${network}`);
  console.log(`RaxcAuditReport : ${auditReportAddress}`);
  console.log(`RaxcAgentMemory : ${agentMemoryAddress}`);
  if (AGENT_ADDRESS) {
    console.log(`Agent wallet    : ${AGENT_ADDRESS}  (token 0)`);
  }
  console.log('========================================\n');
};

deploy().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
