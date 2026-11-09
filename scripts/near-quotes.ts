/**
 * Read-only mainnet checks: Rhea smart-router quote and NEAR Intents dry quotes.
 *   npx tsx scripts/near-quotes.ts
 */
import { NETWORKS } from '../src/lib/near/config'
import { quoteSwap } from '../src/lib/near/rhea'
import { resolveToken, toRaw, fromRaw } from '../src/lib/near/tokens'
import { quoteCrossChain } from '../src/lib/near/actions'

const cfg = NETWORKS.mainnet
const usdc = await resolveToken(cfg, 'USDC')
const q = await quoteSwap(cfg, cfg.wrap, usdc.id, toRaw('1', 24), 50)
console.log(`Rhea: 1 NEAR -> ${fromRaw(q.amountOut, usdc.decimals)} USDC (min ${fromRaw(q.minAmountOut, usdc.decimals)}) via ${q.route}`)
const st = await resolveToken(cfg, 'STNEAR')
const q2 = await quoteSwap(cfg, st.id, cfg.wrap, toRaw('1', 24), 50)
console.log(`Rhea: 1 stNEAR -> ${fromRaw(q2.amountOut, 24)} NEAR via ${q2.route}`)
for (const [sym, chain, rcpt] of [['USDC', 'base', undefined], ['USDC', 'near', 'jeremyp.near'], ['SOL', 'sol', 'So11111111111111111111111111111111111111112']] as const) {
  try {
    const r = await quoteCrossChain(cfg, 'jeremyp.near', 'NEAR', '1', sym, chain, rcpt)
    console.log(`Intents: 1 NEAR -> ${r.quote.amountOutFormatted ?? fromRaw(r.quote.amountOut, r.dest.decimals)} ${r.dest.symbol} on ${r.dest.blockchain} (~${r.quote.timeEstimate}s)`)
  } catch (e) { console.log(`Intents ${sym}/${chain}: ${(e as Error).message}`) }
}
