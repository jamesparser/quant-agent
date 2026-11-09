/**
 * NEAR Intents 1Click: cross-chain swaps and moves (mainnet only).
 * Docs: https://docs.near-intents.org/integration/distribution-channels/1click-api
 * @module lib/near/intents
 */
import type { NetworkConfig } from './config'

export interface IntentsToken {
  assetId: string
  decimals: number
  blockchain: string
  symbol: string
  price: number
  contractAddress?: string
}

export interface IntentsQuote {
  amountIn: string
  amountOut: string
  amountOutFormatted?: string
  minAmountOut: string
  depositAddress?: string
  deadline?: string
  timeEstimate?: number
}

const need1Click = (cfg: NetworkConfig) => {
  if (!cfg.oneClick) throw new Error('NEAR Intents only runs on mainnet (there are no testnet solvers). Switch the NEAR network to mainnet in Settings.')
  return cfg.oneClick
}

let tokenCache: { at: number; list: IntentsToken[] } | null = null

export async function intentsTokens(cfg: NetworkConfig): Promise<IntentsToken[]> {
  const base = need1Click(cfg)
  if (tokenCache && Date.now() - tokenCache.at < 300_000) return tokenCache.list
  const res = await fetch(`${base}/v0/tokens`)
  if (!res.ok) throw new Error(`1Click tokens failed (${res.status})`)
  const list = (await res.json()) as IntentsToken[]
  tokenCache = { at: Date.now(), list }
  return list
}

/** Find a destination asset from "USDC", "USDC on base", "BTC on bitcoin" or a raw assetId. */
export async function findAsset(cfg: NetworkConfig, symbol: string, chain?: string): Promise<IntentsToken> {
  const list = await intentsTokens(cfg)
  const direct = list.find((t) => t.assetId === symbol)
  if (direct) return direct
  const sym = symbol.trim().toUpperCase()
  const ch = (chain || 'near').trim().toLowerCase()
  const hit = list.find((t) => t.symbol.toUpperCase() === sym && t.blockchain.toLowerCase() === ch)
  if (hit) return hit
  const chains = Array.from(new Set(list.filter((t) => t.symbol.toUpperCase() === sym).map((t) => t.blockchain)))
  throw new Error(chains.length
    ? `${sym} is not available on ${ch}. Available chains: ${chains.join(', ')}.`
    : `${sym} is not supported by NEAR Intents.`)
}

export async function intentsQuote(cfg: NetworkConfig, p: {
  originAsset: string
  destinationAsset: string
  amount: bigint
  recipient: string
  refundTo: string
  dry: boolean
  slippageBps?: number
}): Promise<IntentsQuote> {
  const base = need1Click(cfg)
  const destIsNear = p.destinationAsset.startsWith('nep141:') && !/\.omft\.near$/.test(p.destinationAsset)
  const body = {
    dry: p.dry,
    swapType: 'EXACT_INPUT',
    slippageTolerance: p.slippageBps ?? 100,
    originAsset: p.originAsset,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: p.destinationAsset,
    amount: p.amount.toString(),
    refundTo: p.refundTo,
    refundType: 'ORIGIN_CHAIN',
    recipient: p.recipient,
    recipientType: destIsNear ? 'DESTINATION_CHAIN' : 'DESTINATION_CHAIN',
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
    referral: 'realcryptocap-quant-agent',
  }
  const res = await fetch(`${base}/v0/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`NEAR Intents quote failed: ${out?.message || out?.error || res.status}`)
  return out.quote as IntentsQuote
}

export async function submitDeposit(cfg: NetworkConfig, depositAddress: string, txHash: string): Promise<void> {
  const base = need1Click(cfg)
  await fetch(`${base}/v0/deposit/submit`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ depositAddress, txHash }),
  }).catch(() => undefined)
}

export async function intentsStatus(cfg: NetworkConfig, depositAddress: string): Promise<{ status: string; [k: string]: unknown }> {
  const base = need1Click(cfg)
  const res = await fetch(`${base}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`)
  return res.json()
}

/** Poll until the swap settles or `ms` passes. */
export async function waitForIntents(cfg: NetworkConfig, depositAddress: string, ms = 90_000) {
  const end = Date.now() + ms
  let last: { status: string; [k: string]: unknown } = { status: 'PENDING_DEPOSIT' }
  while (Date.now() < end) {
    last = await intentsStatus(cfg, depositAddress).catch(() => last)
    if (['SUCCESS', 'REFUNDED', 'FAILED', 'INCOMPLETE_DEPOSIT'].includes(last.status)) break
    await new Promise((r) => setTimeout(r, 4000))
  }
  return last
}
