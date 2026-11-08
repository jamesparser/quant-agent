/**
 * RealCryptoCap tools for Quant Agent.
 *
 * Every call goes to realcryptocap.com/api/agent/tools/*, which checks the
 * account plan, serves cached data (never a fresh upstream call per user) and
 * enforces per-account daily caps (decision receipts).
 *
 * @module tools/plugins/realcryptocap
 */
import { createToolPlugin } from '../registry'
import type { ToolPlugin } from '../types'
import { gatewayFetch } from '@/lib/auth/gatewayFetch'
import { gatewayBase } from '@/lib/llm/managed-lane'

type ToolResult = { success: true; [k: string]: unknown } | { success: false; error: string }

async function call(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<ToolResult> {
  try {
    const res = await gatewayFetch(`${gatewayBase()}/tools/${path}`, { ...init, signal })
    const body = await res.json().catch(() => ({}))
    if (res.status === 401 || res.status === 403) {
      return { success: false, error: 'Open Quant Agent from realcryptocap.com/quant-agent with a Pro or Ultra account.' }
    }
    if (!res.ok) return { success: false, error: String(body.error?.message || body.error || `Request failed (${res.status})`) }
    return { success: true, ...body }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

const SECTIONS = ['btc', 'realCrypto', 'reportedMarket', 'stablecoins', 'etfFlows', 'fearGreed', 'derivativesPulse', 'globalLiquidity', 'cryptoquant', 'hashrate', 'signals', 'botSignal']

export const marketDataPlugin: ToolPlugin<{ section?: string }, ToolResult> = createToolPlugin({
  metadata: {
    name: 'market_data',
    displayName: 'Market Data',
    shortDescription: 'RealCryptoCap market data: valuation, flows, derivatives, liquidity, sentiment',
    icon: 'StatsReport',
    category: 'research',
    tags: ['crypto', 'market', 'bitcoin', 'etf', 'derivatives', 'realcryptocap'],
    enabledByDefault: true,
    estimatedDuration: 2000,
    requiresConfirmation: false,
  },
  definition: {
    type: 'function',
    function: {
      name: 'market_data',
      description:
        'Get the current RealCryptoCap Market Data terminal snapshot: BTC and ETH price and on-chain valuation (MVRV, Puell, NUPL, cost floor), real versus reported market cap, ETF flows, derivatives (funding, open interest, options), stablecoin supply, global liquidity, hashrate and Fear and Greed. Use it before any market view, trade idea or bot design. Optionally narrow to one section.',
      parameters: {
        type: 'object',
        properties: { section: { type: 'string', enum: SECTIONS, description: 'Optional section to return.' } },
      },
    },
  },
  handler: async (args, ctx) => {
    const q = args.section && SECTIONS.includes(args.section) ? `?section=${encodeURIComponent(args.section)}` : ''
    return call(`market${q}`, {}, ctx.abortSignal)
  },
})

export const decisionReceiptPlugin: ToolPlugin<{ symbol: string; question?: string }, ToolResult> = createToolPlugin({
  metadata: {
    name: 'decision_receipt',
    displayName: 'Decision Receipt',
    shortDescription: 'RYO decision receipt for a coin (daily limit per account)',
    icon: 'Page',
    category: 'research',
    tags: ['crypto', 'ryo', 'decision', 'receipt', 'trade'],
    enabledByDefault: true,
    estimatedDuration: 6000,
    requiresConfirmation: false,
  },
  definition: {
    type: 'function',
    function: {
      name: 'decision_receipt',
      description:
        'Get a RYO decision receipt for one coin: market overview, sentiment and a structured read of the setup. Each account has a small daily allowance, so call it once per coin per job, only when the user is weighing a specific trade.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Ticker, for example BTC, ETH, SOL, HYPE.' },
          question: { type: 'string', description: 'The decision being weighed, in one sentence.' },
        },
        required: ['symbol'],
      },
    },
  },
  handler: async (args, ctx) =>
    call('ryo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) }, ctx.abortSignal),
  validate: (args) => {
    const p = args as { symbol: string; question?: string }
    if (typeof p.symbol !== 'string' || !p.symbol.trim()) throw new Error('symbol is required')
    return p
  },
})

export const strategyLibraryPlugin: ToolPlugin<Record<string, never>, ToolResult> = createToolPlugin({
  metadata: {
    name: 'strategy_library',
    displayName: 'Strategy Library',
    shortDescription: 'quants.md open library of backtested trading strategies',
    icon: 'Book',
    category: 'research',
    tags: ['strategy', 'backtest', 'bot', 'quants.md'],
    enabledByDefault: true,
    estimatedDuration: 2000,
    requiresConfirmation: false,
  },
  definition: {
    type: 'function',
    function: {
      name: 'strategy_library',
      description:
        'Read the quants.md open library of 50 backtested trading strategies (rules, return, CAGR, Sharpe, max drawdown, win rate, profit factor). Use it when the user wants a strategy or a trading bot: pick candidates, explain the trade-offs, then adapt the rules to crypto and to HTX or Hyperliquid order types. Credit quants.md (QuantJourney, Apache-2.0).',
      parameters: { type: 'object', properties: {} },
    },
  },
  handler: async (_args, ctx) => call('quants', {}, ctx.abortSignal),
})

export const myBotPlugin: ToolPlugin<Record<string, never>, ToolResult> = createToolPlugin({
  metadata: {
    name: 'my_trading_bot',
    displayName: 'My Weighted Bot',
    shortDescription: 'Your weighted bot and its live signal from the Market Data studio',
    icon: 'Cpu',
    category: 'research',
    tags: ['bot', 'signal', 'weights', 'indicators'],
    enabledByDefault: true,
    estimatedDuration: 2000,
    requiresConfirmation: false,
  },
  definition: {
    type: 'function',
    function: {
      name: 'my_trading_bot',
      description:
        "Load the user's own weighted trading bot from the RealCryptoCap Market Data studio: indicator importance weights (0 to 5), normalised shares and the current combined signal. Use it when the user asks to review, improve, backtest or export their bot.",
      parameters: { type: 'object', properties: {} },
    },
  },
  handler: async (_args, ctx) => call('bot', {}, ctx.abortSignal),
})

const WEIGHT_KEYS = 'trend, momentum, range, volume, volatility, fear_greed, funding_rate, long_short, stablecoin_liquidity, mvrv_ratio, nupl, puell_multiple, electric_cost, halving_cycle, lunar_cycle, max_pain, darth_maul'

type BacktestArgs = {
  asset?: string
  period?: string
  weights?: Record<string, number>
  entryThreshold?: number
  exitThreshold?: number
  leverage?: number
  feeRatePct?: number
}

export const backtestPlugin: ToolPlugin<BacktestArgs, ToolResult> = createToolPlugin({
  metadata: {
    name: 'backtest_strategy',
    displayName: 'Backtest',
    shortDescription: 'Backtest a weighted strategy on RealCryptoCap historical data',
    icon: 'GraphUp',
    category: 'research',
    tags: ['backtest', 'bot', 'strategy', 'weights'],
    enabledByDefault: true,
    estimatedDuration: 5000,
    requiresConfirmation: false,
  },
  definition: {
    type: 'function',
    function: {
      name: 'backtest_strategy',
      description:
        `Backtest a weighted signal strategy with the RealCryptoCap Market Data backtester engine and its historical candles and signals. Without weights it uses the user's own Market Data bot weights. Pro: BTC up to 1y. Ultra: BTC, ETH, SOL, HYPE, XRP, LINK, XLM up to 10y. Weight keys: ${WEIGHT_KEYS}. Goes long when the composite score crosses entryThreshold and exits below exitThreshold. Returns strategy vs buy-and-hold return, win rate, profit factor, max drawdown, Sharpe, trades and an equity curve.`,
      parameters: {
        type: 'object',
        properties: {
          asset: { type: 'string', enum: ['BTC', 'ETH', 'SOL', 'HYPE', 'XRP', 'LINK', 'XLM'] },
          period: { type: 'string', enum: ['30d', '90d', '180d', '1y', '3y', '5y', '10y'] },
          weights: { type: 'object', description: 'Optional weights by signal key, any positive scale.' },
          entryThreshold: { type: 'number', description: 'Composite score 0-100 to enter. Default 60.' },
          exitThreshold: { type: 'number', description: 'Composite score 0-100 to exit. Default 40.' },
          leverage: { type: 'number', description: '1 to 30. Default 1.' },
          feeRatePct: { type: 'number', description: 'Fee per side in percent. Default 0.075.' },
        },
      },
    },
  },
  handler: async (args, ctx) =>
    call('backtest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args ?? {}) }, ctx.abortSignal),
})

export const paperAccountPlugin: ToolPlugin<BacktestArgs & { action?: string }, ToolResult> = createToolPlugin({
  metadata: {
    name: 'paper_account',
    displayName: 'Paper Account',
    shortDescription: 'Follow a signal strategy with $10,000 of virtual money',
    icon: 'Coins',
    category: 'research',
    tags: ['paper', 'virtual', 'bot', 'pnl'],
    enabledByDefault: true,
    estimatedDuration: 4000,
    requiresConfirmation: false,
  },
  definition: {
    type: 'function',
    function: {
      name: 'paper_account',
      description:
        "Paper trade a weighted signal strategy with $10,000 of virtual money from today. action 'start' (or 'reset') sets the asset, weights and thresholds (defaults to the user's Market Data bot weights). action 'status' returns days running, closed trades, equity, P&L and the equity curve. Use it so a user can watch a strategy trade before going live.",
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['start', 'reset', 'status'] },
          asset: { type: 'string', enum: ['BTC', 'ETH', 'SOL', 'HYPE', 'XRP', 'LINK', 'XLM'] },
          weights: { type: 'object' },
          entryThreshold: { type: 'number' },
          exitThreshold: { type: 'number' },
          leverage: { type: 'number' },
        },
      },
    },
  },
  handler: async (args, ctx) =>
    call('paper', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args ?? {}) }, ctx.abortSignal),
})

export const realCryptoCapPlugins = [
  marketDataPlugin,
  decisionReceiptPlugin,
  strategyLibraryPlugin,
  myBotPlugin,
  backtestPlugin,
  paperAccountPlugin,
]
