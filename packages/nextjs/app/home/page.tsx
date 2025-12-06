"use client";

import Link from "next/link";
import { Address } from "viem";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

function ShortAddress({ address }: { address?: Address }) {
  if (!address) return <span className="text-gray-400">N/A</span>;
  const s = address.toString();
  return (
    <span className="font-mono">
      {s.slice(0, 6)}...{s.slice(-4)}
    </span>
  );
}

export default function HomePage() {
  const { data: settlementInfo } = useDeployedContractInfo("SettlementManager");
  const { data: vaultInfo } = useDeployedContractInfo("Vault");
  const { data: nftVaultInfo } = useDeployedContractInfo("NFTVault");
  const { data: oracleInfo } = useDeployedContractInfo("OracleHub");

  const settlementAddr = settlementInfo?.address as Address | undefined;
  const vaultAddr = vaultInfo?.address as Address | undefined;
  const nftVaultAddr = nftVaultInfo?.address as Address | undefined;
  const oracleAddr = oracleInfo?.address as Address | undefined;

  return (
    <div className="max-w-6xl mx-auto mt-12 px-4 flex flex-col gap-10">
      {/* HERO */}
      <section className="flex flex-col md:flex-row md:items-center gap-8">
        <div className="flex-1 flex flex-col gap-4">
          <h1 className="text-3xl md:text-4xl font-bold">Adversarial-Resilient Settlement Protocol</h1>
          <p className="text-gray-600 max-w-xl">
            Trust-minimized settlement of token and NFT trades on Ethereum. Users sign off-chain intents, solvers bundle
            them into on-chain settlements, and a challenge window plus oracle-based checks protect against
            manipulation.
          </p>

          <div className="flex flex-wrap gap-3 mt-2">
            <Link href="/vault" className="btn btn-primary">
              1. Fund Vault
            </Link>
            <Link href="/sign-intent" className="btn btn-outline">
              2. Sign Intent
            </Link>
            <Link href="/submit-settlement" className="btn btn-outline">
              3. Submit Settlement
            </Link>
            <Link href="/settlements" className="btn btn-ghost">
              View Settlements
            </Link>
          </div>
        </div>

        <div className="flex-1 p-5 border rounded-2xl shadow-sm bg-base-100 flex flex-col gap-3">
          <h2 className="font-semibold mb-1">Core Contracts</h2>
          <div className="text-sm flex flex-col gap-2">
            <div className="flex justify-between gap-4">
              <span>SettlementManager</span>
              <ShortAddress address={settlementAddr} />
            </div>
            <div className="flex justify-between gap-4">
              <span>Vault</span>
              <ShortAddress address={vaultAddr} />
            </div>
            <div className="flex justify-between gap-4">
              <span>NFTVault</span>
              <ShortAddress address={nftVaultAddr} />
            </div>
            <div className="flex justify-between gap-4">
              <span>OracleHub</span>
              <ShortAddress address={oracleAddr} />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Addresses are loaded from the current network&apos;s deployments. Make sure your wallet is connected to
            Sepolia.
          </p>
        </div>
      </section>

      {/* FLOW EXPLANATION */}
      <section className="p-5 border rounded-2xl bg-base-100 flex flex-col gap-4">
        <h2 className="text-lg font-semibold">How it works</h2>
        <ol className="list-decimal ml-5 flex flex-col gap-2 text-sm text-gray-700">
          <li>
            <span className="font-medium">Deposit assets into vaults.</span> ERC-20 tokens go into <code>Vault</code>,
            NFTs go into <code>NFTVault</code>. These stay locked while settlements are pending.
          </li>
          <li>
            <span className="font-medium">Sign intents off-chain.</span> Each party signs an EIP-712 intent describing
            what they&apos;re willing to trade and how much fee they pay the submitter.
          </li>
          <li>
            <span className="font-medium">Submit & settle on-chain with dispute window.</span> A solver bundles
            compatible intents into a settlement transaction. After a challenge window, assets are moved between vault
            balances and fees are paid to the submitter. Anyone can challenge if something looks wrong.
          </li>
        </ol>
      </section>

      {/* LINKS SECTION */}
      <section className="grid md:grid-cols-3 gap-4">
        <Link href="/vault" className="p-4 border rounded-xl hover:shadow-sm transition">
          <h3 className="font-semibold mb-1">Fund / Withdraw</h3>
          <p className="text-sm text-gray-600">
            Deposit ERC-20 tokens and NFTs into the protocol vaults so they can be included in settlements.
          </p>
        </Link>

        <Link href="/sign-intent" className="p-4 border rounded-xl hover:shadow-sm transition">
          <h3 className="font-semibold mb-1">Sign Intents</h3>
          <p className="text-sm text-gray-600">
            Build and sign EIP-712 intents that describe what assets you are willing to send and receive.
          </p>
        </Link>

        <Link href="/submit-settlement" className="p-4 border rounded-xl hover:shadow-sm transition">
          <h3 className="font-semibold mb-1">Submit Settlements</h3>
          <p className="text-sm text-gray-600">
            Paste signed intents, simulate, and submit them to the chain as a settlement during the current oracle
            epoch.
          </p>
        </Link>
      </section>
    </div>
  );
}
