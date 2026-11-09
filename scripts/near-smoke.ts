/**
 * Live smoke test of the NEAR action builders on testnet, signed with a local
 * key from ~/.near-credentials (never committed). Same code paths the agent uses.
 *
 *   npx tsx scripts/near-smoke.ts <account.testnet> [steps...]
 *   steps: quote swap stake supply withdraw unstake transfer   (default: quote)
 */
import fs from 'node:fs'
import os from 'node:os'
import { Account, actions as A } from 'near-api-js'
import { NETWORKS } from '../src/lib/near/config'
import { planSwap, planStake, planSupply, planWithdrawSupply, planTransfer } from '../src/lib/near/actions'
import { quoteSwap } from '../src/lib/near/rhea'
import { resolveToken, toRaw, fromRaw } from '../src/lib/near/tokens'
import { nearBalance } from '../src/lib/near/rpc'
import type { Plan } from '../src/lib/near/types'

const cfg = NETWORKS.testnet
const signer = process.argv[2]
const steps = process.argv.slice(3).length ? process.argv.slice(3) : ['quote']
const cred = JSON.parse(fs.readFileSync(`${os.homedir()}/.near-credentials/testnet/${signer}.json`, 'utf8'))
const account = new Account(signer, cfg.rpc, cred.private_key)

async function send(plan: Plan) {
  console.log(`\n# ${plan.title}`)
  for (const d of plan.details) console.log(`  - ${d}`)
  for (const tx of plan.txs) {
    const r: any = await account.signAndSendTransaction({
      receiverId: tx.receiverId,
      actions: tx.actions.map((a) => a.type === 'Transfer' ? A.transfer(BigInt(a.params.deposit)) : A.functionCall(a.params.methodName, a.params.args, BigInt(a.params.gas), BigInt(a.params.deposit))),
      throwOnFailure: true,
    } as any)
    const hash = r?.transaction?.hash ?? r?.transaction_outcome?.id
    const fail = r?.status?.Failure
    console.log(`  ${fail ? 'FAILED' : 'ok'} ${tx.receiverId} ${tx.actions.map((a) => a.type === 'FunctionCall' ? a.params.methodName : 'transfer').join('+')}  ${cfg.explorer}/txns/${hash}`)
    if (fail) throw new Error(JSON.stringify(fail))
  }
}

const b0 = await nearBalance(cfg, signer)
console.log(`${signer}: ${fromRaw(b0.amount, 24, 4)} NEAR`)
for (const step of steps) {
  if (step === 'quote') {
    const usdt = await resolveToken(cfg, 'USDT')
    const q = await quoteSwap(cfg, cfg.wrap, usdt.id, toRaw('0.1', 24), 50)
    console.log(`quote 0.1 NEAR -> ${fromRaw(q.amountOut, usdt.decimals)} USDT via ${q.route}`)
  }
  if (step === 'swap') await send(await planSwap(cfg, signer, 'NEAR', 'USDT', '0.1'))
  if (step === 'swapback') await send(await planSwap(cfg, signer, 'USDT', 'NEAR', '0.05'))
  if (step === 'stake') await send(await planStake(cfg, signer, 'metapool', '1'))
  if (step === 'unstake') await send(await planSwap(cfg, signer, 'STNEAR', 'NEAR', '0.1'))
  if (step === 'supply') await send(await planSupply(cfg, signer, 'NEAR', '0.2'))
  if (step === 'withdraw') await send(await planWithdrawSupply(cfg, signer, 'NEAR'))
  if (step === 'transfer') await send(await planTransfer(cfg, signer, 'USDT', '0.01', 'hack-alice.testnet'))
}
const b1 = await nearBalance(cfg, signer)
console.log(`\n${signer}: ${fromRaw(b1.amount, 24, 4)} NEAR`)
