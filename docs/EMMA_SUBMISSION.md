# Quant Agent: emma Hackathon submission (Builders track)

**Quant Agent** is the personal trading & research assistant inside RealCryptoCap.
Give it a goal and it digs through live market data, strategies and your own bot,
then hands back research you can act on: market reads, risk checks, decision
receipts and runnable trading bots for HTX and Hyperliquid.

- Live product: https://realcryptocap.com/quant-agent (Pro and Ultra members)
- App: https://quant-agent-two.vercel.app
- Code: https://github.com/jamesparser/quant-agent

## How judges test it

1. Sign in on realcryptocap.com with email or Google.
2. Open Account and enter the judge trial code from the private judge notes.
   It unlocks Ultra until 31 Dec 2026.
3. Go to realcryptocap.com/quant-agent and press **Open Quant Agent**.
4. Try: "Run the desk on BTC for the next two weeks and give me one decision."

## What runs in production today

| Piece | Where |
| --- | --- |
| Worker app (jobs, history, specialist agents) | this repo, deployed on Vercel |
| Model lane, plan check, monthly credits | realcryptocap.com `/api/agent` |
| Pro model | ASI1 |
| Ultra model | Agnes + MiniMax M3 |
| Market data tool | cached RealCryptoCap Market Data snapshot (no per-user upstream calls) |
| Decision receipts | RYO, capped per account per day (Pro 5, Ultra 20) |
| Strategy library | quants.md (QuantJourney, Apache-2.0), cached daily |
| User bot import | the user's weighted bot from the Market Data studio |
| Trading desk agents | Macro Strategist, Risk Officer, Bot Engineer, Chief Investment Officer |

## Where emma is essential

Quant Agent sells fixed monthly credits (Pro 25,000, Ultra 75,000). Hosted model
calls are cheap. The expensive work is the GPU lane:

- **Private model jobs.** A member switches a job to an abliterated open-weight
  model (Qwen 27B class, Q4 GGUF) and chooses Standard or Private (TEE) compute.
- **GPU job types.** FinRL policy training, Kronos forecasting, long backtests.

For each GPU job, Quant Agent asks emma for live spot prices across clouds,
picks the cheapest GPU that fits the model size and privacy choice, provisions
it with an init script, runs the job, bills only live compute time (warmup is
free) and tears it down. Model size sets the credit multiplier (1x, 1.5x, 2x).
An operator panel shows the live price comparison, the pick and the margin.

Without that live, cross-cloud pick, a fixed-price credit plan loses money on
heavy users. emma is in the business model, not a demo step.

## Build status

- Done: worker app, plan-gated model lane, live credit ledger, market data,
  decision receipts, strategy library, bot import, trading desk agents, judge
  trial codes.
- In progress for the deadline: emma GPU lane and operator panel, private model
  selector, FinRL and Kronos job types.

## Credits

Built on the open-source `devs` worker application (MIT, upstream notice kept in
`LICENSE`). Strategy library by quants.md / QuantJourney (Apache-2.0).
