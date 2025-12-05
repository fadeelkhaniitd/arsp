import { ethers } from "hardhat";

async function main() {
  const [alice, bob, submitter] = await ethers.getSigners();

  const settlementManager = (await ethers.getContract("SettlementManager")) as any;
  const vault = (await ethers.getContract("Vault")) as any;
  const testToken = (await ethers.getContract("TestToken")) as any;
  const oracleHub = (await ethers.getContract("OracleHub")) as any;

  console.log("Alice:", alice.address);
  console.log("Bob:", bob.address);
  console.log("Submitter:", submitter.address);

  // 1. Mint TestToken to Alice and deposit into Vault
  const amountAlice = ethers.parseEther("1000");
  console.log("Minting to Alice...");
  await (await testToken.connect(alice).mint(alice.address, amountAlice)).wait();

  console.log("Approving Vault from Alice...");
  await (await testToken.connect(alice).approve(vault.target, amountAlice)).wait();

  console.log("Depositing into Vault from Alice...");
  await (await vault.connect(alice).deposit(testToken.target, amountAlice)).wait();

  // 2. Set oracle price and epoch
  console.log("Setting oracle price...");
  await (await oracleHub.setPrice(testToken.target, ethers.parseEther("1"))).wait();
  const currentEpoch: bigint = await oracleHub.currentEpoch();
  console.log("Current epoch:", currentEpoch.toString());

  // 3. Stake some ETH as submitter
  console.log("Staking by submitter...");
  await (
    await settlementManager.connect(submitter).stake({
      value: ethers.parseEther("0.2"),
    })
  ).wait();

  // 4. Build AssetTransfer[]: Alice -> Bob 100 TST, Alice -> submitter 1 TST (fee)
  const tradeAmount = ethers.parseEther("100");
  const feeAmount = ethers.parseEther("1");

  const transfers = [
    {
      token: testToken.target as string,
      from: alice.address,
      to: bob.address,
      amount: tradeAmount,
      tokenId: 0n,
      isERC721: false,
    },
    {
      token: testToken.target as string,
      from: alice.address,
      to: submitter.address,
      amount: feeAmount,
      tokenId: 0n,
      isERC721: false,
    },
  ];

  // 5. Ask the contract for the settlementHash
  const settlementHash: string = await settlementManager.computeSettlementHash(currentEpoch, transfers);
  console.log("settlementHash:", settlementHash);

  // 6. Build EIP-712 domain + types
  const network = await ethers.provider.getNetwork();

  const domain = {
    name: "SettlementManager",
    version: "1",
    chainId: Number(network.chainId),
    verifyingContract: settlementManager.target as string,
  };

  const types = {
    UserIntent: [
      { name: "party", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "expiry", type: "uint256" },
      { name: "epochId", type: "uint256" },
      { name: "settlementHash", type: "bytes32" },
    ],
  };

  // 7. Build intents for Alice and Bob
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600; // 1 hour
  const epochId = currentEpoch;

  const aliceIntent = {
    party: alice.address,
    nonce: 1,
    expiry,
    epochId,
    settlementHash,
  };

  const bobIntent = {
    party: bob.address,
    nonce: 1,
    expiry,
    epochId,
    settlementHash,
  };

  // 8. Sign typed data with Alice & Bob
  // ethers v6: signer.signTypedData(domain, types, value)
  const aliceSig = await alice.signTypedData(domain, types, aliceIntent);
  const bobSig = await bob.signTypedData(domain, types, bobIntent);

  console.log("Alice sig:", aliceSig);
  console.log("Bob sig:", bobSig);

  // 9. Build SignedIntent[] to pass to contract
  const intents = [
    {
      party: alice.address,
      nonce: aliceIntent.nonce,
      expiry: BigInt(expiry),
      epochId: epochId,
      settlementHash,
      signature: aliceSig,
    },
    {
      party: bob.address,
      nonce: bobIntent.nonce,
      expiry: BigInt(expiry),
      epochId: epochId,
      settlementHash,
      signature: bobSig,
    },
  ];

  // 10. Submit settlement from submitter
  console.log("Submitting settlement...");
  const tx = await settlementManager.connect(submitter).submitSettlement(epochId, transfers, intents);
  const receipt = await tx.wait();

  console.log("submitSettlement tx hash:", receipt?.hash);

  const nextId: bigint = await settlementManager.nextSettlementId();
  const settlementId = nextId;
  console.log("New settlementId:", settlementId.toString());

  // 11. Inspect Vault balances
  const balAlice = await vault.balanceOf(testToken.target, alice.address);
  const balBob = await vault.balanceOf(testToken.target, bob.address);
  const balSub = await vault.balanceOf(testToken.target, submitter.address);

  console.log("Vault balances after submit (locked, not finalized):");
  console.log("  Alice:", balAlice.toString());
  console.log("  Bob:", balBob.toString());
  console.log("  Submitter:", balSub.toString());

  console.log("Done.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
