/**
 * Read-only NEAR access: contract views, balances and USD prices.
 * @module lib/near/rpc
 */
import { type NetworkConfig, PRICE_API } from './config'

let rpcId = 0

export async function rpc<T = any>(cfg: NetworkConfig, method: string, params: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(cfg.rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    signal,
  })
  const body = await res.json()
  if (body.error) throw new Error(body.error?.cause?.name || body.error?.data || body.error?.message || 'RPC error')
  if (body.result?.error) throw new Error(String(body.result.error))
  return body.result as T
}

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)))

export async function view<T = any>(cfg: NetworkConfig, contract: string, method: string, args: object = {}, signal?: AbortSignal): Promise<T> {
  const r = await rpc<{ result: number[] }>(cfg, 'query', {
    request_type: 'call_function',
    finality: 'final',
    account_id: contract,
    method_name: method,
    args_base64: b64(JSON.stringify(args)),
  }, signal)
  const text = new TextDecoder().decode(new Uint8Array(r.result))
  return (text ? JSON.parse(text) : null) as T
}

export async function accountExists(cfg: NetworkConfig, accountId: string): Promise<boolean> {
  try {
    await rpc(cfg, 'query', { request_type: 'view_account', finality: 'final', account_id: accountId })
    return true
  } catch (e) {
    if (/UNKNOWN_ACCOUNT|does not exist/i.test((e as Error).message)) return false
    throw e
  }
}

export interface NearAccountState {
  /** total balance in yocto */
  amount: bigint
  /** balance locked for storage, in yocto */
  storage: bigint
  /** spendable balance in yocto (amount minus storage minus a 0.05 NEAR gas reserve) */
  available: bigint
}

const STORAGE_PRICE = 10n ** 19n // yocto per byte
const GAS_RESERVE = 5n * 10n ** 22n // 0.05 NEAR

export async function nearBalance(cfg: NetworkConfig, accountId: string): Promise<NearAccountState> {
  try {
    const r = await rpc<{ amount: string; storage_usage: number }>(cfg, 'query', {
      request_type: 'view_account', finality: 'final', account_id: accountId,
    })
    const amount = BigInt(r.amount)
    const storage = BigInt(r.storage_usage) * STORAGE_PRICE
    const free = amount - storage - GAS_RESERVE
    return { amount, storage, available: free > 0n ? free : 0n }
  } catch (e) {
    if (/UNKNOWN_ACCOUNT|does not exist/i.test((e as Error).message)) return { amount: 0n, storage: 0n, available: 0n }
    throw e
  }
}

export async function ftBalance(cfg: NetworkConfig, token: string, accountId: string): Promise<bigint> {
  const r = await view<string>(cfg, token, 'ft_balance_of', { account_id: accountId })
  return BigInt(r ?? '0')
}

export async function isRegistered(cfg: NetworkConfig, token: string, accountId: string): Promise<boolean> {
  const r = await view<unknown>(cfg, token, 'storage_balance_of', { account_id: accountId })
  return r !== null
}

export async function storageMin(cfg: NetworkConfig, contract: string): Promise<bigint> {
  try {
    const b = await view<{ min: string }>(cfg, contract, 'storage_balance_bounds')
    return BigInt(b.min)
  } catch {
    return 125n * 10n ** 19n // 0.00125 NEAR, the NEP-145 norm
  }
}

/** All fungible tokens an account holds, via FastNEAR (one request). */
export async function ftHoldings(cfg: NetworkConfig, accountId: string): Promise<{ contract_id: string; balance: string }[]> {
  const res = await fetch(`${cfg.fastnear}/v1/account/${accountId}/ft`)
  if (!res.ok) return []
  const body = await res.json()
  return (body.tokens ?? []).filter((t: { balance: string }) => t.balance && t.balance !== '0')
}

// ---------------------------------------------------------------------------
// Prices (USD), cached for a minute. Mainnet ids; testnet tokens map by symbol.
// ---------------------------------------------------------------------------
let priceCache: { at: number; data: Record<string, { price: string; symbol: string; decimal: number }> } | null = null

export async function prices(): Promise<Record<string, { price: string; symbol: string; decimal: number }>> {
  if (priceCache && Date.now() - priceCache.at < 60_000) return priceCache.data
  const res = await fetch(PRICE_API)
  const data = await res.json()
  priceCache = { at: Date.now(), data }
  return data
}

export async function nearUsd(): Promise<number> {
  const p = await prices()
  return Number(p['wrap.near']?.price ?? 0)
}
