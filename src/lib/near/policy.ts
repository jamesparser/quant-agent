/**
 * Spending limits for NEAR actions, valued in USD.
 *
 * Limits are checked before every action. In YOLO mode an action inside the
 * limits runs without a prompt; anything over a limit (or of a disabled kind)
 * falls back to asking the user, or is refused if the kind is switched off.
 *
 * @module lib/near/policy
 */
import { NATIVE } from './config'
import { prices } from './rpc'
import { PRICE_TWIN } from './tokens'
import type { ActionKind, Plan } from './types'

export interface NearLimits {
  /** Max USD value per action. */
  perActionUsd: number
  /** Max USD value across all actions per UTC day. */
  dailyUsd: number
  /** Action kinds the agent may run at all. */
  allowed: Record<ActionKind, boolean>
}

export const DEFAULT_LIMITS: NearLimits = {
  perActionUsd: 10,
  dailyUsd: 25,
  allowed: { swap: true, stake: true, lend: true, withdraw: true, transfer: false, wrap: true, crosschain: true },
}

export interface SpendLedger { day: string; usd: number }

export const today = () => new Date().toISOString().slice(0, 10)

export async function planUsd(plan: Plan): Promise<number | null> {
  if (plan.spend.raw === 0n) return 0
  const id = plan.spend.token.id
  const twin = plan.network === 'testnet' ? PRICE_TWIN[id] : id === NATIVE ? 'wrap.near' : id
  if (!twin) return null
  const p = (await prices())[twin]
  if (!p) return null
  return (Number(plan.spend.raw) / 10 ** plan.spend.token.decimals) * Number(p.price)
}

export type PolicyVerdict =
  | { ok: true; usd: number | null }
  | { ok: false; usd: number | null; blocked: boolean; reason: string }

export function checkPolicy(plan: Plan, usd: number | null, limits: NearLimits, ledger: SpendLedger): PolicyVerdict {
  if (!limits.allowed[plan.kind]) {
    return { ok: false, usd, blocked: true, reason: `"${plan.kind}" actions are switched off in Settings > NEAR.` }
  }
  if (usd === null) return { ok: false, usd, blocked: false, reason: 'No USD price for this token, so the limits cannot be checked.' }
  if (usd > limits.perActionUsd) {
    return { ok: false, usd, blocked: false, reason: `$${usd.toFixed(2)} is over the per-action limit of $${limits.perActionUsd}.` }
  }
  const spent = ledger.day === today() ? ledger.usd : 0
  if (spent + usd > limits.dailyUsd) {
    return { ok: false, usd, blocked: false, reason: `This would bring today's total to $${(spent + usd).toFixed(2)}, over the daily limit of $${limits.dailyUsd}.` }
  }
  return { ok: true, usd }
}

export function recordSpend(ledger: SpendLedger, usd: number | null): SpendLedger {
  const base = ledger.day === today() ? ledger.usd : 0
  return { day: today(), usd: base + (usd ?? 0) }
}
