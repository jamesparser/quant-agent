/**
 * Shared types for NEAR action plans.
 * @module lib/near/types
 */
import type { NearNetwork } from './config'
import type { TokenInfo } from './tokens'

export type NearAction =
  | { type: 'FunctionCall'; params: { methodName: string; args: object; gas: string; deposit: string } }
  | { type: 'Transfer'; params: { deposit: string } }

export interface NearTx {
  receiverId: string
  actions: NearAction[]
}

export type ActionKind = 'swap' | 'stake' | 'lend' | 'withdraw' | 'transfer' | 'wrap' | 'crosschain'

export const ACTION_LABELS: Record<ActionKind, string> = {
  swap: 'Swap on Rhea',
  stake: 'Liquid staking',
  lend: 'Supply to Rhea Lending',
  withdraw: 'Withdraw from Rhea Lending',
  transfer: 'Send tokens',
  wrap: 'Wrap / unwrap NEAR',
  crosschain: 'Cross-chain via NEAR Intents',
}

export interface Plan {
  kind: ActionKind
  network: NearNetwork
  signer: string
  /** One line, shown first in the approval card. */
  title: string
  /** Extra lines: route, expected output, fees, contracts touched. */
  details: string[]
  txs: NearTx[]
  /** What leaves the account (valued in USD for limits). */
  spend: { token: TokenInfo; raw: bigint }
  /** Optional step after the transactions land (e.g. NEAR Intents status). */
  followUp?: (txHashes: string[]) => Promise<Record<string, unknown>>
}

export const fc = (methodName: string, args: object, tgas: number, deposit: bigint | string = 0n): NearAction => ({
  type: 'FunctionCall',
  params: { methodName, args, gas: (BigInt(tgas) * 10n ** 12n).toString(), deposit: deposit.toString() },
})

export const transfer = (deposit: bigint): NearAction => ({ type: 'Transfer', params: { deposit: deposit.toString() } })
