/**
 * Heavy NEAR modules (near-api-js, near-connect, RPC helpers) behind one dynamic
 * import, so the tool definitions stay out of the app's boot graph.
 * @module lib/near/lazy
 */
export { nearBalance, ftHoldings } from './rpc'
export { resolveToken, fromRaw, toRaw } from './tokens'
export { quoteSwap } from './rhea'
export { intentsTokens } from './intents'
export { planSwap, planStake, planSupply, planWithdrawSupply, planTransfer, planCrossChain, quoteCrossChain } from './actions'
export { runPlan } from './execute'
export { activeSigner } from './signers'
