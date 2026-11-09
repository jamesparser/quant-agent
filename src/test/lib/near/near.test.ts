import { describe, it, expect } from 'vitest'
import { toRaw, fromRaw } from '@/lib/near/tokens'
import { swapMsg } from '@/lib/near/rhea'
import { checkPolicy, recordSpend, today, DEFAULT_LIMITS, planUsd } from '@/lib/near/policy'
import { vi } from 'vitest'
import { fc } from '@/lib/near/types'
import type { Plan } from '@/lib/near/types'

const plan = (kind: Plan['kind'] = 'swap'): Plan => ({
  kind, network: 'testnet', signer: 'a.testnet', title: 't', details: [], txs: [],
  spend: { token: { id: 'near', symbol: 'NEAR', decimals: 24 }, raw: 10n ** 24n },
})

describe('NEAR amounts', () => {
  it('converts whole units to raw and back', () => {
    expect(toRaw('1.5', 6)).toBe(1_500_000n)
    expect(toRaw('0.001', 24)).toBe(10n ** 21n)
    expect(fromRaw(1_500_000n, 6)).toBe('1.5')
    expect(fromRaw(10n ** 24n, 24)).toBe('1')
  })
  it('rejects bad input and excess precision', () => {
    expect(() => toRaw('abc', 6)).toThrow()
    expect(() => toRaw('1.1234567', 6)).toThrow()
  })
})

describe('Rhea swap message', () => {
  it('matches the ft_transfer_call msg the exchange expects', () => {
    const msg = swapMsg([{ pool_id: 1084, token_in: 'wrap.testnet', token_out: 'usdt.itachicara.testnet', amount_in: '1000', min_amount_out: '990' }])
    expect(JSON.parse(msg)).toEqual({ force: 0, actions: [{ pool_id: 1084, token_in: 'wrap.testnet', token_out: 'usdt.itachicara.testnet', amount_in: '1000', min_amount_out: '990' }] })
  })
  it('builds function-call actions with gas in TGas', () => {
    expect(fc('near_deposit', {}, 10, 5n)).toEqual({ type: 'FunctionCall', params: { methodName: 'near_deposit', args: {}, gas: '10000000000000', deposit: '5' } })
  })
})

describe('spending limits', () => {
  const ledger = { day: today(), usd: 0 }
  it('allows an action inside the limits', () => {
    expect(checkPolicy(plan(), 3, DEFAULT_LIMITS, ledger).ok).toBe(true)
  })
  it('asks (not blocks) when over the per-action limit', () => {
    const v = checkPolicy(plan(), DEFAULT_LIMITS.perActionUsd + 1, DEFAULT_LIMITS, ledger)
    expect(v.ok).toBe(false)
    expect(!v.ok && v.blocked).toBe(false)
  })
  it('asks when the daily total would be exceeded', () => {
    const v = checkPolicy(plan(), 5, DEFAULT_LIMITS, { day: today(), usd: DEFAULT_LIMITS.dailyUsd - 1 })
    expect(v.ok).toBe(false)
  })
  it('blocks a disabled kind', () => {
    const v = checkPolicy(plan('transfer'), 1, DEFAULT_LIMITS, ledger)
    expect(!v.ok && v.blocked).toBe(true)
  })
  it('resets the ledger on a new day', () => {
    expect(recordSpend({ day: '2000-01-01', usd: 99 }, 2)).toEqual({ day: today(), usd: 2 })
  })
})

describe('USD valuation', () => {
  it('prices native NEAR on testnet with the mainnet wNEAR price', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ 'wrap.near': { price: '4', symbol: 'wNEAR', decimal: 24 } }) })))
    expect(await planUsd(plan())).toBe(4)
    vi.unstubAllGlobals()
  })
})
