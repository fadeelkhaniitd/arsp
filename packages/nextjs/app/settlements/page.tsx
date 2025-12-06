"use client";

import { useState } from "react";
import { Address } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

type UiTransfer = {
  token: string;
  from: string;
  to: string;
  amount: string;
  tokenId: string;
  isERC721: boolean;
};

type UiFeeLock = {
  party: string;
  token: string; // if your FeeLock has token in struct; if not, drop this
  amount: string;
};

export default function SettlementsPage() {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { data: settlementInfo } = useDeployedContractInfo("SettlementManager");

  const settlementAddr = settlementInfo?.address as Address | undefined;
  const settlementAbi = settlementInfo?.abi;

  const [settlementIdInput, setSettlementIdInput] = useState("0");
  const [loadedId, setLoadedId] = useState<bigint | null>(null);
  const [statusText, setStatusText] = useState("");
  const [epochId, setEpochId] = useState<bigint | null>(null);
  const [commitBlock, setCommitBlock] = useState<bigint | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [submitter, setSubmitter] = useState<string | null>(null);
  const [rawStatus, setRawStatus] = useState<number | null>(null);

  const [transfers, setTransfers] = useState<UiTransfer[]>([]);
  const [feeLocks, setFeeLocks] = useState<UiFeeLock[]>([]);
  const [txStatus, setTxStatus] = useState("");

  function ensureReady() {
    if (!settlementAddr || !settlementAbi) throw new Error("SettlementManager not loaded.");
    if (!publicClient) throw new Error("Public client not available.");
  }

  const statusEnumToText = (n: number | null) => {
    if (n === null) return "Unknown";
    if (n === 0) return "None";
    if (n === 1) return "Pending";
    if (n === 2) return "Finalized";
    if (n === 3) return "Invalid";
    return `Unknown(${n})`;
  };

  const handleLoad = async () => {
    try {
      ensureReady();
      const id = BigInt(settlementIdInput || "0");
      setTxStatus("Loading settlement...");
      setTransfers([]);
      setFeeLocks([]);

      // 1) Summary
      const summary = (await publicClient!.readContract({
        address: settlementAddr!,
        abi: settlementAbi as any,
        functionName: "getSettlementSummary" as any,
        args: [id],
      })) as readonly [number, bigint, bigint, `0x${string}`, Address];

      const [rawStat, epoch, block, sHash, sub] = summary;
      setRawStatus(rawStat);
      setEpochId(epoch);
      setCommitBlock(block);
      setHash(sHash);
      setSubmitter(sub);
      setLoadedId(id);

      // 2) Transfers
      const rawTransfers = (await publicClient!.readContract({
        address: settlementAddr!,
        abi: settlementAbi as any,
        functionName: "getSettlementTransfers" as any,
        args: [id],
      })) as any[];

      const uiTransfers: UiTransfer[] = rawTransfers.map((t: any) => ({
        token: t.token,
        from: t.from,
        to: t.to,
        amount: t.amount?.toString?.() ?? "0",
        tokenId: t.tokenId?.toString?.() ?? "0",
        isERC721: t.isERC721,
      }));

      setTransfers(uiTransfers);

      // 3) Fee locks (if your FeeLock is {party, token, amount})
      const rawFeeLocks = (await publicClient!.readContract({
        address: settlementAddr!,
        abi: settlementAbi as any,
        functionName: "getSettlementFeeLocks" as any,
        args: [id],
      })) as any[];

      const uiFees: UiFeeLock[] = rawFeeLocks.map((f: any) => ({
        party: f.party,
        token: f.token ?? "", // drop this if FeeLock has no token in your version
        amount: f.amount?.toString?.() ?? "0",
      }));

      setFeeLocks(uiFees);
      setStatusText("Loaded.");
      setTxStatus("");
    } catch (err: any) {
      console.error(err);
      setStatusText(err?.shortMessage || err?.message || "Error loading settlement.");
    }
  };

  const handleFinalize = async () => {
    try {
      ensureReady();
      if (loadedId === null) throw new Error("Load a settlement first.");
      setTxStatus("Finalizing settlement...");
      const txHash = await writeContractAsync({
        address: settlementAddr!,
        abi: settlementAbi!,
        functionName: "finalizeSettlement",
        args: [loadedId],
      });
      setTxStatus(`Finalize tx submitted: ${txHash}`);
    } catch (err: any) {
      console.error(err);
      setTxStatus(err?.shortMessage || err?.message || "Error finalizing.");
    }
  };

  const handleChallenge = async () => {
    try {
      ensureReady();
      if (loadedId === null) throw new Error("Load a settlement first.");
      setTxStatus("Challenging settlement...");
      const txHash = await writeContractAsync({
        address: settlementAddr!,
        abi: settlementAbi!,
        functionName: "challengeSettlement",
        args: [loadedId],
      });
      setTxStatus(`Challenge tx submitted: ${txHash}`);
    } catch (err: any) {
      console.error(err);
      setTxStatus(err?.shortMessage || err?.message || "Error challenging.");
    }
  };

  return (
    <div className="max-w-5xl mx-auto mt-10 p-6 border rounded-2xl flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Settlement Explorer</h1>

      <div className="flex gap-3 items-end">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Settlement ID</span>
          <input
            className="input input-bordered"
            value={settlementIdInput}
            onChange={e => setSettlementIdInput(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" onClick={handleLoad}>
          Load
        </button>
      </div>

      {loadedId !== null && (
        <div className="p-4 border rounded-xl flex flex-col gap-2">
          <div>Settlement ID: {loadedId.toString()}</div>
          <div>Status: {statusEnumToText(rawStatus)}</div>
          <div>Epoch: {epochId?.toString() ?? "-"}</div>
          <div>Commit block: {commitBlock?.toString() ?? "-"}</div>
          <div>Submitter: {submitter}</div>
          <div className="break-all text-xs text-gray-600">Hash: {hash}</div>

          <div className="mt-3 flex gap-3">
            <button className="btn btn-success btn-sm" onClick={handleFinalize}>
              Finalize
            </button>
            <button className="btn btn-error btn-sm" onClick={handleChallenge}>
              Challenge
            </button>
          </div>
        </div>
      )}

      {transfers.length > 0 && (
        <div className="p-4 border rounded-xl">
          <h2 className="font-semibold mb-2">Transfers</h2>
          <div className="flex flex-col gap-2 text-sm">
            {transfers.map((t, i) => (
              <div key={i} className="border rounded-lg p-2">
                <div>Token: {t.token}</div>
                <div>From: {t.from}</div>
                <div>To: {t.to}</div>
                <div>{t.isERC721 ? `NFT tokenId: ${t.tokenId}` : `Amount (raw): ${t.amount}`}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {feeLocks.length > 0 && (
        <div className="p-4 border rounded-xl">
          <h2 className="font-semibold mb-2">Submitter Fee Locks</h2>
          <div className="flex flex-col gap-2 text-sm">
            {feeLocks.map((f, i) => (
              <div key={i} className="border rounded-lg p-2">
                <div>Party: {f.party}</div>
                {f.token && <div>Fee token: {f.token}</div>}
                <div>Amount (raw): {f.amount}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-sm text-gray-600">{statusText}</div>
      <div className="text-sm text-gray-800">{txStatus}</div>
    </div>
  );
}
