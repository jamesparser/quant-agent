/**
 * Token lookup: symbols to NEP-141 contracts per network, metadata and amount maths.
 * @module lib/near/tokens
 */
import { type NetworkConfig, type NearNetwork, NATIVE } from './config'
import { view } from './rpc'

/** Well-known tokens. Any NEP-141 contract id is also accepted directly. */
export const KNOWN: Record<NearNetwork, Record<string, string>> = {
  mainnet: {
    NEAR: NATIVE,
    WNEAR: 'wrap.near',
    USDC: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    USDT: 'usdt.tether-token.near',
    STNEAR: 'meta-pool.near',
    LINEAR: 'linear-protocol.near',
    REF: 'token.v2.ref-finance.near',
  },
  testnet: {
    NEAR: NATIVE,
    WNEAR: 'wrap.testnet',
    USDT: 'usdt.itachicara.testnet',
    USDC: 'usdc.itachicara.testnet',
    STNEAR: 'meta-v2.pool.testnet',
    LINEAR: 'linear-protocol.testnet',
    HACK: 'hack-token.testnet',
  },
}

/** Mainnet contract used to price a testnet token (spending limits are in USD). */
export const PRICE_TWIN: Record<string, string> = {
  'wrap.testnet': 'wrap.near',
  'usdt.itachicara.testnet': 'usdt.tether-token.near',
  'usdc.itachicara.testnet': '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
  'meta-v2.pool.testnet': 'meta-pool.near',
  'linear-protocol.testnet': 'linear-protocol.near',
  near: 'wrap.near',
}

export interface TokenInfo {
  id: string // contract id, or 'near' for native NEAR
  symbol: string
  decimals: number
}

const meta = new Map<string, TokenInfo>()

const looksLikeContract = (s: string) => /\.(near|testnet)$/.test(s) || /^[0-9a-f]{64}$/.test(s)

export async function resolveToken(cfg: NetworkConfig, input: string): Promise<TokenInfo> {
  const raw = input.trim()
  const sym = raw.toUpperCase().replace(/^\$/, '')
  const id = KNOWN[cfg.network][sym] ?? (looksLikeContract(raw.toLowerCase()) ? raw.toLowerCase() : undefined)
  if (!id) {
    const known = Object.keys(KNOWN[cfg.network]).join(', ')
    throw new Error(`Unknown token "${input}" on ${cfg.network}. Use one of ${known}, or a token contract id.`)
  }
  if (id === NATIVE) return { id: NATIVE, symbol: 'NEAR', decimals: 24 }
  const key = `${cfg.network}:${id}`
  const cached = meta.get(key)
  if (cached) return cached
  const m = await view<{ symbol: string; decimals: number }>(cfg, id, 'ft_metadata')
  const info = { id, symbol: m.symbol, decimals: m.decimals }
  meta.set(key, info)
  return info
}

/** "1.5" with 6 decimals -> 1500000n. Rejects more precision than the token has. */
export function toRaw(amount: string | number, decimals: number): bigint {
  const s = String(amount).trim()
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid amount "${amount}"`)
  const [whole, frac = ''] = s.split('.')
  if (frac.length > decimals) throw new Error(`Too many decimals for this token (max ${decimals})`)
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0')
}

/** 1500000n with 6 decimals -> "1.5" (trimmed to `max` fraction digits). */
export function fromRaw(raw: bigint | string, decimals: number, max = 6): string {
  const v = BigInt(raw)
  const base = 10n ** BigInt(decimals)
  const whole = v / base
  let frac = (v % base).toString().padStart(decimals, '0').slice(0, max).replace(/0+$/, '')
  if (!frac && v > 0n && whole === 0n) frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '').slice(0, decimals)
  return frac ? `${whole}.${frac}` : `${whole}`
}
