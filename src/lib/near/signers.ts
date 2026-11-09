/**
 * Two ways to sign a plan:
 *  - wallet: the user's own NEAR wallet via @hot-labs/near-connect (HOT, Meteor,
 *    MyNearWallet, Intear...). The wallet shows its own confirmation too.
 *  - agent: a dedicated agent account whose key lives encrypted on this device.
 *    It only holds what the user funds it with, which is the hard spending cap;
 *    the USD limits in policy.ts sit on top.
 *
 * @module lib/near/signers
 */
import { NearConnector } from '@hot-labs/near-connect'
import { Account, KeyPair, actions as A, keyToImplicitAddress } from 'near-api-js'
import { SecureStorage } from '@/lib/crypto'
import { NETWORKS, type NearNetwork } from './config'
import { nearState, type AgentWalletRecord } from './state'
import type { NearTx } from './types'

// ---------------------------------------------------------------------------
// User wallet (near-connect)
// ---------------------------------------------------------------------------
const connectors = new Map<NearNetwork, NearConnector>()

/**
 * WalletConnect (Reown) unlocks wallets that only connect through it (e.g.
 * Tangem and other mobile wallets). Optional: set VITE_WALLETCONNECT_PROJECT_ID.
 * NEAR Mobile, HOT, Meteor, Intear, MyNearWallet, OKX, Nightly, Hana, Ledger and
 * MetaMask ("Ethereum Wallets") work without it.
 */
const WC_PROJECT_ID = (import.meta as any).env?.VITE_WALLETCONNECT_PROJECT_ID as string | undefined
let wcClient: Promise<any> | undefined
function walletConnectClient(): Promise<any> | undefined {
  if (!WC_PROJECT_ID || typeof window === 'undefined') return undefined
  wcClient ??= import('@walletconnect/sign-client').then((m) =>
    m.default.init({
      projectId: WC_PROJECT_ID,
      metadata: {
        name: 'Quant Agent',
        description: 'RealCryptoCap personal trading and research assistant',
        url: window.location.origin,
        icons: [`${window.location.origin}/brand/quant-agent-mark-256.png`],
      },
    }),
  )
  return wcClient
}

export const walletConnectEnabled = () => Boolean(WC_PROJECT_ID)

export function connector(network: NearNetwork): NearConnector {
  let c = connectors.get(network)
  if (!c) {
    const walletConnect = walletConnectClient()
    c = new NearConnector({
      network,
      providers: { [network]: [NETWORKS[network].rpc] },
      autoConnect: true,
      ...(walletConnect ? { walletConnect } : {}),
    })
    c.on('wallet:signOut', () => nearState().setWalletAccount(network, undefined))
    c.on('wallet:signIn', (p: any) => {
      const id = p?.accounts?.[0]?.accountId
      if (id) nearState().setWalletAccount(network, id)
    })
    connectors.set(network, c)
  }
  return c
}

export async function connectWallet(network: NearNetwork): Promise<string> {
  const wallet = await connector(network).connect()
  const accounts = await wallet.getAccounts()
  const id = accounts[0]?.accountId
  if (!id) throw new Error('The wallet did not return an account.')
  nearState().setWalletAccount(network, id)
  return id
}

export async function disconnectWallet(network: NearNetwork): Promise<void> {
  await connector(network).disconnect().catch(() => undefined)
  nearState().setWalletAccount(network, undefined)
}

function outcomeHash(o: any): string {
  const failure = o?.status?.Failure
  if (failure) throw new Error(`Transaction failed: ${JSON.stringify(failure).slice(0, 400)}`)
  return o?.transaction?.hash ?? o?.transaction_outcome?.id ?? ''
}

async function signWithWallet(network: NearNetwork, txs: NearTx[]): Promise<string[]> {
  const { wallet } = await connector(network).getConnectedWallet()
  const outcomes = await wallet.signAndSendTransactions({ network, transactions: txs as any })
  return outcomes.map(outcomeHash)
}

// ---------------------------------------------------------------------------
// Agent wallet (implicit account, key encrypted on this device)
// ---------------------------------------------------------------------------
export async function createAgentWallet(network: NearNetwork): Promise<AgentWalletRecord> {
  const kp = KeyPair.fromRandom('ed25519')
  const publicKey = kp.getPublicKey().toString()
  const accountId = keyToImplicitAddress(publicKey)
  const { encrypted, iv } = await SecureStorage.encryptCredential(kp.toString())
  const rec: AgentWalletRecord = { accountId, publicKey, encrypted, iv, createdAt: new Date().toISOString() }
  nearState().setAgent(network, rec)
  return rec
}

export async function exportAgentKey(network: NearNetwork): Promise<string> {
  const rec = nearState().agent[network]
  if (!rec) throw new Error('No agent wallet on this network.')
  return SecureStorage.decryptCredential(rec.encrypted, rec.iv, '')
}

export async function importAgentKey(network: NearNetwork, secret: string): Promise<AgentWalletRecord> {
  const kp = KeyPair.fromString(secret.trim() as any)
  const publicKey = kp.getPublicKey().toString()
  const accountId = keyToImplicitAddress(publicKey)
  const { encrypted, iv } = await SecureStorage.encryptCredential(kp.toString())
  const rec: AgentWalletRecord = { accountId, publicKey, encrypted, iv, createdAt: new Date().toISOString() }
  nearState().setAgent(network, rec)
  return rec
}

const toApiAction = (a: NearTx['actions'][number]) =>
  a.type === 'Transfer'
    ? A.transfer(BigInt(a.params.deposit))
    : A.functionCall(a.params.methodName, a.params.args, BigInt(a.params.gas), BigInt(a.params.deposit))

async function signWithAgent(network: NearNetwork, txs: NearTx[]): Promise<string[]> {
  const rec = nearState().agent[network]
  if (!rec) throw new Error('No agent wallet on this network. Create one in Settings > NEAR.')
  const secret = await SecureStorage.decryptCredential(rec.encrypted, rec.iv, '')
  const account = new Account(rec.accountId, NETWORKS[network].rpc, secret as any)
  const hashes: string[] = []
  for (const tx of txs) {
    const r: any = await account.signAndSendTransaction({ receiverId: tx.receiverId, actions: tx.actions.map(toApiAction), throwOnFailure: true } as any)
    hashes.push(outcomeHash(r))
  }
  return hashes
}

// ---------------------------------------------------------------------------
export function activeSigner(network: NearNetwork): { mode: 'wallet' | 'agent'; accountId?: string } {
  const s = nearState()
  return s.signer === 'agent'
    ? { mode: 'agent', accountId: s.agent[network]?.accountId }
    : { mode: 'wallet', accountId: s.walletAccount[network] }
}

export async function signPlanTxs(network: NearNetwork, mode: 'wallet' | 'agent', txs: NearTx[]): Promise<string[]> {
  return mode === 'agent' ? signWithAgent(network, txs) : signWithWallet(network, txs)
}
