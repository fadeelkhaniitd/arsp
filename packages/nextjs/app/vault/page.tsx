"use client";

import { useState } from "react";
import { Address, parseEther } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

// Minimal ERC20 ABI (approve + allowance)
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
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// Minimal ERC721 ABI (for direct safeTransfer or approvals if you ever need)
// const erc721Abi = [
//   {
//     type: "function",
//     name: "safeTransferFrom",
//     stateMutability: "nonpayable",
//     inputs: [
//       { name: "from", type: "address" },
//       { name: "to", type: "address" },
//       { name: "tokenId", type: "uint256" },
//     ],
//     outputs: [],
//   },
//   {
//     type: "function",
//     name: "setApprovalForAll",
//     stateMutability: "nonpayable",
//     inputs: [
//       { name: "operator", type: "address" },
//       { name: "approved", type: "bool" },
//     ],
//     outputs: [],
//   },
// ] as const;

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
  const [erc20ApproveAmount, setErc20ApproveAmount] = useState("0");
  const [erc20DepositAmount, setErc20DepositAmount] = useState("0");
  const [erc20WithdrawAmount, setErc20WithdrawAmount] = useState("0");
  const [erc20Allowance, setErc20Allowance] = useState<string | null>(null);

  // ERC721 state
  const [nftToken, setNftToken] = useState("");
  const [nftTokenId, setNftTokenId] = useState("");
  const [nftTokenIdWithdraw, setNftTokenIdWithdraw] = useState("");
  const [nftOwnerCheck, setNftOwnerCheck] = useState<string | null>(null);

  const [status, setStatus] = useState("");

  function ensureReady() {
    if (!address) throw new Error("Connect wallet first.");
    if (!publicClient) throw new Error("Public client not available.");
    if (!vaultAddr || !vaultAbi) throw new Error("Vault contract not loaded.");
    if (!nftVaultAddr || !nftVaultAbi) throw new Error("NFTVault contract not loaded.");
  }

  // ---------------- ERC20: Approve Vault ----------------

  const handleApproveErc20 = async () => {
    try {
      ensureReady();
      if (!erc20Token) throw new Error("ERC20 token address required.");
      const amount = parseEther(erc20ApproveAmount || "0");
      if (amount <= 0n) throw new Error("Approve amount must be > 0.");

      setStatus("Sending ERC20 approve tx...");
      const txHash = await writeContractAsync({
        address: erc20Token as Address,
        abi: erc20Abi,
        functionName: "approve",
        args: [vaultAddr!, amount],
      });

      setStatus(`Approve submitted: ${txHash}`);
    } catch (err: any) {
      console.error(err);
      setStatus(err?.shortMessage || err?.message || "Error approving ERC20.");
    }
  };

  const handleCheckAllowance = async () => {
    try {
      ensureReady();
      if (!erc20Token) throw new Error("ERC20 token address required.");

      const value = (await publicClient!.readContract({
        address: erc20Token as Address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address as Address, vaultAddr!],
      })) as bigint;

      setErc20Allowance(value.toString());
      setStatus("Allowance fetched.");
    } catch (err: any) {
      console.error(err);
      setStatus(err?.shortMessage || err?.message || "Error reading allowance.");
    }
  };

  // ---------------- ERC20: Deposit / Withdraw ----------------

  const handleDepositErc20 = async () => {
    try {
      ensureReady();
      if (!erc20Token) throw new Error("ERC20 token address required.");
      const amount = parseEther(erc20DepositAmount || "0");
      if (amount <= 0n) throw new Error("Deposit amount must be > 0.");

      setStatus("Sending Vault.deposit tx...");
      const txHash = await writeContractAsync({
        address: vaultAddr!,
        abi: vaultAbi!,
        functionName: "deposit",
        args: [erc20Token as Address, amount],
      });

      setStatus(`ERC20 deposit tx: ${txHash}`);
    } catch (err: any) {
      console.error(err);
      setStatus(err?.shortMessage || err?.message || "Error depositing ERC20.");
    }
  };

  const handleWithdrawErc20 = async () => {
    try {
      ensureReady();
      if (!erc20Token) throw new Error("ERC20 token address required.");
      const amount = parseEther(erc20WithdrawAmount || "0");
      if (amount <= 0n) throw new Error("Withdraw amount must be > 0.");

      setStatus("Sending Vault.withdraw tx...");
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

  // ---------------- ERC721: Deposit / Withdraw ----------------

  const handleDepositNft = async () => {
    try {
      ensureReady();
      if (!nftToken) throw new Error("NFT token address required.");
      if (!nftTokenId) throw new Error("NFT tokenId required.");
      const tokenIdBig = BigInt(nftTokenId);

      // We assume NFTVault has: function deposit(address token, uint256 tokenId)
      setStatus("Sending NFTVault.deposit tx...");
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

  const handleWithdrawNft = async () => {
    try {
      ensureReady();
      if (!nftToken) throw new Error("NFT token address required.");
      if (!nftTokenIdWithdraw) throw new Error("NFT tokenId required.");
      const tokenIdBig = BigInt(nftTokenIdWithdraw);

      // We assume NFTVault has: function withdraw(address token, uint256 tokenId)
      setStatus("Sending NFTVault.withdraw tx...");
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

  const handleCheckNftOwner = async () => {
    try {
      ensureReady();
      if (!nftToken) throw new Error("NFT token address required.");
      if (!nftTokenIdWithdraw) throw new Error("NFT tokenId required.");
      const tokenIdBig = BigInt(nftTokenIdWithdraw);

      const owner = (await publicClient!.readContract({
        address: nftVaultAddr!,
        abi: nftVaultAbi!,
        functionName: "ownerOf",
        args: [nftToken as Address, tokenIdBig],
      })) as Address;

      setNftOwnerCheck(owner);
      setStatus("Fetched NFT vault owner.");
    } catch (err: any) {
      console.error(err);
      setStatus(err?.shortMessage || err?.message || "Error checking NFT owner.");
    }
  };

  return (
    <div className="max-w-4xl mx-auto mt-10 p-6 flex flex-col gap-8 border rounded-2xl shadow">
      <h1 className="text-2xl font-bold">Vault / Funding</h1>

      {/* ERC20 APPROVE */}
      <section className="p-4 border rounded-xl flex flex-col gap-3">
        <h2 className="text-lg font-semibold">1. Approve ERC20 for Vault</h2>
        <input
          className="input input-bordered"
          placeholder="ERC20 token address"
          value={erc20Token}
          onChange={e => setErc20Token(e.target.value)}
        />
        <div className="flex gap-3">
          <input
            className="input input-bordered flex-1"
            placeholder="Amount (assumes 18 decimals)"
            value={erc20ApproveAmount}
            onChange={e => setErc20ApproveAmount(e.target.value)}
          />
          <button className="btn btn-outline" onClick={handleApproveErc20}>
            Approve
          </button>
          <button className="btn btn-ghost" onClick={handleCheckAllowance}>
            Check allowance
          </button>
        </div>
        {erc20Allowance !== null && (
          <div className="text-sm text-gray-600">Current allowance for Vault: {erc20Allowance} (raw units)</div>
        )}
      </section>

      {/* ERC20 DEPOSIT / WITHDRAW */}
      <section className="p-4 border rounded-xl flex flex-col gap-3">
        <h2 className="text-lg font-semibold">2. ERC20 Deposit / Withdraw</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <span className="font-medium">Deposit</span>
            <input
              className="input input-bordered"
              placeholder="Amount (assumes 18 decimals)"
              value={erc20DepositAmount}
              onChange={e => setErc20DepositAmount(e.target.value)}
            />
            <button className="btn btn-primary" onClick={handleDepositErc20}>
              Deposit to Vault
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <span className="font-medium">Withdraw</span>
            <input
              className="input input-bordered"
              placeholder="Amount (assumes 18 decimals)"
              value={erc20WithdrawAmount}
              onChange={e => setErc20WithdrawAmount(e.target.value)}
            />
            <button className="btn btn-secondary" onClick={handleWithdrawErc20}>
              Withdraw from Vault
            </button>
          </div>
        </div>
      </section>

      {/* ERC721 DEPOSIT / WITHDRAW */}
      <section className="p-4 border rounded-xl flex flex-col gap-3">
        <h2 className="text-lg font-semibold">3. NFT Deposit / Withdraw</h2>
        <input
          className="input input-bordered"
          placeholder="ERC721 token address"
          value={nftToken}
          onChange={e => setNftToken(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <span className="font-medium">Deposit NFT</span>
            <input
              className="input input-bordered"
              placeholder="Token ID"
              value={nftTokenId}
              onChange={e => setNftTokenId(e.target.value)}
            />
            <button className="btn btn-primary" onClick={handleDepositNft}>
              Deposit to NFTVault
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <span className="font-medium">Withdraw NFT</span>
            <input
              className="input input-bordered"
              placeholder="Token ID"
              value={nftTokenIdWithdraw}
              onChange={e => setNftTokenIdWithdraw(e.target.value)}
            />
            <div className="flex gap-2">
              <button className="btn btn-secondary" onClick={handleWithdrawNft}>
                Withdraw
              </button>
              <button className="btn btn-ghost" onClick={handleCheckNftOwner}>
                Check vault ownerOf
              </button>
            </div>
            {nftOwnerCheck && (
              <div className="text-sm text-gray-600">NFTVault ownerOf(token, tokenId): {nftOwnerCheck}</div>
            )}
          </div>
        </div>
      </section>

      <div className="text-sm text-gray-700">{status}</div>
    </div>
  );
}
