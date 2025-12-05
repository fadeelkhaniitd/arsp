import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  log("Deploying OracleHub...");
  const oracle = await deploy("OracleHub", {
    from: deployer,
    args: [300], // maxSnapshotAge = 300 seconds (not used yet in v0 logic)
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
      10, // challengeWindowBlocks
    ],
    log: true,
  });

  // Wire SettlementManager into Vault and NFTVault
  const vaultContract = await ethers.getContractAt("Vault", vault.address);
  await vaultContract.setSettlementManager(settlement.address);

  const nftVaultContract = await ethers.getContractAt("NFTVault", nftVault.address);
  await nftVaultContract.setSettlementManager(settlement.address);

  log("Settlement system deployed:");
  log(`  OracleHub:         ${oracle.address}`);
  log(`  Vault:             ${vault.address}`);
  log(`  NFTVault:          ${nftVault.address}`);
  log(`  SettlementManager: ${settlement.address}`);
};

export default func;
func.tags = ["Settlement"];
