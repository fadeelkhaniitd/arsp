"use client";

import { useRef, useState } from "react";
import { Address, parseEther } from "viem";
import { useAccount, useChainId, usePublicClient, useSignTypedData } from "wagmi";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

type UiTransfer = {
  token: string;
  from: string;
  to: string;
  amount: string; // used only for ERC20
  tokenId: string; // used only for ERC721
  isERC721: boolean;
};

type GeneratedBundle = {
  epochId: string;
  settlementHash: string;
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

  const [transfers, setTransfers] = useState<UiTransfer[]>([
    { token: "", from: "", to: "", amount: "0", tokenId: "0", isERC721: false },
  ]);

  const [feeToken, setFeeToken] = useState<string>("");
  const [feeAmountHuman, setFeeAmountHuman] = useState<string>("1");
  const [expirySeconds, setExpirySeconds] = useState<string>("3600");

  const [status, setStatus] = useState<string>("");
  const [bundleJson, setBundleJson] = useState<string>("");

  const nonceCounterRef = useRef<number>(0);

  const settlementAddr = settlementInfo?.address as Address | undefined;
  const settlementAbi = settlementInfo?.abi;
  const oracleAddr = oracleInfo?.address as Address | undefined;
  const oracleAbi = oracleInfo?.abi;

  function ensureReady() {
    if (!settlementAddr || !settlementAbi || !oracleAddr || !oracleAbi) {
      throw new Error("Contracts not ready");
    }
    if (!publicClient) throw new Error("No public client");
    if (!connectedAddress) throw new Error("Connect wallet first");
  }

  function addTransferRow() {
    setTransfers(prev => [...prev, { token: "", from: "", to: "", amount: "0", tokenId: "0", isERC721: false }]);
  }

  function updateTransfer(idx: number, field: keyof UiTransfer, v: string | boolean) {
    setTransfers(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: v } as UiTransfer;
      return copy;
    });
  }

  function removeTransfer(idx: number) {
    setTransfers(prev => prev.filter((_, i) => i !== idx));
  }

  function buildTransfersForContract() {
    return transfers.map(t => {
      if (!t.token) throw new Error("Transfer missing token address");
      if (!t.from) throw new Error("Transfer missing from");
      if (!t.to) throw new Error("Transfer missing to");

      if (t.isERC721) {
        if (!t.tokenId) throw new Error("ERC721 requires tokenId");
        return {
          token: t.token as Address,
          from: t.from as Address,
          to: t.to as Address,
          amount: 0n,
          tokenId: BigInt(t.tokenId),
          isERC721: true,
        };
      } else {
        if (!t.amount || Number(t.amount) <= 0) throw new Error("ERC20 requires amount > 0");
        return {
          token: t.token as Address,
          from: t.from as Address,
          to: t.to as Address,
          amount: parseEther(t.amount),
          tokenId: 0n,
          isERC721: false,
        };
      }
    });
  }

  async function handleGenerateAndSign() {
    try {
      setStatus("Preparing…");
      setBundleJson("");
      ensureReady();

      if (!feeToken) throw new Error("Fee token address required");

      const transfersForContract = buildTransfersForContract();

      const epochId = (await publicClient!.readContract({
        address: oracleAddr!,
        abi: oracleAbi!,
        functionName: "currentEpoch",
      })) as bigint;

      const settlementHash = (await publicClient!.readContract({
        address: settlementAddr!,
        abi: settlementAbi!,
        functionName: "computeSettlementHash",
        args: [epochId, transfersForContract],
      })) as `0x${string}`;

      const nowSec = Math.floor(Date.now() / 1000);
      const expiry = BigInt(nowSec + Number(expirySeconds));

      const nowMs = Date.now();
      const nonceBig = BigInt(nowMs * 1000 + nonceCounterRef.current);
      nonceCounterRef.current += 1;

      const feeWei = parseEther(feeAmountHuman);
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
        feeToken,
        feeAmount: feeWei,
      };

      setStatus("Signing…");

      const signature = await signTypedDataAsync({
        domain,
        types,
        primaryType: "UserIntent",
        message,
      });

      const jsonTransfers = transfersForContract.map(t => ({
        token: t.token,
        from: t.from,
        to: t.to,
        amount: t.amount.toString(),
        tokenId: t.tokenId.toString(),
        isERC721: t.isERC721,
      }));

      const bundle: GeneratedBundle = {
        epochId: epochId.toString(),
        settlementHash,
        transfers: jsonTransfers,
        intent: {
          party: connectedAddress!,
          nonce: nonceBig.toString(),
          expiry: expiry.toString(),
          feeToken,
          feeAmount: feeWei.toString(),
          settlementHash,
          signature,
        },
      };

      setBundleJson(JSON.stringify(bundle, null, 2));
      setStatus("Intent signed! Copy & share.");
    } catch (err: any) {
      console.error(err);
      setStatus(err?.message ?? "Error");
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto mt-10 p-6 border rounded-xl">
      <h1 className="text-2xl font-bold">Sign Settlement Intent</h1>

      {/* Transfers */}
      <div className="flex flex-col gap-3">
        <div className="flex justify-between">
          <span className="font-semibold">Transfers</span>
          <button className="btn btn-sm btn-outline" onClick={addTransferRow}>
            + Add transfer
          </button>
        </div>

        {transfers.map((t, idx) => (
          <div key={idx} className="p-3 border rounded-xl flex flex-col gap-2">
            <input
              className="input input-bordered"
              placeholder="Token address"
              value={t.token}
              onChange={e => updateTransfer(idx, "token", e.target.value)}
            />

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={t.isERC721}
                onChange={e => updateTransfer(idx, "isERC721", e.target.checked)}
              />
              <span>ERC-721?</span>
            </div>

            <input
              className="input input-bordered"
              placeholder="From"
              value={t.from}
              onChange={e => updateTransfer(idx, "from", e.target.value)}
            />

            <input
              className="input input-bordered"
              placeholder="To"
              value={t.to}
              onChange={e => updateTransfer(idx, "to", e.target.value)}
            />

            {!t.isERC721 && (
              <input
                className="input input-bordered"
                placeholder="Amount (ERC20)"
                value={t.amount}
                onChange={e => updateTransfer(idx, "amount", e.target.value)}
              />
            )}

            {t.isERC721 && (
              <input
                className="input input-bordered"
                placeholder="Token ID (ERC721)"
                value={t.tokenId}
                onChange={e => updateTransfer(idx, "tokenId", e.target.value)}
              />
            )}

            <button className="btn btn-sm btn-ghost" onClick={() => removeTransfer(idx)}>
              Remove
            </button>
          </div>
        ))}
      </div>

      {/* Fee + Expiry */}
      <div className="grid grid-cols-2 gap-4">
        <input
          className="input input-bordered"
          placeholder="Fee token address"
          value={feeToken}
          onChange={e => setFeeToken(e.target.value)}
        />
        <input
          className="input input-bordered"
          placeholder="Fee amount"
          value={feeAmountHuman}
          onChange={e => setFeeAmountHuman(e.target.value)}
        />
        <input
          className="input input-bordered"
          placeholder="Expiry (seconds)"
          value={expirySeconds}
          onChange={e => setExpirySeconds(e.target.value)}
        />
      </div>

      <button className="btn btn-primary" disabled={!connectedAddress} onClick={handleGenerateAndSign}>
        Generate & Sign Intent
      </button>

      <div className="text-sm text-gray-700">{status}</div>

      <textarea className="textarea textarea-bordered w-full h-64 font-mono text-xs" value={bundleJson} readOnly />
    </div>
  );
}
