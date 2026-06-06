import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';

const deflate = promisify(zlib.deflate);
const inflate = promisify(zlib.inflate);

// ─── helpers ────────────────────────────────────────────────────────────────

function readData(filename: string): Buffer {
  return fs.readFileSync(path.resolve(__dirname, '../data', filename));
}

async function compress(buf: Buffer): Promise<Buffer> {
  return deflate(buf);
}

async function decompress(buf: Buffer): Promise<Buffer> {
  return inflate(buf);
}

function fmtGas(gas: bigint): string {
  return gas.toLocaleString();
}

function gasToEth(gas: bigint, gwei: number): string {
  return (Number(gas) * gwei * 1e-9).toFixed(6);
}

function printGasTable(rows: { label: string; bytes: number; gas: bigint }[]): void {
  const gweiPrices = [10, 30, 50];
  console.log();
  console.log('  ┌─────────────────────────────────┬──────────────┬──────────────┬─────────────┬─────────────┬─────────────┐');
  console.log('  │ Operation                       │  Bytes stored│    Gas used  │ ETH @10gwei │ ETH @30gwei │ ETH @50gwei │');
  console.log('  ├─────────────────────────────────┼──────────────┼──────────────┼─────────────┼─────────────┼─────────────┤');
  for (const r of rows) {
    const label = r.label.padEnd(31);
    const bytes = String(r.bytes).padStart(12);
    const gas   = fmtGas(r.gas).padStart(12);
    const eths  = gweiPrices.map(g => gasToEth(r.gas, g).padStart(11));
    console.log(`  │ ${label} │ ${bytes} │ ${gas} │ ${eths[0]} │ ${eths[1]} │ ${eths[2]} │`);
  }
  if (rows.length === 2) {
    const savings = rows[0].gas - rows[1].gas;
    const pct     = ((Number(savings) / Number(rows[0].gas)) * 100).toFixed(1);
    console.log('  ├─────────────────────────────────┼──────────────┼──────────────┼─────────────┼─────────────┼─────────────┤');
    const savLabel = `Gas saved (${pct}%)`.padEnd(31);
    const savGas   = fmtGas(savings).padStart(12);
    const savEths  = gweiPrices.map(g => gasToEth(savings, g).padStart(11));
    console.log(`  │ ${savLabel} │              │ ${savGas} │ ${savEths[0]} │ ${savEths[1]} │ ${savEths[2]} │`);
  }
  console.log('  └─────────────────────────────────┴──────────────┴──────────────┴─────────────┴─────────────┴─────────────┘');
  console.log();
}

// ─── RaxcAuditReport — report.md ────────────────────────────────────────────

