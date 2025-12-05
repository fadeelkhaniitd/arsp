"use client";

import { useState } from "react";
import { Address } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

type BundleJson = {
  epochId: string;
  settlementHash: string;
  feeToken: string;
  transfers: {
    token: string;
    from: string;
    to: string;
    amount: string; // wei
    tokenId: string; // wei
    isERC721: boolean;
  }[];
  intent: {
    party: string;
    nonce: string;
    expiry: string;
    feeToken: string;
    feeAmount: string;
    settlementHash: string;
    signature: string;
  };
};

export default function SubmitSettlementPage() {
  const { address: connectedAddress } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const { data: settlementInfo } = useDeployedContractInfo("SettlementManager");

  const [rawJson, setRawJson] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  const settlementAddr = settlementInfo?.address as Address | undefined;
  const settlementAbi = settlementInfo?.abi;

  const ensureReady = () => {
    if (!settlementAddr || !settlementAbi) {
      throw new Error("SettlementManager not loaded.");
    }
    if (!publicClient) {
      throw new Error("Public client not available.");
    }
    if (!connectedAddress) {
      throw new Error("Connect a wallet as submitter.");
    }
  };

  const handleSubmit = async () => {
    try {
      setStatus("Parsing intents JSON...");
      ensureReady();

      if (!rawJson.trim()) {
        throw new Error("Paste at least one intent JSON bundle.");
      }

      let parsed: any;
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        throw new Error("Invalid JSON. Make sure you pasted valid JSON.");
      }

      const bundles: BundleJson[] = Array.isArray(parsed) ? parsed : [parsed];
      if (bundles.length === 0) {
        throw new Error("No bundles found in JSON.");
      }

      const epochIdStr = bundles[0].epochId;
      const epochId = BigInt(epochIdStr);
      const settlementHash = bundles[0].settlementHash;
      const transfersJson = bundles[0].transfers;

      for (const b of bundles) {
        if (b.epochId !== epochIdStr) {
          throw new Error("All bundles must have the same epochId.");
        }
        if (b.settlementHash.toLowerCase() !== settlementHash.toLowerCase()) {
          throw new Error("All bundles must have the same settlementHash.");
        }
      }

      const transfersForContract = transfersJson.map(t => ({
        token: t.token as Address,
        from: t.from as Address,
        to: t.to as Address,
        amount: BigInt(t.amount),
        tokenId: BigInt(t.tokenId),
        isERC721: t.isERC721,
      }));

      const intentsForContract = bundles.map(b => ({
        party: b.intent.party as Address,
        nonce: BigInt(b.intent.nonce),
        expiry: BigInt(b.intent.expiry),
        epochId,
        settlementHash,
        feeToken: b.intent.feeToken as Address,
        feeAmount: BigInt(b.intent.feeAmount),
        signature: b.intent.signature as `0x${string}`,
      }));

      // 🔍 simulate first to get revert reason if any
      setStatus("Simulating submitSettlement (to check for errors)...");
      await publicClient!.simulateContract({
        address: settlementAddr!,
        abi: settlementAbi!,
        functionName: "submitSettlement",
        args: [epochId, transfersForContract, intentsForContract],
        account: connectedAddress!, // important
      });

      // If simulation passed, actually send the tx
      setStatus("Simulation passed. Sending transaction...");
      const txHash = await writeContractAsync({
        address: settlementAddr!,
        abi: settlementAbi!,
        functionName: "submitSettlement",
        args: [epochId, transfersForContract, intentsForContract],
      });

      setStatus(`Settlement submitted successfully. Tx hash: ${txHash}`);
    } catch (err: any) {
      console.error(err);
      // viem usually puts the revert string into err.shortMessage
      setStatus(err?.shortMessage || err?.message || "Error submitting settlement.");
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto mt-10 p-6 border rounded-2xl shadow">
      <h1 className="text-2xl font-bold">Submit Settlement</h1>
      <p className="text-sm text-gray-500">
        Paste one or more JSON <b>intent bundles</b> generated from the <code>/sign-intent</code> page. All bundles must
        have the same <code>epochId</code> and <code>settlementHash</code>. Your connected wallet will act as the{" "}
        <b>submitter</b>, and must have staked ETH in <code>SettlementManager</code>.
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Intent bundles JSON</span>
        <textarea
          className="textarea textarea-bordered w-full h-64 text-xs font-mono"
          placeholder='[ { "epochId": "...", "settlementHash": "...", ... }, ... ]'
          value={rawJson}
          onChange={e => setRawJson(e.target.value)}
        />
      </label>

      <button className="btn btn-primary" disabled={!connectedAddress} onClick={handleSubmit}>
        Submit settlement as current wallet
      </button>

      <div className="text-sm text-gray-700 whitespace-pre-wrap break-all mt-2">{status}</div>
    </div>
  );
}
