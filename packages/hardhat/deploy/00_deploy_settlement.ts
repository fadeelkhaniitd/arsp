import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  log("Deploying OracleHub...");
  const oracle = await deploy("OracleHub", {
    from: deployer,
    args: [300], // maxSnapshotAge (OracleHub side, not used directly here)
    log: true,
  });

  log("Deploying Vault...");
  const vault = await deploy("Vault", {
    from: deployer,
    args: [],
    log: true,
  });

  log("Deploying NFTVault...");
  const nftVault = await deploy("NFTVault", {
    from: deployer,
    args: [],
    log: true,
  });

  log("Deploying SettlementManager...");
  const settlement = await deploy("SettlementManager", {
    from: deployer,
    args: [
      vault.address,
      nftVault.address,
      oracle.address,
      5, // challengeWindowBlocks
      ethers.parseEther("0.1"), // minSubmitterStake
      ethers.parseEther("0.05"), // slashAmount
      300, // maxSnapshotAge (sec) for fairness
      15000, // maxFairnessRatioBps (1.5x)
    ],
    log: true,
  });

  const vaultContract = await hre.ethers.getContractAt("Vault", vault.address);
  await vaultContract.setSettlementManager(settlement.address);

  const nftVaultContract = await hre.ethers.getContractAt("NFTVault", nftVault.address);
  await nftVaultContract.setSettlementManager(settlement.address);

  log("Settlement system deployed:");
  log(`  OracleHub:         ${oracle.address}`);
  log(`  Vault:             ${vault.address}`);
  log(`  NFTVault:          ${nftVault.address}`);
  log(`  SettlementManager: ${settlement.address}`);
};

export default func;
func.tags = ["Settlement"];