describe('RaxcAuditReport', () => {
  let owner: SignerWithAddress;
  let other: SignerWithAddress;
  let auditReport: any;

  const RAW_MD = readData('report.md');

  before(async () => {
    [owner, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('RaxcAuditReport');
    auditReport = await Factory.deploy();
  });

  describe('createAudit', () => {
    it('increments recordCount and emits AuditCreated', async () => {
      await expect(auditReport.connect(owner).createAudit('DemoVault'))
        .to.emit(auditReport, 'AuditCreated')
        .withArgs(0n, owner.address, 'DemoVault', anyValue);

      expect(await auditReport.recordCount()).to.equal(1n);
    });
  });

  describe('finalizeAudit — compress report.md on-chain', () => {
    let compressed: Buffer;
    let taskId: bigint;
    let uploadGasCompressed: bigint;

    before(async () => {
      compressed = await compress(RAW_MD);
      // create a fresh audit task
      await auditReport.connect(owner).createAudit('DemoVault');
      // taskId is recordCount - 1 after creation
      taskId = (await auditReport.recordCount()) - 1n;
    });

    it('stores compressed report.md bytes on-chain and captures gas', async () => {
      // RiskLevel.High = 3, confidence = 77
      const tx = await auditReport.connect(owner).finalizeAudit(
        taskId,
        3,
        77,
        'Reentrancy',
        compressed
      );
      const receipt = await tx.wait();
      uploadGasCompressed = receipt!.gasUsed;
      console.log(`\n  ⛽  finalizeAudit (compressed ${compressed.length} bytes): ${fmtGas(uploadGasCompressed)} gas`);
      await expect(tx).to.emit(auditReport, 'AuditFinalized');
    });

    it('getReport returns the exact compressed bytes that were stored', async () => {
      const stored = await auditReport.getReport(taskId);
      expect(ethers.getBytes(stored)).to.deep.equal(new Uint8Array(compressed));
    });

    it('decompressed bytes match the original report.md file', async () => {
      const stored = await auditReport.getReport(taskId);
      const decompressed = await decompress(Buffer.from(ethers.getBytes(stored)));
      expect(decompressed.toString('utf8')).to.equal(RAW_MD.toString('utf8'));
    });

    it('verifyReport returns true for the stored compressed bytes', async () => {
      const ok = await auditReport.verifyReport(taskId, compressed);
      expect(ok).to.be.true;
    });

    it('verifyReport returns false for tampered bytes', async () => {
      const tampered = Buffer.from(compressed);
      tampered[tampered.length - 1] ^= 0xff;
      const ok = await auditReport.verifyReport(taskId, tampered);
      expect(ok).to.be.false;
    });

    it('getAudit record has correct fields', async () => {
      const record = await auditReport.getAudit(taskId);
      expect(record.contractName).to.equal('DemoVault');
      expect(record.riskLevel).to.equal(3n);        // High
      expect(record.confidence).to.equal(77n);
      expect(record.vulnerabilityType).to.equal('Reentrancy');
      expect(record.completedAt).to.be.greaterThan(0n);
    });

    it('reportHash equals keccak256 of the compressed bytes', async () => {
      const record = await auditReport.getAudit(taskId);
      const expected = ethers.keccak256(compressed);
      expect(record.reportHash).to.equal(expected);
    });
  });

  describe('⛽ gas report — raw vs compressed upload', () => {
    it('prints gas comparison for raw report.md vs compressed', async () => {
      const compressed = await compress(RAW_MD);

      // raw upload
      const txCreate = await auditReport.connect(owner).createAudit('GasTest-Raw');
      await txCreate.wait();
      const rawTaskId = (await auditReport.recordCount()) - 1n;
      const txRaw = await auditReport.connect(owner).finalizeAudit(rawTaskId, 3, 77, 'Reentrancy', RAW_MD);
      const rawReceipt = await txRaw.wait();
      const gasRaw = rawReceipt!.gasUsed;

      // compressed upload
      const txCreate2 = await auditReport.connect(owner).createAudit('GasTest-Compressed');
      await txCreate2.wait();
      const compTaskId = (await auditReport.recordCount()) - 1n;
      const txComp = await auditReport.connect(owner).finalizeAudit(compTaskId, 3, 77, 'Reentrancy', compressed);
      const compReceipt = await txComp.wait();
      const gasComp = compReceipt!.gasUsed;

      printGasTable([
        { label: 'finalizeAudit (raw report.md)',        bytes: RAW_MD.length,    gas: gasRaw  },
        { label: 'finalizeAudit (compressed report.md)', bytes: compressed.length, gas: gasComp },
      ]);

      expect(gasComp).to.be.lessThan(gasRaw);
    });
  });

  describe('access control', () => {
    it('cannot finalize a non-existent task', async () => {
      await expect(
        auditReport.finalizeAudit(999, 1, 50, 'None', ethers.toUtf8Bytes('x'))
      ).to.be.revertedWith('Task does not exist');
    });

    it('cannot finalize the same task twice', async () => {
      const taskId = (await auditReport.recordCount()) - 1n;
      const compressed = await compress(RAW_MD);
      await expect(
        auditReport.connect(owner).finalizeAudit(taskId, 3, 77, 'Reentrancy', compressed)
      ).to.be.revertedWith('Already finalized');
    });

    it('getTasksByRequester returns the correct task IDs', async () => {
      const tasks = await auditReport.getTasksByRequester(owner.address);
      expect(tasks.length).to.be.greaterThanOrEqual(1);
    });
  });
});

// ─── RaxcAgentMemory — memory.json ──────────────────────────────────────────

describe('RaxcAgentMemory', () => {
  let owner: SignerWithAddress;
  let agent: SignerWithAddress;
  let other: SignerWithAddress;
  let agentMemory: any;

  const RAW_JSON = readData('memory.json');
  const DESCRIPTION = 'RAXC Audit: DeFiVault 2026-06-01';

  before(async () => {
    [owner, agent, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('RaxcAgentMemory');
    agentMemory = await Factory.deploy();
  });

  describe('mint', () => {
    it('only owner can mint', async () => {
      await expect(
        agentMemory.connect(other).mint(other.address, other.address)
      ).to.be.reverted;
    });

    it('mints token 0 and emits AgentMinted', async () => {
      await expect(agentMemory.connect(owner).mint(owner.address, agent.address))
        .to.emit(agentMemory, 'AgentMinted')
        .withArgs(0n, owner.address, agent.address);

      expect(await agentMemory.agentAddress(0n)).to.equal(agent.address);
      expect(await agentMemory.ownerOf(0n)).to.equal(owner.address);
    });
  });

  describe('pushMemory — compress memory.json on-chain', () => {
    let compressed: Buffer;
    const TOKEN_ID = 0n;

    before(async () => {
      compressed = await compress(RAW_JSON);
    });

    it('agent wallet can push compressed memory.json and captures gas', async () => {
      const tx = await agentMemory.connect(agent).pushMemory(TOKEN_ID, compressed, DESCRIPTION);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed;
      console.log(`\n  ⛽  pushMemory (compressed ${compressed.length} bytes): ${fmtGas(gasUsed)} gas`);
      await expect(tx).to.emit(agentMemory, 'MemoryPushed');
    });

    it('memoryCount increments to 1', async () => {
      expect(await agentMemory.memoryCount(TOKEN_ID)).to.equal(1n);
    });

    it('getMemoryAt(0) returns the exact compressed bytes', async () => {
      const entry = await agentMemory.getMemoryAt(TOKEN_ID, 0n);
      expect(ethers.getBytes(entry.summaryJson)).to.deep.equal(new Uint8Array(compressed));
    });

    it('decompressed summaryJson matches the original memory.json file', async () => {
      const entry = await agentMemory.getMemoryAt(TOKEN_ID, 0n);
      const decompressed = await decompress(Buffer.from(ethers.getBytes(entry.summaryJson)));
      expect(JSON.parse(decompressed.toString('utf8'))).to.deep.equal(
        JSON.parse(RAW_JSON.toString('utf8'))
      );
    });

    it('contentHash equals keccak256 of the compressed bytes', async () => {
      const entry = await agentMemory.getMemoryAt(TOKEN_ID, 0n);
      const expected = ethers.keccak256(compressed);
      expect(entry.contentHash).to.equal(expected);
    });

    it('verifyMemory returns true for stored bytes', async () => {
      const ok = await agentMemory.verifyMemory(TOKEN_ID, 0n, compressed);
      expect(ok).to.be.true;
    });

    it('verifyMemory returns false for tampered bytes', async () => {
      const tampered = Buffer.from(compressed);
      tampered[0] ^= 0xff;
      const ok = await agentMemory.verifyMemory(TOKEN_ID, 0n, tampered);
      expect(ok).to.be.false;
    });

    it('description is stored correctly', async () => {
      const entry = await agentMemory.getMemoryAt(TOKEN_ID, 0n);
      expect(entry.description).to.equal(DESCRIPTION);
    });
  });

  describe('⛽ gas report — raw vs compressed upload', () => {
    const TOKEN_ID_GAS = 1n;

    before(async () => {
      // mint a fresh token for gas tests
      await agentMemory.connect(owner).mint(owner.address, agent.address);
    });

    it('prints gas comparison for raw memory.json vs compressed', async () => {
      const compressed = await compress(RAW_JSON);

      // raw upload
      const txRaw = await agentMemory.connect(agent).pushMemory(TOKEN_ID_GAS, RAW_JSON, 'raw');
      const rawReceipt = await txRaw.wait();
      const gasRaw = rawReceipt!.gasUsed;

      // compressed upload
      const txComp = await agentMemory.connect(agent).pushMemory(TOKEN_ID_GAS, compressed, 'compressed');
      const compReceipt = await txComp.wait();
      const gasComp = compReceipt!.gasUsed;

      printGasTable([
        { label: 'pushMemory (raw memory.json)',        bytes: RAW_JSON.length,    gas: gasRaw  },
        { label: 'pushMemory (compressed memory.json)', bytes: compressed.length, gas: gasComp },
      ]);

      expect(gasComp).to.be.lessThan(gasRaw);
    });
  });

  describe('getRecentMemory — multiple entries', () => {
    const TOKEN_ID = 0n;

    before(async () => {
      // push 2 more entries so we have 3 total
      const c = await compress(RAW_JSON);
      await agentMemory.connect(agent).pushMemory(TOKEN_ID, c, 'Entry 2');
      await agentMemory.connect(agent).pushMemory(TOKEN_ID, c, 'Entry 3');
    });

    it('memoryCount is 3 after three pushes', async () => {
      expect(await agentMemory.memoryCount(TOKEN_ID)).to.equal(3n);
    });

    it('getRecentMemory(2) returns the 2 newest entries', async () => {
      const recent = await agentMemory.getRecentMemory(TOKEN_ID, 2n);
      expect(recent.length).to.equal(2);
      expect(recent[0].description).to.equal('Entry 2');
      expect(recent[1].description).to.equal('Entry 3');
    });

    it('getRecentMemory(10) caps at total count', async () => {
      const all = await agentMemory.getRecentMemory(TOKEN_ID, 10n);
      expect(all.length).to.equal(3);
    });

    it('getMemory returns full history', async () => {
      const all = await agentMemory.getMemory(TOKEN_ID);
      expect(all.length).to.equal(3);
    });
  });

  describe('access control', () => {
    const TOKEN_ID = 0n;

    it('unauthorized wallet cannot push memory', async () => {
      await expect(
        agentMemory.connect(other).pushMemory(TOKEN_ID, ethers.toUtf8Bytes('{}'), 'bad')
      ).to.be.revertedWith('Not authorized');
    });

    it('token owner can also push memory', async () => {
      const c = await compress(RAW_JSON);
      await expect(
        agentMemory.connect(owner).pushMemory(TOKEN_ID, c, 'Owner push')
      ).to.emit(agentMemory, 'MemoryPushed');
    });

    it('token owner can update agent address', async () => {
      await agentMemory.connect(owner).setAgentAddress(TOKEN_ID, other.address);
      expect(await agentMemory.agentAddress(TOKEN_ID)).to.equal(other.address);
    });

    it('non-owner cannot update agent address', async () => {
      await expect(
        agentMemory.connect(agent).setAgentAddress(TOKEN_ID, agent.address)
      ).to.be.revertedWith('Not token owner');
    });

    it('cannot push empty memory', async () => {
      await expect(
        agentMemory.connect(owner).pushMemory(TOKEN_ID, '0x', 'empty')
      ).to.be.revertedWith('Empty memory');
    });

    it('cannot query non-existent token', async () => {
      await expect(agentMemory.getMemory(999n)).to.be.revertedWith('Token does not exist');
    });
  });
});
