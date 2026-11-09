/**
 * NEAR tools for Quant Agent: talk to the agent and it trades, stakes, lends
 * and moves assets on NEAR (and cross-chain through NEAR Intents).
 *
 * Read tools (account, quotes) run freely. Action tools build a plan and go
 * through lib/near/execute: spending limits, approval or YOLO, then signing
 * with the user's wallet or the agent wallet (Settings > NEAR).
 *
 * @module tools/plugins/near
 */
import { createToolPlugin } from '../registry'
import type { ToolPlugin } from '../types'
import { NETWORKS, NATIVE, accountUrl } from '@/lib/near/config'
import { nearState } from '@/lib/near/state'
import { today } from '@/lib/near/policy'
import { getEffectiveSettings } from '@/stores/userStore'

const lib = () => import('@/lib/near/lazy')

type R = { success: true; [k: string]: unknown } | { success: false; error: string }

const fail = (e: unknown): R => ({ success: false, error: (e as Error)?.message ?? String(e) })

function ctxNet() {
  const network = nearState().network
  return { network, cfg: NETWORKS[network] }
}

async function signerOrThrow(): Promise<string> {
  const { network } = ctxNet()
  const s = (await lib()).activeSigner(network)
  if (!s.accountId) {
    throw new Error(s.mode === 'agent'
      ? `No agent wallet on NEAR ${network} yet. Ask the user to create and fund one in Settings > NEAR.`
      : `No NEAR wallet connected on ${network}. Ask the user to connect one in Settings > NEAR.`)
  }
  return s.accountId
}

const meta = (name: string, displayName: string, shortDescription: string, read: boolean) => ({
  name, displayName, shortDescription,
  icon: 'Coins' as const, category: 'research' as const,
  tags: ['near', 'defi', 'trading', ...(read ? [] : ['onchain'])],
  enabledByDefault: true, estimatedDuration: read ? 3000 : 20000, requiresConfirmation: false,
})

// ---------------------------------------------------------------------------
export const nearAccountPlugin: ToolPlugin<Record<string, never>, R> = createToolPlugin({
  metadata: meta('near_account', 'NEAR Account', 'NEAR network, signer, balances, limits and approval mode', true),
  definition: {
    type: 'function',
    function: {
      name: 'near_account',
      description: 'Show the NEAR setup the agent acts with: network (mainnet or testnet), signer (the user\'s wallet or the agent wallet), its NEAR and token balances, spending limits, what was spent today, and whether actions need approval or run in YOLO mode. Call it before the first NEAR action in a job.',
      parameters: { type: 'object', properties: {} },
    },
  },
  handler: async () => {
    try {
      const L = await lib()
      const { network, cfg } = ctxNet()
      const s = nearState()
      const signer = L.activeSigner(network)
      const out: Record<string, unknown> = {
        network,
        signerMode: signer.mode === 'agent' ? 'agent wallet (key on this device)' : "user's own wallet",
        account: signer.accountId ?? null,
        approval: (getEffectiveSettings().yoloMode ?? false) && signer.mode === 'agent'
          ? 'YOLO: actions inside the limits run without asking; over-limit actions still ask'
          : 'Each action asks the user to approve',
        limits: { perActionUsd: s.limits.perActionUsd, dailyUsd: s.limits.dailyUsd, enabled: Object.entries(s.limits.allowed).filter(([, v]) => v).map(([k]) => k) },
        spentTodayUsd: s.ledger.day === today() ? Number(s.ledger.usd.toFixed(2)) : 0,
        intents: cfg.oneClick ? 'available' : 'mainnet only (switch network in Settings > NEAR)',
      }
      if (signer.accountId) {
        const b = await L.nearBalance(cfg, signer.accountId)
        const tokens = await L.ftHoldings(cfg, signer.accountId)
        const rows = await Promise.all(tokens.slice(0, 15).map(async (t) => {
          try { const m = await L.resolveToken(cfg, t.contract_id); return { symbol: m.symbol, contract: t.contract_id, balance: L.fromRaw(t.balance, m.decimals) } } catch { return { contract: t.contract_id, balance: t.balance } }
        }))
        out.near = { total: L.fromRaw(b.amount, 24, 4), available: L.fromRaw(b.available, 24, 4) }
        out.tokens = rows
        out.explorer = accountUrl(cfg, signer.accountId)
      }
      return { success: true, ...out }
    } catch (e) { return fail(e) }
  },
})

