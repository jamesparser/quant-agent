/**
 * Build NEAR action plans: swaps (Rhea), liquid staking (Meta Pool, LiNEAR),
 * lending (Rhea Lending / Burrow), transfers and cross-chain moves (NEAR Intents).
 *
 * A plan is a list of transactions plus a human-readable summary. Nothing here
 * signs anything; signers.ts does, after the policy and approval checks.
 *
 * @module lib/near/actions
 */
import { type NetworkConfig, NATIVE, ONE_YOCTO } from './config'
import { accountExists, isRegistered, nearBalance, ftBalance, storageMin } from './rpc'
import { resolveToken, toRaw, fromRaw, type TokenInfo } from './tokens'
import { quoteSwap, swapMsg } from './rhea'
import { findAsset, intentsQuote, submitDeposit, waitForIntents } from './intents'
import { fc, transfer, type NearTx, type Plan } from './types'

/** Whole-unit amount to raw units; "all" or "max" means the signer's full spendable balance. */
export async function amountToRaw(cfg: NetworkConfig, signer: string, token: TokenInfo, amount: string, keepNative = 0n): Promise<bigint> {
  if (/^\s*(all|max|everything)\s*$/i.test(amount)) {
    const raw = token.id === NATIVE ? (await nearBalance(cfg, signer)).available - keepNative : await ftBalance(cfg, token.id, signer)
    if (raw <= 0n) throw new Error(`${signer} has no spendable ${token.symbol}.`)
    return raw
  }
  return toRaw(amount, token.decimals)
}

async function assertSpendable(cfg: NetworkConfig, signer: string, token: TokenInfo, raw: bigint) {
  if (token.id === NATIVE) {
    const b = await nearBalance(cfg, signer)
    if (b.available < raw) throw new Error(`${signer} has ${fromRaw(b.available, 24, 4)} NEAR available (after storage and a 0.05 NEAR gas reserve); needs ${fromRaw(raw, 24, 4)}.`)
  } else {
    const b = await ftBalance(cfg, token.id, signer)
    if (b < raw) throw new Error(`${signer} holds ${fromRaw(b, token.decimals)} ${token.symbol}; needs ${fromRaw(raw, token.decimals)}.`)
  }
}

/** storage_deposit for `account` on `token` if it is not registered yet. */
async function registerIfNeeded(cfg: NetworkConfig, token: string, account: string): Promise<NearTx | null> {
  if (await isRegistered(cfg, token, account)) return null
  const min = await storageMin(cfg, token)
  return { receiverId: token, actions: [fc('storage_deposit', { account_id: account, registration_only: true }, 30, min)] }
}

/** Wrap native NEAR into wNEAR (registering on wrap first if needed). */
async function wrapTx(cfg: NetworkConfig, signer: string, raw: bigint): Promise<NearTx> {
  const reg = await registerIfNeeded(cfg, cfg.wrap, signer)
  return { receiverId: cfg.wrap, actions: [...(reg ? reg.actions : []), fc('near_deposit', {}, 10, raw)] }
}

// ---------------------------------------------------------------------------
// Swap
// ---------------------------------------------------------------------------
export async function planSwap(cfg: NetworkConfig, signer: string, from: string, to: string, amount: string, slippageBps = 50): Promise<Plan> {
  const tin = await resolveToken(cfg, from)
  const tout = await resolveToken(cfg, to)
  // Selling all NEAR: keep enough for the swap transaction's up-front gas.
  const raw = await amountToRaw(cfg, signer, tin, amount, 2n * 10n ** 23n)
  await assertSpendable(cfg, signer, tin, raw)
  const inId = tin.id === NATIVE ? cfg.wrap : tin.id
  const outId = tout.id === NATIVE ? cfg.wrap : tout.id

  if (inId === outId) return planWrap(cfg, signer, tin, tout, raw)

  const q = await quoteSwap(cfg, inId, outId, raw, slippageBps)
  const txs: NearTx[] = []
  if (tin.id === NATIVE) txs.push(await wrapTx(cfg, signer, raw))
  const reg = await registerIfNeeded(cfg, outId, signer)
  if (reg) txs.push(reg)
  txs.push({ receiverId: inId, actions: [fc('ft_transfer_call', { receiver_id: cfg.ref, amount: raw.toString(), msg: swapMsg(q.actions) }, 180, ONE_YOCTO)] })
  if (tout.id === NATIVE) txs.push({ receiverId: cfg.wrap, actions: [fc('near_withdraw', { amount: q.minAmountOut.toString() }, 10, ONE_YOCTO)] })

  return {
    kind: 'swap', network: cfg.network, signer,
    title: `Swap ${fromRaw(raw, tin.decimals)} ${tin.symbol} for about ${fromRaw(q.amountOut, tout.decimals)} ${tout.symbol} on Rhea`,
    details: [
      `Route: ${q.route}`,
      `Minimum received: ${fromRaw(q.minAmountOut, tout.decimals)} ${tout.symbol} (slippage ${slippageBps / 100}%)`,
      ...(tin.id === NATIVE ? ['Wraps NEAR to wNEAR first'] : []),
      ...(tout.id === NATIVE ? ['Unwraps the minimum received back to NEAR'] : []),
    ],
    txs, spend: { token: tin, raw },
  }
}

