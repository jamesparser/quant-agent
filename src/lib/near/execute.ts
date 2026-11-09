/**
 * Run a NEAR plan: spending-limit check, approval (or YOLO), signing, follow-up.
 *
 * - Approval mode: the user sees the plan in chat (Approve / Reject). With their
 *   own wallet as signer the wallet asks again; with the agent wallet the chat
 *   approval is the only prompt.
 * - YOLO mode ("Approve all actions" in Settings, Features) with the agent
 *   wallet: actions inside the spending limits run without a prompt. Anything
 *   over a limit still asks, even in YOLO. Disabled action kinds never run.
 *
 * @module lib/near/execute
 */
import { nearBalance } from './rpc'
import { requestHumanInput } from '@/lib/hitl'
import { getEffectiveSettings } from '@/stores/userStore'
import { NETWORKS, txUrl } from './config'
import { checkPolicy, planUsd, recordSpend } from './policy'
import { signPlanTxs } from './signers'
import { nearState } from './state'
import type { Plan } from './types'

export interface RunContext { conversationId?: string; agentId?: string }

export async function runPlan(plan: Plan, ctx: RunContext) {
  const s = nearState()
  const mode = s.signer
  const usd = await planUsd(plan).catch(() => null)
  const verdict = checkPolicy(plan, usd, s.limits, s.ledger)
  if (!verdict.ok && verdict.blocked) throw new Error(verdict.reason)
  await assertGasAffordable(plan)

  const yolo = getEffectiveSettings().yoloMode ?? false
  const silent = yolo && verdict.ok && mode === 'agent'
  if (!silent) {
    if (!ctx.conversationId) throw new Error('This NEAR action needs your approval. Run it from a chat so you can approve it.')
    const value = usd === null ? 'unpriced' : `about $${usd.toFixed(2)}`
    const who = mode === 'agent' ? `agent wallet \`${plan.signer}\`` : `your wallet \`${plan.signer}\``
    const lines = [
      `**NEAR ${plan.network}: ${plan.title}**`,
      '',
      ...plan.details.map((d) => `- ${d}`),
      `- Signer: ${who}`,
      `- Value: ${value}; ${plan.txs.length} transaction${plan.txs.length > 1 ? 's' : ''} to ${Array.from(new Set(plan.txs.map((t) => t.receiverId))).join(', ')}`,
      ...(!verdict.ok ? ['', `⚠️ ${verdict.reason} Approve only if you mean it.`] : []),
      ...(mode === 'wallet' ? ['', 'Your wallet will ask you to confirm too.'] : []),
    ]
    const r = await requestHumanInput({
      conversationId: ctx.conversationId,
      agentId: ctx.agentId || 'devs',
      type: 'approval',
      question: lines.join('\n'),
      alwaysAsk: !verdict.ok,
      quickReplies: [
        { label: 'Approve', value: 'approve', color: 'success' },
        { label: 'Reject', value: 'reject', color: 'danger' },
      ],
    })
    if (r.value !== 'approve') throw new Error('The user rejected this NEAR action. Do not retry it unless they ask.')
  }

  const hashes = await signPlanTxs(plan.network, mode, plan.txs)
  nearState().setLedger(recordSpend(nearState().ledger, usd))
  const follow = plan.followUp ? await plan.followUp(hashes).catch((e) => ({ followUpError: (e as Error).message })) : {}
  const cfg = NETWORKS[plan.network]
  return {
    success: true as const,
    done: plan.title,
    network: plan.network,
    signer: plan.signer,
    signedBy: mode === 'agent' ? 'agent wallet' : 'user wallet',
    approval: silent ? 'auto (YOLO, within limits)' : 'approved by user',
    valueUsd: usd === null ? null : Number(usd.toFixed(2)),
    transactions: hashes.filter(Boolean).map((h) => txUrl(cfg, h)),
    ...follow,
  }
}

/**
 * NEAR charges prepaid gas up front at a pessimistic price (about 0.001 NEAR
 * per Tgas, most of it refunded), so an account needs that much free NEAR when
 * each transaction is sent, on top of attached deposits. Check the whole plan
 * before asking for approval, so a trade never stops halfway.
 */
async function assertGasAffordable(plan: Plan) {
  const cfg = NETWORKS[plan.network]
  const b = await nearBalance(cfg, plan.signer)
  let free = b.amount - b.storage
  const PER_TGAS = 10n ** 21n // 0.001 NEAR
  for (let i = 0; i < plan.txs.length; i++) {
    const tx = plan.txs[i]
    let deposit = 0n
    let tgas = 0n
    for (const a of tx.actions) {
      deposit += BigInt(a.params.deposit ?? 0)
      if (a.type === 'FunctionCall') tgas += BigInt(a.params.gas) / 10n ** 12n
    }
    const need = deposit + tgas * PER_TGAS + 10n ** 21n
    if (free < need) {
      const fmt = (y: bigint) => (Number(y) / 1e24).toFixed(4)
      throw new Error(
        `Not enough NEAR for gas: transaction ${i + 1} of ${plan.txs.length} needs about ${fmt(need)} NEAR free when it is sent ` +
          `(NEAR reserves gas up front and refunds most of it), but ${plan.signer} would have ${fmt(free < 0n ? 0n : free)} NEAR. ` +
          'Nothing was executed. Add NEAR to this wallet, unwrap wNEAR (near_swap WNEAR to NEAR), or use a smaller amount.',
      )
    }
    free -= deposit + 2n * 10n ** 21n // deposits leave; assume about 0.002 NEAR of gas is burnt
  }
}