// ---------------------------------------------------------------------------
type SwapArgs = { from: string; to: string; amount: string; slippagePct?: number }

export const nearSwapQuotePlugin: ToolPlugin<SwapArgs, R> = createToolPlugin({
  metadata: meta('near_swap_quote', 'NEAR Swap Quote', 'Quote a swap on Rhea (Ref Finance)', true),
  definition: {
    type: 'function',
    function: {
      name: 'near_swap_quote',
      description: 'Quote a token swap on Rhea (Ref Finance), the main NEAR DEX, without trading. Tokens: NEAR, WNEAR, USDC, USDT, STNEAR, LINEAR, REF (mainnet); NEAR, USDT, USDC, STNEAR, LINEAR, HACK (testnet); or any token contract id.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Token to sell, e.g. NEAR' },
          to: { type: 'string', description: 'Token to buy, e.g. USDC' },
          amount: { type: 'string', description: 'Amount of `from` in whole units, e.g. "0.5"' },
          slippagePct: { type: 'number', description: 'Max slippage in percent. Default 0.5' },
        },
        required: ['from', 'to', 'amount'],
      },
    },
  },
  handler: async (a, ctx) => {
    try {
      const L = await lib()
      const { cfg } = ctxNet()
      const tin = await L.resolveToken(cfg, a.from)
      const tout = await L.resolveToken(cfg, a.to)
      const inId = tin.id === NATIVE ? cfg.wrap : tin.id
      const outId = tout.id === NATIVE ? cfg.wrap : tout.id
      if (inId === outId) return { success: true, note: 'NEAR and wNEAR convert 1:1 (wrap/unwrap), no swap needed.' }
      const raw = L.toRaw(a.amount, tin.decimals)
      const q = await L.quoteSwap(cfg, inId, outId, raw, Math.round((a.slippagePct ?? 0.5) * 100), ctx.abortSignal)
      return {
        success: true, network: cfg.network, venue: 'Rhea (Ref Finance)', route: q.route,
        sell: `${a.amount} ${tin.symbol}`, expectedOut: `${L.fromRaw(q.amountOut, tout.decimals)} ${tout.symbol}`,
        minimumOut: `${L.fromRaw(q.minAmountOut, tout.decimals)} ${tout.symbol}`,
      }
    } catch (e) { return fail(e) }
  },
})

export const nearSwapPlugin: ToolPlugin<SwapArgs, R> = createToolPlugin({
  metadata: meta('near_swap', 'NEAR Swap', 'Swap tokens on Rhea (Ref Finance)', false),
  definition: {
    type: 'function',
    function: {
      name: 'near_swap',
      description: 'Swap tokens on Rhea (Ref Finance) on NEAR. Also the way to exit liquid staking instantly (swap STNEAR or LINEAR to NEAR). Before calling, state the trade in one line (sell, buy, amount). The user approves it unless YOLO mode is on and it is inside their spending limits.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string' }, to: { type: 'string' },
          amount: { type: 'string', description: 'Amount of `from` in whole units' },
          slippagePct: { type: 'number', description: 'Max slippage in percent. Default 0.5' },
        },
        required: ['from', 'to', 'amount'],
      },
    },
  },
  handler: async (a, ctx) => {
    try {
      const L = await lib()
      const { cfg } = ctxNet()
      const plan = await L.planSwap(cfg, (await signerOrThrow()), a.from, a.to, a.amount, Math.round((a.slippagePct ?? 0.5) * 100))
      return await L.runPlan(plan, ctx)
    } catch (e) { return fail(e) }
  },
})

