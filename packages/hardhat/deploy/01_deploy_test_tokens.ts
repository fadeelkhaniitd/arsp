import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  log("Deploying TestToken and TestNFT...");

  const testToken = await deploy("TestToken", {
    from: deployer,
    args: [],
    log: true,
  });

  const testNFT = await deploy("TestNFT", {
    from: deployer,
    args: [],
    log: true,
  });

  log(`TestToken deployed to: ${testToken.address}`);
  log(`TestNFT   deployed to: ${testNFT.address}`);
};

export default func;
func.tags = ["TestTokens"];