function planWrap(cfg: NetworkConfig, signer: string, tin: TokenInfo, tout: TokenInfo, raw: bigint): Promise<Plan> | Plan {
  if (tin.id === NATIVE) {
    return wrapTx(cfg, signer, raw).then((tx) => ({
      kind: 'wrap' as const, network: cfg.network, signer,
      title: `Wrap ${fromRaw(raw, 24)} NEAR into wNEAR`, details: [`Contract: ${cfg.wrap}`], txs: [tx], spend: { token: tin, raw },
    }))
  }
  return {
    kind: 'wrap', network: cfg.network, signer,
    title: `Unwrap ${fromRaw(raw, 24)} wNEAR into NEAR`, details: [`Contract: ${cfg.wrap}`],
    txs: [{ receiverId: cfg.wrap, actions: [fc('near_withdraw', { amount: raw.toString() }, 10, ONE_YOCTO)] }],
    spend: { token: tout.id === NATIVE ? tin : tin, raw },
  }
}

// ---------------------------------------------------------------------------
// Liquid staking
// ---------------------------------------------------------------------------
export async function planStake(cfg: NetworkConfig, signer: string, provider: 'metapool' | 'linear', amount: string): Promise<Plan> {
  const near: TokenInfo = { id: NATIVE, symbol: 'NEAR', decimals: 24 }
  const raw = toRaw(amount, 24)
  if (raw < 10n ** 24n) throw new Error('Liquid staking needs at least 1 NEAR (the Meta Pool and LiNEAR minimum).')
  await assertSpendable(cfg, signer, near, raw)
  const contract = provider === 'linear' ? cfg.linear : cfg.metaPool
  const name = provider === 'linear' ? 'LiNEAR' : 'Meta Pool'
  const token = provider === 'linear' ? 'LiNEAR' : 'stNEAR'
  return {
    kind: 'stake', network: cfg.network, signer,
    title: `Stake ${fromRaw(raw, 24)} NEAR with ${name} for ${token}`,
    details: [`Contract: ${contract} (deposit_and_stake)`, `Exit instantly any time by swapping ${token} back to NEAR on Rhea`],
    txs: [{ receiverId: contract, actions: [fc('deposit_and_stake', {}, 50, raw)] }],
    spend: { token: near, raw },
  }
}

// ---------------------------------------------------------------------------
// Lending (Rhea Lending / Burrow). Supplied assets earn interest; no borrowing.
// ---------------------------------------------------------------------------
export async function planSupply(cfg: NetworkConfig, signer: string, tokenIn: string, amount: string): Promise<Plan> {
  const t = await resolveToken(cfg, tokenIn)
  const raw = await amountToRaw(cfg, signer, t, amount)
  await assertSpendable(cfg, signer, t, raw)
  const id = t.id === NATIVE ? cfg.wrap : t.id
  const txs: NearTx[] = []
  if (t.id === NATIVE) txs.push(await wrapTx(cfg, signer, raw))
  if (!(await isRegistered(cfg, cfg.burrow, signer))) {
    const min = await storageMin(cfg, cfg.burrow)
    const dep = min > 10n ** 23n ? min : 10n ** 23n // Rhea Lending asks 0.1 NEAR
    txs.push({ receiverId: cfg.burrow, actions: [fc('storage_deposit', { account_id: signer }, 30, dep)] })
  }
  txs.push({ receiverId: id, actions: [fc('ft_transfer_call', { receiver_id: cfg.burrow, amount: raw.toString(), msg: '' }, 200, ONE_YOCTO)] })
  return {
    kind: 'lend', network: cfg.network, signer,
    title: `Supply ${fromRaw(raw, t.decimals)} ${t.symbol} to Rhea Lending`,
    details: [`Contract: ${cfg.burrow}`, 'Earns the supply rate; not used as collateral and nothing is borrowed', ...(t.id === NATIVE ? ['Wraps NEAR to wNEAR first'] : [])],
    txs, spend: { token: t, raw },
  }
}

export async function planWithdrawSupply(cfg: NetworkConfig, signer: string, tokenIn: string): Promise<Plan> {
  const t = await resolveToken(cfg, tokenIn)
  const id = t.id === NATIVE ? cfg.wrap : t.id
  return {
    kind: 'withdraw', network: cfg.network, signer,
    title: `Withdraw all supplied ${t.id === NATIVE ? 'wNEAR' : t.symbol} from Rhea Lending`,
    details: [`Contract: ${cfg.burrow} (execute Withdraw)`, 'Returns to this account; wNEAR stays wrapped (unwrap separately)'],
    txs: [{ receiverId: cfg.burrow, actions: [fc('execute', { actions: [{ Withdraw: { token_id: id } }] }, 250, ONE_YOCTO)] }],
    spend: { token: t, raw: 0n },
  }
}

