import { describe, expect, it } from 'vitest'
import { NEAR_DONE_RE, NEAR_INTENT_RE, NEAR_PROMISE_RE, stripUnverifiedTxLinks } from '@/lib/near/guard'

describe('NEAR chat guard', () => {
  it('catches an announced action without a tool call', () => {
    expect(NEAR_PROMISE_RE.test('Min received: 0.3456 USDC. Approving and executing now.')).toBe(true)
    expect(NEAR_PROMISE_RE.test('inside your $1 per-action limit, so it runs on its own in YOLO mode.\n(Calling near_swap…)')).toBe(true)
    expect(NEAR_PROMISE_RE.test('Quote: sell 0.5 NEAR for about 1.73 USDC.')).toBe(false)
    expect(NEAR_PROMISE_RE.test('Let me do that, then retry.\n(Unwrapping 0.3 wNEAR → NEAR…)')).toBe(true)
    expect(NEAR_PROMISE_RE.test('Pools (Rhea #5470) were used.')).toBe(false)
    expect(NEAR_PROMISE_RE.test("I see the issue: I didn't actually call the swap tool. Let me do that now with the correct parameters.")).toBe(true)
  })
  it('catches a claimed result after the user says yes', () => {
    expect(NEAR_INTENT_RE.test('yes')).toBe(true)
    expect(NEAR_INTENT_RE.test('Swap all my USDC back to NEAR')).toBe(true)
    expect(NEAR_INTENT_RE.test('Check my NEAR account')).toBe(false)
    expect(NEAR_INTENT_RE.test('ok thanks')).toBe(false)
    expect(NEAR_DONE_RE.test('✅ Swap completed. ~1.39 USDC → ~4.02 NEAR on Rhea.')).toBe(true)
    expect(NEAR_DONE_RE.test('✅ Transfer completed. 0.5353 NEAR → 60b1…')).toBe(true)
    expect(NEAR_DONE_RE.test('Quote: Sell 1.39 USDC for about 0.40 NEAR.')).toBe(false)
  })
  it('keeps tool links and removes invented ones', () => {
    const tool = '{"transactions":["https://nearblocks.io/txns/4P7LfSJ7T4ZicFrx1vZbPrWvhxSh3BUPr1BnfTftXJ6w"]}'
    const text = 'TX 1: https://nearblocks.io/txns/4P7LfSJ7T4ZicFrx1vZbPrWvhxSh3BUPr1BnfTftXJ6w\nTX 2: [view](https://nearblocks.io/txns/KpLmQrXeTfWnYaZcUdHgJoViPkMbReSxTwCqFnLaBsJgAy)'
    const r = stripUnverifiedTxLinks(text, tool)
    expect(r.removed).toBe(1)
    expect(r.content).toContain('4P7LfSJ7T4Zic')
    expect(r.content).not.toContain('KpLmQrXe')
    expect(r.content).toContain('TX 2: (unverified link removed)')
  })
})