// ---------------------------------------------------------------------------
export const nearStakePlugin: ToolPlugin<{ amount: string; provider?: 'metapool' | 'linear' }, R> = createToolPlugin({
  metadata: meta('near_stake', 'NEAR Liquid Staking', 'Stake NEAR for stNEAR (Meta Pool) or LiNEAR', false),
  definition: {
    type: 'function',
    function: {
      name: 'near_stake',
      description: 'Liquid-stake NEAR: Meta Pool gives stNEAR, LiNEAR gives LINEAR. Both earn NEAR staking yield and stay tradable. To unstake instantly, use near_swap from STNEAR or LINEAR to NEAR.',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'string', description: 'NEAR to stake, whole units' },
          provider: { type: 'string', enum: ['metapool', 'linear'], description: 'Default metapool (stNEAR)' },
        },
        required: ['amount'],
      },
    },
  },
  handler: async (a, ctx) => {
    try {
      const L = await lib()
      const { cfg } = ctxNet()
      return await L.runPlan(await L.planStake(cfg, (await signerOrThrow()), a.provider ?? 'metapool', a.amount), ctx)
    } catch (e) { return fail(e) }
  },
})

// ---------------------------------------------------------------------------
export const nearLendPlugin: ToolPlugin<{ action: 'supply' | 'withdraw'; token: string; amount?: string }, R> = createToolPlugin({
  metadata: meta('near_lend', 'NEAR Lending', 'Supply to or withdraw from Rhea Lending (Burrow)', false),
  definition: {
    type: 'function',
    function: {
      name: 'near_lend',
      description: 'Rhea Lending (formerly Burrow) on NEAR. action "supply" deposits a token to earn the supply rate (not used as collateral, nothing borrowed). action "withdraw" takes back everything supplied of that token. Borrowing and leverage are not available from the agent yet; say so if asked.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['supply', 'withdraw'] },
          token: { type: 'string', description: 'e.g. NEAR, USDC, USDT' },
          amount: { type: 'string', description: 'Required for supply, whole units' },
        },
        required: ['action', 'token'],
      },
    },
  },
  handler: async (a, ctx) => {
    try {
      const L = await lib()
      const { cfg } = ctxNet()
      const signer = await signerOrThrow()
      if (a.action === 'supply') {
        if (!a.amount) throw new Error('amount is required to supply')
        return await L.runPlan(await L.planSupply(cfg, signer, a.token, a.amount), ctx)
      }
      return await L.runPlan(await L.planWithdrawSupply(cfg, signer, a.token), ctx)
    } catch (e) { return fail(e) }
  },
})

// ---------------------------------------------------------------------------
export const nearTransferPlugin: ToolPlugin<{ token: string; amount: string; to: string }, R> = createToolPlugin({
  metadata: meta('near_transfer', 'NEAR Transfer', 'Send NEAR or a NEAR token to an account', false),
  definition: {
    type: 'function',
    function: {
      name: 'near_transfer',
      description: 'Send NEAR or a NEAR token (NEP-141) to a NEAR account, for example to move funds from the agent wallet back to the user. Off by default in the spending settings.',
      parameters: {
        type: 'object',
        properties: { token: { type: 'string' }, amount: { type: 'string' }, to: { type: 'string', description: 'Receiver NEAR account id' } },
        required: ['token', 'amount', 'to'],
      },
    },
  },
  handler: async (a, ctx) => {
    try {
      const L = await lib()
      const { cfg } = ctxNet()
      return await L.runPlan(await L.planTransfer(cfg, (await signerOrThrow()), a.token, a.amount, a.to), ctx)
    } catch (e) { return fail(e) }
  },
})

// ---------------------------------------------------------------------------
type XArgs = { from: string; amount: string; toToken: string; toChain: string; recipient?: string }