// ---------------------------------------------------------------------------
// Transfer
// ---------------------------------------------------------------------------
export async function planTransfer(cfg: NetworkConfig, signer: string, tokenIn: string, amount: string, receiver: string): Promise<Plan> {
  const t = await resolveToken(cfg, tokenIn)
  const raw = await amountToRaw(cfg, signer, t, amount)
  const to = receiver.trim().toLowerCase()
  const implicit = /^[0-9a-f]{64}$/.test(to)
  if (!implicit && !(await accountExists(cfg, to))) throw new Error(`Account ${to} does not exist on ${cfg.network}.`)
  await assertSpendable(cfg, signer, t, raw)
  const txs: NearTx[] = []
  if (t.id === NATIVE) {
    txs.push({ receiverId: to, actions: [transfer(raw)] })
  } else {
    const reg = await registerIfNeeded(cfg, t.id, to)
    txs.push({ receiverId: t.id, actions: [...(reg ? reg.actions : []), fc('ft_transfer', { receiver_id: to, amount: raw.toString() }, 30, ONE_YOCTO)] })
  }
  return {
    kind: 'transfer', network: cfg.network, signer,
    title: `Send ${fromRaw(raw, t.decimals)} ${t.symbol} to ${to}`,
    details: t.id === NATIVE ? ['Native NEAR transfer'] : [`Token contract: ${t.id}`],
    txs, spend: { token: t, raw },
  }
}

// ---------------------------------------------------------------------------
// Cross-chain (NEAR Intents 1Click, mainnet)
// ---------------------------------------------------------------------------
export async function quoteCrossChain(cfg: NetworkConfig, signer: string, from: string, amount: string, toSymbol: string, toChain: string, recipient?: string) {
  const tin = await resolveToken(cfg, from)
  const raw = await amountToRaw(cfg, signer, tin, amount)
  const inId = tin.id === NATIVE ? cfg.wrap : tin.id
  const dest = await findAsset(cfg, toSymbol, toChain)
  // Placeholder recipient for dry quotes only (1Click rejects burn addresses); a real move always needs the user's recipient.
  const evmDummy = '0xC104c39b4E34E62925a9F8E0f0BEAe44Ed0Fe500'
  const rcpt = recipient || (dest.blockchain === 'near' ? signer : /^(eth|base|arb|op|pol|bsc|avax|gnosis|bera)/.test(dest.blockchain) ? evmDummy : '')
  if (!rcpt) throw new Error(`Give a ${dest.blockchain} recipient address to quote this route.`)
  const q = await intentsQuote(cfg, { originAsset: `nep141:${inId}`, destinationAsset: dest.assetId, amount: raw, recipient: rcpt, refundTo: signer, dry: true })
  return { tin, raw, dest, quote: q }
}

export async function planCrossChain(cfg: NetworkConfig, signer: string, from: string, amount: string, toSymbol: string, toChain: string, recipient: string): Promise<Plan> {
  if (!recipient) throw new Error('recipient is required (an account or address on the destination chain)')
  const tin = await resolveToken(cfg, from)
  const raw = await amountToRaw(cfg, signer, tin, amount)
  await assertSpendable(cfg, signer, tin, raw)
  const inId = tin.id === NATIVE ? cfg.wrap : tin.id
  const dest = await findAsset(cfg, toSymbol, toChain)
  const q = await intentsQuote(cfg, { originAsset: `nep141:${inId}`, destinationAsset: dest.assetId, amount: raw, recipient, refundTo: signer, dry: false })
  if (!q.depositAddress) throw new Error('NEAR Intents did not return a deposit address.')
  const deposit = q.depositAddress
  const txs: NearTx[] = []
  if (tin.id === NATIVE) txs.push(await wrapTx(cfg, signer, raw))
  const reg = await registerIfNeeded(cfg, inId, deposit)
  txs.push({ receiverId: inId, actions: [...(reg ? reg.actions : []), fc('ft_transfer', { receiver_id: deposit, amount: raw.toString(), memo: 'quant-agent near-intents' }, 30, ONE_YOCTO)] })
  const outHuman = q.amountOutFormatted ?? fromRaw(q.amountOut, dest.decimals)
  return {
    kind: 'crosschain', network: cfg.network, signer,
    title: `Move ${fromRaw(raw, tin.decimals)} ${tin.symbol} to about ${outHuman} ${dest.symbol} on ${dest.blockchain} via NEAR Intents`,
    details: [
      `Recipient: ${recipient}`,
      `Minimum received: ${fromRaw(q.minAmountOut, dest.decimals)} ${dest.symbol}`,
      `Deposit address (1Click): ${deposit}`,
      `Refunds go back to ${signer} if the swap cannot complete`,
    ],
    txs, spend: { token: tin, raw },
    followUp: async (hashes) => {
      const last = hashes[hashes.length - 1]
      if (last) await submitDeposit(cfg, deposit, last)
      const st = await waitForIntents(cfg, deposit)
      return { intentsStatus: st.status, depositAddress: deposit }
    },
  }
}
