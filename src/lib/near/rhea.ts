/**
 * Rhea (Ref Finance) swap quotes and swap action lists.
 *
 * Mainnet quotes come from Rhea's smart router. Testnet has no router, so we
 * read the exchange's simple pools on-chain and quote with `get_return`
 * (direct pool, or two hops through wNEAR).
 *
 * @module lib/near/rhea
 */
import { type NetworkConfig, fetchRetry } from './config'
import { view } from './rpc'

export interface RefSwapAction {
  pool_id: number
  token_in: string
  token_out: string
  amount_in?: string
  min_amount_out: string
}

export interface SwapQuote {
  amountOut: bigint
  minAmountOut: bigint
  actions: RefSwapAction[]
  route: string
}

const applySlippage = (v: bigint, bps: number) => (v * BigInt(10_000 - bps)) / 10_000n

export async function quoteSwap(
  cfg: NetworkConfig,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  slippageBps = 50,
  signal?: AbortSignal,
): Promise<SwapQuote> {
  if (amountIn <= 0n) throw new Error('Amount must be above zero')
  if (!cfg.smartRouter) return onChainQuote(cfg, tokenIn, tokenOut, amountIn, slippageBps, signal)
  try {
    return await smartRouterQuote(cfg, tokenIn, tokenOut, amountIn, slippageBps, signal)
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e
    // Smart router down or no route: quote the simple pools on-chain instead.
    return onChainQuote(cfg, tokenIn, tokenOut, amountIn, slippageBps, signal)
  }
}

async function smartRouterQuote(cfg: NetworkConfig, tokenIn: string, tokenOut: string, amountIn: bigint, bps: number, signal?: AbortSignal): Promise<SwapQuote> {
  const url = `${cfg.smartRouter}/findPath?amountIn=${amountIn}&tokenIn=${tokenIn}&tokenOut=${tokenOut}&pathDeep=3&slippage=${bps / 10_000}`
  const res = await fetchRetry(url, { signal })
  const body = await res.json()
  const data = body?.result_data
  if (body?.result_code !== 0 || !data?.routes?.length) throw new Error(`No Rhea route for this pair (${body?.result_message || 'empty'})`)
  const actions: RefSwapAction[] = []
  let minOut = 0n
  const legs: string[] = []
  for (const route of data.routes) {
    const pools = route.pools as Array<{ pool_id: string; token_in: string; token_out: string; amount_in: string; min_amount_out: string }>
    for (const p of pools) {
      if (!/^\d+$/.test(String(p.pool_id))) throw new Error('The best route uses a concentrated-liquidity pool this agent does not route through yet. Try a smaller amount or another pair.')
      actions.push({
        pool_id: Number(p.pool_id),
        token_in: p.token_in,
        token_out: p.token_out,
        ...(p.amount_in && p.amount_in !== '0' ? { amount_in: p.amount_in } : {}),
        min_amount_out: p.min_amount_out ?? '0',
      })
    }
    minOut += BigInt(route.min_amount_out ?? '0')
    legs.push(pools.map((p) => `#${p.pool_id}`).join(' -> '))
  }
  const amountOut = BigInt(data.amount_out ?? '0')
  return { amountOut, minAmountOut: minOut > 0n ? minOut : applySlippage(amountOut, bps), actions, route: `Rhea pools ${legs.join(' + ')}` }
}

// ---------------------------------------------------------------------------
// Testnet: on-chain quoting over simple pools (cached for 5 minutes)
// ---------------------------------------------------------------------------
type Pool = { id: number; token_account_ids: string[]; pool_kind: string }
let poolCache: { at: number; network: string; pools: Pool[] } | null = null

async function simplePools(cfg: NetworkConfig, signal?: AbortSignal): Promise<Pool[]> {
  if (poolCache && poolCache.network === cfg.network && Date.now() - poolCache.at < 300_000) return poolCache.pools
  const n = await view<number>(cfg, cfg.ref, 'get_number_of_pools', {}, signal)
  const pages = []
  for (let i = 0; i < n; i += 500) pages.push(view<any[]>(cfg, cfg.ref, 'get_pools', { from_index: i, limit: 500 }, signal).then((ps) => ps.map((p, k) => ({ ...p, id: i + k }))))
  const pools = (await Promise.all(pages)).flat().filter((p: Pool) => p.pool_kind === 'SIMPLE_POOL' && p.token_account_ids.length === 2)
  poolCache = { at: Date.now(), network: cfg.network, pools }
  return pools
}

async function bestHop(cfg: NetworkConfig, pools: Pool[], a: string, b: string, amount: bigint, signal?: AbortSignal) {
  const cands = pools.filter((p) => p.token_account_ids.includes(a) && p.token_account_ids.includes(b))
  let best: { pool: number; out: bigint } | null = null
  await Promise.all(cands.slice(0, 25).map(async (p) => {
    try {
      const out = BigInt(await view<string>(cfg, cfg.ref, 'get_return', { pool_id: p.id, token_in: a, amount_in: amount.toString(), token_out: b }, signal))
      if (!best || out > best.out) best = { pool: p.id, out }
    } catch { /* empty pool */ }
  }))
  return best as { pool: number; out: bigint } | null
}

async function onChainQuote(cfg: NetworkConfig, tokenIn: string, tokenOut: string, amountIn: bigint, bps: number, signal?: AbortSignal): Promise<SwapQuote> {
  const pools = await simplePools(cfg, signal)
  const direct = await bestHop(cfg, pools, tokenIn, tokenOut, amountIn, signal)
  let twoHop: { a: { pool: number; out: bigint }; b: { pool: number; out: bigint } } | null = null
  if (tokenIn !== cfg.wrap && tokenOut !== cfg.wrap) {
    const a = await bestHop(cfg, pools, tokenIn, cfg.wrap, amountIn, signal)
    const b = a ? await bestHop(cfg, pools, cfg.wrap, tokenOut, a.out, signal) : null
    if (a && b) twoHop = { a, b }
  }
  if (!direct && !twoHop) throw new Error('No Rhea testnet pool for this pair. Try NEAR, USDT, USDC, STNEAR or HACK.')
  if (direct && (!twoHop || direct.out >= twoHop.b.out)) {
    const min = applySlippage(direct.out, bps)
    return {
      amountOut: direct.out, minAmountOut: min, route: `Rhea pool #${direct.pool}`,
      actions: [{ pool_id: direct.pool, token_in: tokenIn, token_out: tokenOut, amount_in: amountIn.toString(), min_amount_out: min.toString() }],
    }
  }
  const t = twoHop!
  const min = applySlippage(t.b.out, bps)
  return {
    amountOut: t.b.out, minAmountOut: min, route: `Rhea pools #${t.a.pool} -> #${t.b.pool} (via wNEAR)`,
    actions: [
      { pool_id: t.a.pool, token_in: tokenIn, token_out: cfg.wrap, amount_in: amountIn.toString(), min_amount_out: '0' },
      { pool_id: t.b.pool, token_in: cfg.wrap, token_out: tokenOut, min_amount_out: min.toString() },
    ],
  }
}

/** The ft_transfer_call message the exchange executes on receipt. */
export const swapMsg = (actions: RefSwapAction[]) => JSON.stringify({ force: 0, actions })
