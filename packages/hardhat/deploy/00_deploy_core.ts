import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, network } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  log("----------------------------------------------------");
  log("Deploying Vault, NFTVault, OracleHub, SettlementManager...");

  // 1. Deploy Vault
  const vaultDeployment = await deploy("Vault", {
    from: deployer,
    args: [], // Vault has no constructor args
    log: true,
  });

  // 2. Deploy NFTVault
  const nftVaultDeployment = await deploy("NFTVault", {
    from: deployer,
    args: [], // NFTVault has no constructor args
    log: true,
  });

  // 3. Deploy OracleHub (new version: no constructor args)
  const oracleDeployment = await deploy("OracleHub", {
    from: deployer,
    args: [],
    log: true,
  });

  // 4. Deploy SettlementManager
  //
  // constructor(
  //   address _vault,
  //   address _nftVault,
  //   address _oracleHub,
  //   uint256 _challengeWindowBlocks,
  //   uint256 _minSubmitterStake,
  //   uint256 _slashAmount,
  //   uint256 _maxSnapshotAge,
  //   uint256 _maxFairnessRatioBps
  // )

  const challengeWindowBlocks = 10n; // e.g. ~10 blocks window
  const minSubmitterStake = ethers.parseEther("0.1"); // 0.1 ETH
  const slashAmount = ethers.parseEther("0.05"); // 0.05 ETH
  const maxSnapshotAge = 3600n; // 1 hour
  const maxFairnessRatioBps = 15000n; // 1.5x

  const settlementDeployment = await deploy("SettlementManager", {
    from: deployer,
    args: [
      vaultDeployment.address,
      nftVaultDeployment.address,
      oracleDeployment.address,
      challengeWindowBlocks,
      minSubmitterStake,
      slashAmount,
      maxSnapshotAge,
      maxFairnessRatioBps,
    ],
    log: true,
  });

  // 5. Wire Vault + NFTVault to SettlementManager
  const signer = await ethers.getSigner(deployer);

  const vault = await ethers.getContractAt("Vault", vaultDeployment.address, signer);
  const nftVault = await ethers.getContractAt("NFTVault", nftVaultDeployment.address, signer);

  // These functions should exist in your Vault/NFTVault:
  //   function setSettlementManager(address _m) external;
  //
  // They usually only allow being set once. Since we are deploying
  // fresh contracts, this should succeed.

  const tx1 = await vault.setSettlementManager(settlementDeployment.address);
  await tx1.wait();

  const tx2 = await nftVault.setSettlementManager(settlementDeployment.address);
  await tx2.wait();

  // 6. (Optional) Configure Chainlink feeds for tokens on Sepolia
  //
  // NOTE: You MUST fill in the real token + feed addresses you want.
  // These are just placeholders to show where it goes.

  if (network.name === "sepolia") {
    const oracle = await ethers.getContractAt("OracleHub", oracleDeployment.address, signer);

    // TODO: replace these with the actual token + Chainlink feed addresses
    //
    // Example (pseudo):
    //
    const USDC_TOKEN: string = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"; // USDC on Sepolia
    const ETH_TOKEN: string = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

    const USDC_API3_PROXY: string = "0xD3C586Eec1C6C3eC41D276a23944dea080eDCf7f";
    const ETH_API3_PROXY: string = "0x5b0cf2b36a65a6BB085D501B971e4c102B9Cd473";
    //
    await (oracle as any).setApi3Proxy(USDC_TOKEN, USDC_API3_PROXY);
    await (oracle as any).setApi3Proxy(ETH_TOKEN, ETH_API3_PROXY);

    // You can also leave this block empty and set feeds later via Debug UI.
  }

  log("----------------------------------------------------");
  log(`Vault:              ${vaultDeployment.address}`);
  log(`NFTVault:           ${nftVaultDeployment.address}`);
  log(`OracleHub:          ${oracleDeployment.address}`);
  log(`SettlementManager:  ${settlementDeployment.address}`);
  log("----------------------------------------------------");
};

export default func;
func.tags = ["Core"];