export const nearCrossChainQuotePlugin: ToolPlugin<XArgs, R> = createToolPlugin({
  metadata: meta('near_crosschain_quote', 'NEAR Intents Quote', 'Quote a cross-chain swap through NEAR Intents', true),
  definition: {
    type: 'function',
    function: {
      name: 'near_crosschain_quote',
      description: 'Quote a cross-chain swap or move from NEAR to another chain (or another token on NEAR) through NEAR Intents 1Click, without trading. Mainnet only. Destination examples: USDC on base, USDC on near, ETH on eth, BTC on btc, SOL on sol. Pass toChain "?" to list the chains a token is available on.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'NEAR-side token to send, e.g. NEAR or USDC' },
          amount: { type: 'string' },
          toToken: { type: 'string', description: 'Destination token symbol, e.g. USDC' },
          toChain: { type: 'string', description: 'Destination chain id as NEAR Intents names it: near, eth, base, arb, sol, btc, ... Use "?" to list.' },
          recipient: { type: 'string', description: 'Optional destination address; defaults to the signer on NEAR' },
        },
        required: ['from', 'amount', 'toToken', 'toChain'],
      },
    },
  },
  handler: async (a) => {
    try {
      const L = await lib()
      const { cfg } = ctxNet()
      if (a.toChain === '?') {
        const list = await L.intentsTokens(cfg)
        const sym = a.toToken.toUpperCase()
        return { success: true, token: sym, chains: list.filter((t) => t.symbol.toUpperCase() === sym).map((t) => t.blockchain) }
      }
      const signer = L.activeSigner(cfg.network).accountId ?? 'wrap.near'
      const { tin, raw, dest, quote } = await L.quoteCrossChain(cfg, signer, a.from, a.amount, a.toToken, a.toChain, a.recipient)
      return {
        success: true, via: 'NEAR Intents 1Click', send: `${L.fromRaw(raw, tin.decimals)} ${tin.symbol} on NEAR`,
        receive: `${quote.amountOutFormatted ?? L.fromRaw(quote.amountOut, dest.decimals)} ${dest.symbol} on ${dest.blockchain}`,
        minimum: `${L.fromRaw(quote.minAmountOut, dest.decimals)} ${dest.symbol}`, timeEstimateSec: quote.timeEstimate,
      }
    } catch (e) { return fail(e) }
  },
})

export const nearCrossChainPlugin: ToolPlugin<XArgs, R> = createToolPlugin({
  metadata: meta('near_crosschain', 'NEAR Intents Swap', 'Cross-chain swap or move through NEAR Intents', false),
  definition: {
    type: 'function',
    function: {
      name: 'near_crosschain',
      description: 'Execute a cross-chain swap or move through NEAR Intents 1Click (mainnet only): sends the token from the signer on NEAR to a 1Click deposit address, then reports the settlement status. Get a near_crosschain_quote first and state the route and minimum received. recipient is required: the address or account on the destination chain.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string' }, amount: { type: 'string' }, toToken: { type: 'string' }, toChain: { type: 'string' },
          recipient: { type: 'string', description: 'Destination address/account' },
        },
        required: ['from', 'amount', 'toToken', 'toChain', 'recipient'],
      },
    },
  },
  handler: async (a, ctx) => {
    try {
      const L = await lib()
      const { cfg } = ctxNet()
      return await L.runPlan(await L.planCrossChain(cfg, (await signerOrThrow()), a.from, a.amount, a.toToken, a.toChain, a.recipient ?? ''), ctx)
    } catch (e) { return fail(e) }
  },
})

export const nearPlugins = [
  nearAccountPlugin,
  nearSwapQuotePlugin,
  nearSwapPlugin,
  nearStakePlugin,
  nearLendPlugin,
  nearTransferPlugin,
  nearCrossChainQuotePlugin,
  nearCrossChainPlugin,
]
