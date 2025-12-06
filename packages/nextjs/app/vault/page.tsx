"use client";

import { useState } from "react";
import { Address, parseUnits } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

// Minimal ERC20 ABI
const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

// Minimal ERC721 ABI
const erc721Abi = [
  {
    type: "function",
    name: "setApprovalForAll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

export default function VaultPage() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const { data: vaultInfo } = useDeployedContractInfo("Vault");
  const { data: nftVaultInfo } = useDeployedContractInfo("NFTVault");

  const vaultAddr = vaultInfo?.address as Address | undefined;
  const vaultAbi = vaultInfo?.abi;
  const nftVaultAddr = nftVaultInfo?.address as Address | undefined;
  const nftVaultAbi = nftVaultInfo?.abi;

  // ERC20 state
  const [erc20Token, setErc20Token] = useState("");
  const [erc20Amount, setErc20Amount] = useState("0");
  const [erc20WithdrawAmount, setErc20WithdrawAmount] = useState("0");
  const [erc20Decimals, setErc20Decimals] = useState<number | null>(null);

  // ERC721 state
  const [nftToken, setNftToken] = useState("");
  const [nftTokenIdDeposit, setNftTokenIdDeposit] = useState("");
  const [nftTokenIdWithdraw, setNftTokenIdWithdraw] = useState("");

  const [status, setStatus] = useState("");

  function ensureReady() {
    if (!address) throw new Error("Connect wallet first.");
    if (!publicClient) throw new Error("Public client not available.");
    if (!vaultAddr || !vaultAbi) throw new Error("Vault contract not loaded.");
    if (!nftVaultAddr || !nftVaultAbi) throw new Error("NFTVault contract not loaded.");
  }

  // Helper: fetch decimals lazily for given ERC20
  const getTokenDecimals = async (token: string): Promise<number> => {
    if (erc20Decimals !== null && token.toLowerCase() === erc20Token.toLowerCase()) {
      return erc20Decimals;
    }
    const dec = (await publicClient!.readContract({
      address: token as Address,
      abi: erc20Abi,
      functionName: "decimals",
    })) as number;
    setErc20Decimals(dec);
    return dec;
  };

  // ---------------- ERC20: Deposit (approve + deposit) ----------------

  const handleDepositErc20 = async () => {
    try {
      ensureReady();
      if (!erc20Token) throw new Error("ERC20 token address required.");
      if (!erc20Amount || Number(erc20Amount) <= 0) throw new Error("Deposit amount must be > 0.");

      const dec = await getTokenDecimals(erc20Token);
      const amount = parseUnits(erc20Amount, dec);

      // 1) Approve
      setStatus(`Approving Vault to spend your ERC20 (decimals = ${dec})...`);
      const approveHash = await writeContractAsync({
        address: erc20Token as Address,
        abi: erc20Abi,
        functionName: "approve",
        args: [vaultAddr!, amount],
      });

      await publicClient!.waitForTransactionReceipt({ hash: approveHash });

      // 2) Deposit
      setStatus("Approval mined. Depositing into Vault...");
      const depositHash = await writeContractAsync({
        address: vaultAddr!,
        abi: vaultAbi!,
        functionName: "deposit",
        args: [erc20Token as Address, amount],
      });

      setStatus(`ERC20 deposit tx: ${depositHash}`);
    } catch (err: any) {
      console.error(err);
      setStatus(err?.shortMessage || err?.message || "Error depositing ERC20.");
    }
  };

  // ---------------- ERC20: Withdraw ----------------

  const handleWithdrawErc20 = async () => {
    try {
      ensureReady();
      if (!erc20Token) throw new Error("ERC20 token address required.");
      if (!erc20WithdrawAmount || Number(erc20WithdrawAmount) <= 0) {
        throw new Error("Withdraw amount must be > 0.");
      }

      const dec = await getTokenDecimals(erc20Token);
      const amount = parseUnits(erc20WithdrawAmount, dec);

      setStatus("Withdrawing from Vault...");
      const txHash = await writeContractAsync({
        address: vaultAddr!,
        abi: vaultAbi!,
        functionName: "withdraw",
        args: [erc20Token as Address, amount],
      });

      setStatus(`ERC20 withdraw tx: ${txHash}`);
    } catch (err: any) {
      console.error(err);
      setStatus(err?.shortMessage || err?.message || "Error withdrawing ERC20.");
    }
  };

  // ---------------- ERC721: Deposit (setApprovalForAll + deposit) ----------------

  const handleDepositNft = async () => {
    try {
      ensureReady();
      if (!nftToken) throw new Error("NFT token address required.");
      if (!nftTokenIdDeposit) throw new Error("NFT tokenId required.");
      const tokenIdBig = BigInt(nftTokenIdDeposit);

      setStatus("Approving NFTVault to manage your NFTs...");
      const approveHash = await writeContractAsync({
        address: nftToken as Address,
        abi: erc721Abi,
        functionName: "setApprovalForAll",
        args: [nftVaultAddr!, true],
      });

      await publicClient!.waitForTransactionReceipt({ hash: approveHash });

      setStatus("Approval mined. Depositing NFT into NFTVault...");
      const txHash = await writeContractAsync({
        address: nftVaultAddr!,
        abi: nftVaultAbi!,
        functionName: "deposit",
        args: [nftToken as Address, tokenIdBig],
      });

      setStatus(`NFT deposit tx: ${txHash}`);
    } catch (err: any) {
      console.error(err);
      setStatus(err?.shortMessage || err?.message || "Error depositing NFT.");
    }
  };

  // ---------------- ERC721: Withdraw ----------------

  const handleWithdrawNft = async () => {
    try {
      ensureReady();
      if (!nftToken) throw new Error("NFT token address required.");
      if (!nftTokenIdWithdraw) throw new Error("NFT tokenId required.");
      const tokenIdBig = BigInt(nftTokenIdWithdraw);

      setStatus("Withdrawing NFT from NFTVault...");
      const txHash = await writeContractAsync({
        address: nftVaultAddr!,
        abi: nftVaultAbi!,
        functionName: "withdraw",
        args: [nftToken as Address, tokenIdBig],
      });

      setStatus(`NFT withdraw tx: ${txHash}`);
    } catch (err: any) {
      console.error(err);
      setStatus(err?.shortMessage || err?.message || "Error withdrawing NFT.");
    }
  };

  return (
    <div className="max-w-4xl mx-auto mt-10 p-6 flex flex-col gap-8 border rounded-2xl shadow">
      <h1 className="text-2xl font-bold">Vault Funding</h1>

      {/* ERC20 section */}
      <section className="p-4 border rounded-xl flex flex-col gap-3">
        <h2 className="text-lg font-semibold">ERC20 (tokens)</h2>
        <input
          className="input input-bordered"
          placeholder="ERC20 token address"
          value={erc20Token}
          onChange={e => {
            setErc20Token(e.target.value);
            setErc20Decimals(null); // reset cached decimals when token changes
          }}
        />

        <div className="grid grid-cols-2 gap-4">
          {/* Deposit */}
          <div className="flex flex-col gap-2">
            <span className="font-medium">Deposit</span>
            <input
              className="input input-bordered"
              placeholder="Amount (human units)"
              value={erc20Amount}
              onChange={e => setErc20Amount(e.target.value)}
            />
            <button className="btn btn-primary" onClick={handleDepositErc20}>
              Approve & Deposit
            </button>
          </div>

          {/* Withdraw */}
          <div className="flex flex-col gap-2">
            <span className="font-medium">Withdraw</span>
            <input
              className="input input-bordered"
              placeholder="Amount (human units)"
              value={erc20WithdrawAmount}
              onChange={e => setErc20WithdrawAmount(e.target.value)}
            />
            <button className="btn btn-secondary" onClick={handleWithdrawErc20}>
              Withdraw from Vault
            </button>
          </div>
        </div>
      </section>

      {/* ERC721 section */}
      <section className="p-4 border rounded-xl flex flex-col gap-3">
        <h2 className="text-lg font-semibold">ERC721 (NFTs)</h2>
        <input
          className="input input-bordered"
          placeholder="ERC721 token address"
          value={nftToken}
          onChange={e => setNftToken(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-4">
          {/* Deposit NFT */}
          <div className="flex flex-col gap-2">
            <span className="font-medium">Deposit NFT</span>
            <input
              className="input input-bordered"
              placeholder="Token ID"
              value={nftTokenIdDeposit}
              onChange={e => setNftTokenIdDeposit(e.target.value)}
            />
            <button className="btn btn-primary" onClick={handleDepositNft}>
              Approve & Deposit
            </button>
          </div>

          {/* Withdraw NFT */}
          <div className="flex flex-col gap-2">
            <span className="font-medium">Withdraw NFT</span>
            <input
              className="input input-bordered"
              placeholder="Token ID"
              value={nftTokenIdWithdraw}
              onChange={e => setNftTokenIdWithdraw(e.target.value)}
            />
            <button className="btn btn-secondary" onClick={handleWithdrawNft}>
              Withdraw from NFTVault
            </button>
          </div>
        </div>
      </section>

      <div className="text-sm text-gray-700">{status}</div>
    </div>
  );
}
