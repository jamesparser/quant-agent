/**
 * NEAR network configuration for Quant Agent's on-chain actions.
 *
 * Framework-free on purpose: this folder (src/lib/near) has no React or app
 * imports except state.ts and signers.ts, so the same core can be reused by
 * the RealCryptoCap site chat.
 *
 * @module lib/near/config
 */

export type NearNetwork = 'mainnet' | 'testnet'

export interface NetworkConfig {
  network: NearNetwork
  rpc: string
  /** Backup RPC endpoints, tried when the main one fails */
  rpcFallback: string[]
  fastnear: string
  explorer: string
  wrap: string
  /** Rhea (Ref Finance) v2 exchange */
  ref: string
  /** Rhea smart router (mainnet only); testnet falls back to on-chain pool quotes */
  smartRouter?: string
  metaPool: string
  linear: string
  /** Rhea Lending (Burrow) */
  burrow: string
  /** NEAR Intents 1Click API (mainnet only, no testnet solvers exist) */
  oneClick?: string
}

export const NETWORKS: Record<NearNetwork, NetworkConfig> = {
  mainnet: {
    network: 'mainnet',
    rpc: 'https://rpc.mainnet.fastnear.com',
    rpcFallback: ['https://free.rpc.fastnear.com', 'https://near.lava.build'],
    fastnear: 'https://api.fastnear.com',
    explorer: 'https://nearblocks.io',
    wrap: 'wrap.near',
    ref: 'v2.ref-finance.near',
    smartRouter: 'https://smartrouter.ref.finance',
    metaPool: 'meta-pool.near',
    linear: 'linear-protocol.near',
    burrow: 'contract.main.burrow.near',
    oneClick: 'https://1click.chaindefuser.com',
  },
  testnet: {
    network: 'testnet',
    rpc: 'https://test.rpc.fastnear.com',
    rpcFallback: ['https://rpc.testnet.near.org'],
    fastnear: 'https://test.api.fastnear.com',
    explorer: 'https://testnet.nearblocks.io',
    wrap: 'wrap.testnet',
    ref: 'ref-finance-101.testnet',
    metaPool: 'meta-v2.pool.testnet',
    linear: 'linear-protocol.testnet',
    burrow: 'contract.dev-burrow.testnet',
  },
}

/** Price list used to value actions in USD for spending limits (mainnet prices). */
export const PRICE_API = 'https://indexer.ref.finance/list-token-price'

export const TGAS = 10n ** 12n
export const ONE_YOCTO = '1'
export const ONE_NEAR = 10n ** 24n

/** Native NEAR is represented by this pseudo token id in the action builders. */
export const NATIVE = 'near'

export const txUrl = (cfg: NetworkConfig, hash: string) => `${cfg.explorer}/txns/${hash}`
export const accountUrl = (cfg: NetworkConfig, id: string) => `${cfg.explorer}/address/${id}`

/**
 * fetch with retries for flaky networks ("Failed to fetch"): up to 3 tries with
 * a short backoff on network errors and 5xx/429 responses. Not used to send
 * signed transactions (near-api-js handles those with its failover provider).
 */
export async function fetchRetry(input: string, init?: RequestInit, tries = 3): Promise<Response> {
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(input, init)
      if ((res.status >= 500 || res.status === 429) && i < tries - 1) {
        last = new Error(`HTTP ${res.status}`)
      } else {
        return res
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e
      last = e
    }
    await new Promise((r) => setTimeout(r, 500 * (i + 1)))
  }
  throw new Error(`Network request failed after ${tries} tries (${(last as Error)?.message ?? last}): ${input.split('?')[0]}`)
}
