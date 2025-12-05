"use client";

import { useRef, useState } from "react";
import { Address, parseEther } from "viem";
import { useAccount, useChainId, usePublicClient, useSignTypedData } from "wagmi";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

type UiTransfer = {
  from: string;
  to: string;
  amount: string; // human units (TST)
};

type GeneratedBundle = {
  epochId: string;
  settlementHash: string;
  feeToken: string;
  transfers: {
    token: string;
    from: string;
    to: string;
    amount: string;
    tokenId: string;
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

export default function SignIntentPage() {
  const { address: connectedAddress } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();

  const { data: settlementInfo } = useDeployedContractInfo("SettlementManager");
  const { data: oracleInfo } = useDeployedContractInfo("OracleHub");
  const { data: testTokenInfo } = useDeployedContractInfo("TestToken");

  const [transfers, setTransfers] = useState<UiTransfer[]>([{ from: "", to: "", amount: "100" }]);

  const [expirySeconds, setExpirySeconds] = useState<string>("3600");
  const [feeAmountHuman, setFeeAmountHuman] = useState<string>("1");
  const [status, setStatus] = useState<string>("");
  const [bundleJson, setBundleJson] = useState<string>("");

  // counter so nonce stays unique even if user signs rapidly
  const nonceCounterRef = useRef<number>(0);

  const settlementAddr = settlementInfo?.address as Address | undefined;
  const settlementAbi = settlementInfo?.abi;
  const oracleAddr = oracleInfo?.address as Address | undefined;
  const oracleAbi = oracleInfo?.abi;
  const testTokenAddr = testTokenInfo?.address as Address | undefined;

  const ensureReady = () => {
    if (!settlementAddr || !settlementAbi || !oracleAddr || !oracleAbi || !testTokenAddr) {
      throw new Error("Contracts not loaded yet.");
    }
    if (!publicClient) {
      throw new Error("Public client not available.");
    }
    if (!connectedAddress) {
      throw new Error("Connect a wallet first.");
    }
  };

  const buildTransfersForContract = () => {
    if (!testTokenAddr) throw new Error("TestToken not loaded.");
    return transfers.map(t => {
      if (!t.from || !t.to) throw new Error("Each transfer must include from & to");
      if (!t.amount || Number(t.amount) <= 0) throw new Error("Transfer amount must be > 0");

      return {
        token: testTokenAddr,
        from: t.from as Address,
        to: t.to as Address,
        amount: parseEther(t.amount),
        tokenId: 0n,
        isERC721: false,
      };
    });
  };

  const addTransferRow = () => {
    setTransfers(prev => [...prev, { from: "", to: "", amount: "0" }]);
  };

  const updateTransfer = (idx: number, field: keyof UiTransfer, value: string) => {
    setTransfers(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: value };
      return copy;
    });
  };

  const removeTransfer = (idx: number) => {
    setTransfers(prev => prev.filter((_, i) => i !== idx));
  };

  const handleGenerateAndSign = async () => {
    try {
      setStatus("Preparing intent...");
      setBundleJson("");
      ensureReady();

      const transfersForContract = buildTransfersForContract();

      // load epoch
      const epochId = (await publicClient!.readContract({
        address: oracleAddr!,
        abi: oracleAbi!,
        functionName: "currentEpoch",
        args: [],
      })) as bigint;

      // compute settlementHash
      const settlementHash = (await publicClient!.readContract({
        address: settlementAddr!,
        abi: settlementAbi!,
        functionName: "computeSettlementHash",
        args: [epochId, transfersForContract],
      })) as `0x${string}`;

      // expiry handling
      const nowSec = Math.floor(Date.now() / 1000);
      const expiry = BigInt(nowSec + Number(expirySeconds || "3600"));

      // AUTO NONCE
      const nowMs = Date.now();
      const nonceBig = BigInt(nowMs * 1000 + nonceCounterRef.current);
      nonceCounterRef.current += 1;

      // fee
      const feeWei = parseEther(feeAmountHuman || "0");
      if (feeWei <= 0n) throw new Error("Fee must be > 0");

      const domain = {
        name: "SettlementManager",
        version: "1",
        chainId,
        verifyingContract: settlementAddr!,
      };

      const types = {
        UserIntent: [
          { name: "party", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "expiry", type: "uint256" },
          { name: "epochId", type: "uint256" },
          { name: "settlementHash", type: "bytes32" },
          { name: "feeToken", type: "address" },
          { name: "feeAmount", type: "uint256" },
        ],
      } as const;

      const message = {
        party: connectedAddress!,
        nonce: nonceBig,
        expiry,
        epochId,
        settlementHash,
        feeToken: testTokenAddr!,
        feeAmount: feeWei,
      };

      setStatus("Signing intent...");

      const signature = await signTypedDataAsync({
        domain,
        types,
        primaryType: "UserIntent",
        message,
      });

      // build bundle
      const jsonTransfers = transfersForContract.map(t => ({
        token: t.token,
        from: t.from,
        to: t.to,
        amount: t.amount.toString(),
        tokenId: "0",
        isERC721: false,
      }));

      const bundle: GeneratedBundle = {
        epochId: epochId.toString(),
        settlementHash,
        feeToken: testTokenAddr!,
        transfers: jsonTransfers,
        intent: {
          party: connectedAddress!,
          nonce: nonceBig.toString(),
          expiry: expiry.toString(),
          feeToken: testTokenAddr!,
          feeAmount: feeWei.toString(),
          settlementHash,
          signature,
        },
      };

      setBundleJson(JSON.stringify(bundle, null, 2));
      setStatus("Intent signed. Share this JSON publicly.");
    } catch (err: any) {
      console.error(err);
      setStatus(err?.message || "Error generating intent.");
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto mt-10 p-6 border rounded-2xl shadow">
      <h1 className="text-2xl font-bold">Sign Settlement Intent</h1>

      {/* Transfers */}
      <div className="flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <span className="font-semibold">Transfers (TestToken)</span>
          <button className="btn btn-sm btn-outline" onClick={addTransferRow}>
            + Add row
          </button>
        </div>

        {transfers.map((t, idx) => (
          <div key={idx} className="grid grid-cols-12 gap-2 items-center">
            <input
              className="input input-bordered col-span-4"
              placeholder="from address"
              value={t.from}
              onChange={e => updateTransfer(idx, "from", e.target.value)}
            />
            <input
              className="input input-bordered col-span-4"
              placeholder="to address"
              value={t.to}
              onChange={e => updateTransfer(idx, "to", e.target.value)}
            />
            <input
              className="input input-bordered col-span-3"
              placeholder="amount"
              value={t.amount}
              onChange={e => updateTransfer(idx, "amount", e.target.value)}
            />
            <button className="btn btn-ghost btn-sm col-span-1" onClick={() => removeTransfer(idx)}>
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Params */}
      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Expiry (seconds)</span>
          <input
            className="input input-bordered"
            value={expirySeconds}
            onChange={e => setExpirySeconds(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Fee (TST)</span>
          <input
            className="input input-bordered"
            value={feeAmountHuman}
            onChange={e => setFeeAmountHuman(e.target.value)}
          />
        </label>
      </div>

      <button className="btn btn-primary" disabled={!connectedAddress} onClick={handleGenerateAndSign}>
        Generate & Sign Intent
      </button>

      <div className="text-sm text-gray-700">{status}</div>

      <textarea className="textarea textarea-bordered w-full h-64 font-mono text-xs" value={bundleJson} readOnly />
    </div>
  );
}
