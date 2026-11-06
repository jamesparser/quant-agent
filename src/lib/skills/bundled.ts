/**
 * Trading skills that ship with Quant Agent.
 *
 * Written for Quant Agent from the public docs of each project (all MIT or
 * Apache-2.0, reviewed for install hooks, obfuscated code and exfiltration before
 * inclusion). They are instructions plus code patterns for the agent; nothing here
 * downloads or runs third-party code in the browser.
 */
import { createCustomSkill, getSkillByName, updateSkill } from '@/stores/skillStore'

interface BundledSkill {
  name: string
  description: string
  skillMdContent: string
}

const BUNDLED_VERSION = 1

export const BUNDLED_SKILLS: BundledSkill[] = [
  {
    name: 'quants-bot-builder',
    description:
      'Turn a strategy from the quants.md open library (or the user weighted bot) into a runnable crypto trading bot for HTX or Hyperliquid.',
    skillMdContent: `# quants.md bot builder

Use when the user wants a trading strategy or a bot.

1. Call \`strategy_library\` and shortlist 2 or 3 strategies that fit the user's goal. Compare return, CAGR, Sharpe, max drawdown, win rate and profit factor. Credit quants.md (QuantJourney, Apache-2.0).
2. If the user has their own bot, call \`my_trading_bot\` and merge its indicator weights into the rules.
3. Call \`market_data\` to check the current regime before recommending live use.
4. Write one complete Python file:
   - data: daily or intraday OHLCV through ccxt (HTX) or the Hyperliquid Info API
   - signal: the strategy rules, parameters at the top
   - sizing: fixed fraction of equity, max leverage parameter
   - risk: stop loss, take profit, max daily loss, kill switch
   - costs: fees and slippage in the backtest
   - modes: \`backtest\`, \`paper\`, \`live\` (live needs an explicit flag)
   - keys from environment variables only
5. Report backtest assumptions and what to check before switching to live.
`,
  },
  {
    name: 'hyperliquid-trading',
    description:
      'Place and manage Hyperliquid perp and spot orders with the official Python SDK, or through a connected Hyperliquid MCP connector.',
    skillMdContent: `# Hyperliquid trading

- If a Hyperliquid connector is connected, use its tools to read positions and place orders. State every order (side, coin, size, type, price, stop) before calling.
- For code, use the official \`hyperliquid-python-sdk\`:
  - \`from hyperliquid.info import Info\` for prices, candles (\`candles_snapshot\`), positions (\`user_state\`)
  - \`from hyperliquid.exchange import Exchange\` with an API wallet (agent key) from env, never the main wallet key
  - orders: \`exchange.order(coin, is_buy, sz, limit_px, {"limit": {"tif": "Gtc"}})\`, market via \`exchange.market_open\`, reduce-only for stops
- Respect size decimals per coin from \`info.meta()\`. Always set a stop.
`,
  },
  {
    name: 'htx-trading',
    description: 'Trade HTX spot and futures through ccxt or a connected HTX MCP connector.',
    skillMdContent: `# HTX trading

- If an HTX connector is connected, use its tools; state each order before placing it.
- For code use ccxt: \`ccxt.htx({"apiKey": os.environ["HTX_KEY"], "secret": os.environ["HTX_SECRET"]})\`.
  - candles: \`fetch_ohlcv(symbol, "1d")\`
  - orders: \`create_order(symbol, "limit", side, amount, price)\`; stops with \`params={"stopPrice": ...}\` where supported
  - load markets first and round amount and price with \`amount_to_precision\` / \`price_to_precision\`
- HTX daily bars open at 16:00 UTC, so align any comparison with UTC daily data.
`,
  },
  {
    name: 'kronos-forecast',
    description:
      'Forecast the next candles of a coin with Kronos, an open foundation model for K-line data (MIT, NeoQuasar on Hugging Face).',
    skillMdContent: `# Kronos candle forecast

Kronos (github.com/shiyu-coder/Kronos, MIT) forecasts OHLCV candles. Kronos-mini (4.1M) and Kronos-small (24.7M) run on a laptop CPU; Kronos-base (102M) is better on a GPU.

Setup the user runs once:
\`\`\`bash
git clone https://github.com/shiyu-coder/Kronos && cd Kronos
pip install -r requirements.txt
\`\`\`

Pattern:
\`\`\`python
from model import Kronos, KronosTokenizer, KronosPredictor
tok = KronosTokenizer.from_pretrained("NeoQuasar/Kronos-Tokenizer-base")
model = Kronos.from_pretrained("NeoQuasar/Kronos-small")
pred = KronosPredictor(model, tok, max_context=512)
# df: columns open, high, low, close, volume (amount optional); lookback <= 512
out = pred.predict(df=x_df, x_timestamp=x_ts, y_timestamp=y_ts, pred_len=24, T=1.0, top_p=0.9, sample_count=5)
\`\`\`

- Fetch candles with ccxt or Hyperliquid, keep timestamps in UTC.
- Use sample_count > 1 and report the spread of paths, not one line.
- A forecast is one input. Combine it with \`market_data\` and a risk check before any trade.
`,
  },
  {
    name: 'finrl-trainer',
    description:
      'Train a deep reinforcement learning trading policy on crypto with FinRL (MIT, AI4Finance Foundation).',
    skillMdContent: `# FinRL crypto policy training

FinRL (github.com/AI4Finance-Foundation/FinRL, MIT) trains RL agents (PPO, A2C, SAC, TD3, DDPG) for trading.

Setup:
\`\`\`bash
pip install git+https://github.com/AI4Finance-Foundation/FinRL.git
\`\`\`

Pattern for crypto:
- Data: \`finrl.meta.data_processors.processor_ccxt\` (or your own ccxt pull) to daily or hourly OHLCV for a basket, then add indicators (MACD, RSI, CCI, ADX) with FinRL's feature engineer.
- Environment: \`finrl.meta.env_cryptocurrency_trading.env_multiple_crypto\` (CryptoEnv) with fees and an initial capital.
- Train with the DRL agent wrapper (Stable-Baselines3), split train / validation / test by date, never shuffle.
- Evaluate on the out-of-sample window against buy and hold: Sharpe, max drawdown, turnover.
- Short runs fit on a laptop CPU; longer training is a GPU job.

Report the split dates, hyperparameters, and out-of-sample results. Never present in-sample results as performance.
`,
  },
]

/** Install the bundled skills once per browser (and again when the set changes). */
export function ensureBundledSkills(): void {
  try {
    const key = 'qa:bundled-skills'
    if (localStorage.getItem(key) === String(BUNDLED_VERSION)) return
    for (const s of BUNDLED_SKILLS) {
      const existing = getSkillByName(s.name)
      if (existing) {
        updateSkill(existing.id, { description: s.description, skillMdContent: s.skillMdContent })
      } else {
        createCustomSkill(s)
      }
    }
    localStorage.setItem(key, String(BUNDLED_VERSION))
  } catch {
    // Storage or the skill store not ready yet: try again on the next load.
  }
}
