# Quant Agent on NEAR (NEAR HACKATHON, 1-14 Nov 2026)

Tracks: `defi` (primary), `agents`, `business`.

**Problem.** Trading on-chain means juggling a DEX, a staking site, a lending app and a bridge, each with its own approvals. Handing that to an AI agent is either unsafe (it holds your keys with no limits) or useless (it can only suggest).

**Product.** Quant Agent is RealCryptoCap's personal trading and research assistant. In the hackathon window we added NEAR: you tell the agent what to do in plain language and it does it on NEAR, cross-chain through NEAR Intents, inside limits you set.

- **Trade:** swap any pair on Rhea (Ref Finance), routed by Rhea's smart router.
- **Earn:** liquid-stake NEAR with Meta Pool (stNEAR) or LiNEAR; exit instantly by swapping back.
- **Lend:** supply to Rhea Lending (formerly Burrow) and withdraw.
- **Move:** send NEAR or tokens; move cross-chain (for example NEAR to USDC on Base, SOL on Solana) through NEAR Intents 1Click.
- **Approvals or YOLO:** every action is shown as a plan (route, minimum received, contracts, USD value) and you approve it, or in YOLO mode the agent wallet acts on its own inside your limits. Over-limit actions always ask, even in YOLO.
- **Spending limits:** per-action and per-day USD caps, and on/off switches per action type (transfers are off by default).
- **Two signers:** your own wallet (NEAR Mobile, HOT, Meteor, Intear, MyNearWallet, OKX, Nightly, Hana, Ledger, MetaMask via Ethereum Wallets, WalletConnect when configured), or an agent wallet: a dedicated NEAR account whose key is generated and encrypted on your device and which can only spend what you fund it with.

## Try it (judges)

1. Go to https://realcryptocap.com, sign in, open **Account** and redeem the trial code from the submission notes (Ultra until 31 Dec 2026).
2. Open https://realcryptocap.com/quant-agent and press **Open Quant Agent**.
3. **Settings > NEAR:** keep **Testnet**, press **Create agent wallet**, and fund it with free testnet NEAR (https://near-faucet.io or any testnet wallet). Choose **Agent wallet** under *Who signs*.
4. In a chat, try:
   - "Check my NEAR account, then quote 0.5 NEAR to USDT on Rhea." **See:** the route, expected and minimum output.
   - "Swap 0.5 NEAR to USDT." **See:** an approval card with the plan; approve it and get explorer links.
   - "Stake 1 NEAR with Meta Pool, then supply 0.2 NEAR to Rhea Lending." **See:** two approvals, then stNEAR and a lending position.
   - Turn on **YOLO** in Settings > NEAR, set per action $5, and ask "Swap 0.3 NEAR to USDC". **See:** it runs without a prompt. Ask for "Swap 10 NEAR to USDT" and **see:** it still asks, because it is over the limit.
5. Cross-chain (mainnet only, NEAR Intents has no testnet): switch to **Mainnet** and ask "Quote moving 1 NEAR to USDC on Base." **See:** a live 1Click quote. Executing needs a funded mainnet wallet.

## How it works

| Piece | File |
|---|---|
| Networks and contracts | `src/lib/near/config.ts` |
| Rhea quotes and swap messages (smart router on mainnet, on-chain `get_return` over pools on testnet) | `src/lib/near/rhea.ts` |
| Action plans: swap, stake, supply/withdraw, transfer, NEAR Intents | `src/lib/near/actions.ts` |
| NEAR Intents 1Click client (tokens, quote, submit, status) | `src/lib/near/intents.ts` |
| USD spending limits and daily ledger | `src/lib/near/policy.ts` |
| Signers: user wallet via `@hot-labs/near-connect`, agent wallet via `near-api-js` | `src/lib/near/signers.ts` |
| Approval / YOLO / signing / follow-up | `src/lib/near/execute.ts` |
| Agent tools (`near_account`, `near_swap_quote`, `near_swap`, `near_stake`, `near_lend`, `near_transfer`, `near_crosschain_quote`, `near_crosschain`) | `src/tools/plugins/near.ts` |
| Settings UI | `src/pages/Settings/components/NearSection.tsx` |

| Protocol | Mainnet | Testnet |
|---|---|---|
| Rhea exchange | `v2.ref-finance.near` | `ref-finance-101.testnet` |
| wNEAR | `wrap.near` | `wrap.testnet` |
| Meta Pool | `meta-pool.near` | `meta-v2.pool.testnet` |
| LiNEAR | `linear-protocol.near` | `linear-protocol.testnet` |
| Rhea Lending | `contract.main.burrow.near` | `contract.dev-burrow.testnet` |
| NEAR Intents 1Click | `https://1click.chaindefuser.com` | none |

Verified live: `scripts/near-smoke.ts` ran swap, stake, instant unstake, supply, withdraw and transfer on testnet; `scripts/near-quotes.ts` runs mainnet Rhea and NEAR Intents quotes; an in-browser YOLO swap signed by the agent wallet.

Not done (stated plainly): borrowing and leveraged positions on Rhea Lending; the agent says so if asked.

## Hackathon disclosure

- **Existing product.** Quant Agent existed before this hackathon as RealCryptoCap's research assistant (first commit 5 Nov 2026, forked from the open-source `devs` app, MIT). Only the NEAR integration is submitted here. It starts after the tag `pre-near-hackathon`; see the diff: https://github.com/jamesparser/quant-agent/compare/pre-near-hackathon...main
- **Other submission by the same team.** $HACK, a NEAR memecoin that funds an autonomous white-hat AI agent: https://github.com/jamesparser/hack-near. The two projects are independent.
- **Libraries.** `@hot-labs/near-connect`, `near-api-js`, `@walletconnect/sign-client`; Rhea smart router and indexer price API; NEAR Intents 1Click API; FastNEAR RPC and API. Rhea's `rhea-sdk` was read for message formats, not copied.
- **AI.** Code written with Claude (Anthropic) as a coding agent, directed and reviewed by the team.
