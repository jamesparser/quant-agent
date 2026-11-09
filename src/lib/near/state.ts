/**
 * Persisted NEAR settings for this device: network, signer, agent wallet, limits.
 *
 * The agent wallet's private key is encrypted with the app's SecureStorage
 * (a non-extractable WebCrypto key on this device) before it is stored.
 *
 * @module lib/near/state
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { NearNetwork } from './config'
import { DEFAULT_LIMITS, type NearLimits, type SpendLedger } from './policy'

export type SignerMode = 'wallet' | 'agent'

export interface AgentWalletRecord {
  accountId: string
  publicKey: string
  encrypted: string
  iv: string
  createdAt: string
}

interface NearState {
  network: NearNetwork
  signer: SignerMode
  /** Account connected through the user's own wallet, per network. */
  walletAccount: Partial<Record<NearNetwork, string>>
  agent: Partial<Record<NearNetwork, AgentWalletRecord>>
  limits: NearLimits
  ledger: SpendLedger
  setNetwork: (n: NearNetwork) => void
  setSigner: (s: SignerMode) => void
  setWalletAccount: (n: NearNetwork, id?: string) => void
  setAgent: (n: NearNetwork, rec?: AgentWalletRecord) => void
  setLimits: (l: Partial<NearLimits>) => void
  setLedger: (l: SpendLedger) => void
}

export const useNearStore = create<NearState>()(
  persist(
    (set) => ({
      network: 'testnet',
      signer: 'wallet',
      walletAccount: {},
      agent: {},
      limits: DEFAULT_LIMITS,
      ledger: { day: '', usd: 0 },
      setNetwork: (network) => set({ network }),
      setSigner: (signer) => set({ signer }),
      setWalletAccount: (n, id) => set((s) => ({ walletAccount: { ...s.walletAccount, [n]: id } })),
      setAgent: (n, rec) => set((s) => ({ agent: { ...s.agent, [n]: rec } })),
      setLimits: (l) => set((s) => ({ limits: { ...s.limits, ...l, allowed: { ...s.limits.allowed, ...(l.allowed ?? {}) } } })),
      setLedger: (ledger) => set({ ledger }),
    }),
    { name: 'quant-agent-near', version: 1 },
  ),
)

export const nearState = () => useNearStore.getState()
