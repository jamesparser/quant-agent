/**
 * NearSection: connect a NEAR wallet, create and fund the agent wallet, pick
 * who signs, and set spending limits for the agent's NEAR actions.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Chip, Input, Radio, RadioGroup, Switch } from '@heroui/react'
import { useNearStore } from '@/lib/near/state'
import { NETWORKS, accountUrl, type NearNetwork } from '@/lib/near/config'
import { ACTION_LABELS, type ActionKind } from '@/lib/near/types'
import { today } from '@/lib/near/policy'
import { userSettings } from '@/stores/userStore'

type Bal = { total: string; available: string } | null

async function loadBalance(network: NearNetwork, id?: string): Promise<Bal> {
  if (!id) return null
  const { nearBalance } = await import('@/lib/near/rpc')
  const { fromRaw } = await import('@/lib/near/tokens')
  const b = await nearBalance(NETWORKS[network], id)
  return { total: fromRaw(b.amount, 24, 4), available: fromRaw(b.available, 24, 4) }
}

export const NearSection = () => {
  const s = useNearStore()
  const network = s.network
  const cfg = NETWORKS[network]
  const walletId = s.walletAccount[network]
  const agent = s.agent[network]
  const yolo = userSettings((st) => st.yoloMode ?? false)
  const setYolo = userSettings((st) => st.setYoloMode)

  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [walletBal, setWalletBal] = useState<Bal>(null)
  const [agentBal, setAgentBal] = useState<Bal>(null)
  const [fund, setFund] = useState('1')
  const [shownKey, setShownKey] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setWalletBal(await loadBalance(network, walletId).catch(() => null))
    setAgentBal(await loadBalance(network, agent?.accountId).catch(() => null))
  }, [network, walletId, agent?.accountId])

  useEffect(() => { void refresh() }, [refresh])

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label); setErr(null)
    try { await fn(); await refresh() } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  const connect = () => run('connect', async () => (await import('@/lib/near/signers')).connectWallet(network))
  const disconnect = () => run('disconnect', async () => (await import('@/lib/near/signers')).disconnectWallet(network))
  const createAgent = () => run('create', async () => (await import('@/lib/near/signers')).createAgentWallet(network))
  const fundAgent = () => run('fund', async () => {
    if (!agent) throw new Error('Create the agent wallet first.')
    const { signPlanTxs } = await import('@/lib/near/signers')
    const { toRaw } = await import('@/lib/near/tokens')
    await signPlanTxs(network, 'wallet', [{ receiverId: agent.accountId, actions: [{ type: 'Transfer', params: { deposit: toRaw(fund, 24).toString() } }] }])
  })
  const [importing, setImporting] = useState(false)
  const [importKey, setImportKey] = useState('')
  const doImport = () => run('import', async () => {
    await (await import('@/lib/near/signers')).importAgentKey(network, importKey)
    setImportKey(''); setImporting(false)
  })
  const revealKey = () => run('key', async () => setShownKey(await (await import('@/lib/near/signers')).exportAgentKey(network)))
  const removeAgent = () => {
    if (!confirm('Remove the agent wallet from this device? Export its key first if it still holds funds.')) return
    s.setAgent(network, undefined); setShownKey(null)
    if (s.signer === 'agent') s.setSigner('wallet')
  }

  const spent = s.ledger.day === today() ? s.ledger.usd : 0

  return (
    <div className="flex flex-col gap-8 max-w-2xl">
      <div>
        <p className="text-sm text-default-500">
          Let Quant Agent trade on Rhea, liquid-stake, supply to Rhea Lending and move assets cross-chain through NEAR Intents.
          Each action asks you first, or runs on its own in YOLO mode inside the limits below.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="font-medium">Network</h3>
        <RadioGroup orientation="horizontal" value={network} onValueChange={(v) => s.setNetwork(v as NearNetwork)}>
          <Radio value="testnet">Testnet (free test tokens)</Radio>
          <Radio value="mainnet">Mainnet (real funds)</Radio>
        </RadioGroup>
        {network === 'testnet' && <p className="text-xs text-default-500">NEAR Intents (cross-chain) runs on mainnet only.</p>}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-medium">Your wallet</h3>
        {walletId ? (
          <div className="flex flex-wrap items-center gap-3">
            <a className="font-mono text-sm underline" href={accountUrl(cfg, walletId)} target="_blank" rel="noreferrer">{walletId}</a>
            {walletBal && <Chip size="sm" variant="flat">{walletBal.total} NEAR</Chip>}
            <Button size="sm" variant="flat" onPress={disconnect} isLoading={busy === 'disconnect'}>Disconnect</Button>
          </div>
        ) : (
          <Button color="primary" className="self-start" onPress={connect} isLoading={busy === 'connect'}>Connect NEAR wallet</Button>
        )}
        <p className="text-xs text-default-500">
          {network === 'mainnet'
            ? 'NEAR Mobile, HOT, Meteor, Intear, MyNearWallet, OKX, Nightly, Hana, Ledger, and MetaMask or other EVM wallets (via Ethereum Wallets). Tangem and other mobile wallets connect through WalletConnect.'
            : 'Testnet wallets: Meteor, Intear, Nightly, Ledger, MetaMask (Ethereum Wallets) and WalletConnect. NEAR Mobile and HOT are mainnet only.'}
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-medium">Agent wallet</h3>
        <p className="text-xs text-default-500">
          A separate NEAR account the agent signs with. Its key is generated and encrypted on this device. It can only spend what you fund it with, so fund it with what you are happy for the agent to manage.
        </p>
        {agent ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <a className="font-mono text-xs underline break-all" href={accountUrl(cfg, agent.accountId)} target="_blank" rel="noreferrer">{agent.accountId}</a>
              {agentBal && <Chip size="sm" variant="flat" color={agentBal.total === '0' ? 'warning' : 'success'}>{agentBal.total} NEAR</Chip>}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Input size="sm" className="w-28" label="Fund (NEAR)" value={fund} onValueChange={setFund} />
              <Button size="sm" variant="flat" onPress={fundAgent} isDisabled={!walletId} isLoading={busy === 'fund'}>Fund from my wallet</Button>
              <Button size="sm" variant="light" onPress={refresh}>Refresh</Button>
              <Button size="sm" variant="light" onPress={revealKey} isLoading={busy === 'key'}>Export key</Button>
              <Button size="sm" variant="light" color="danger" onPress={removeAgent}>Remove</Button>
            </div>
            {!walletId && <p className="text-xs text-default-500">Or send NEAR to the address above from any wallet or exchange.</p>}
            {shownKey && (
              <div className="rounded-lg bg-warning-50 p-3 text-xs">
                <p className="mb-1 font-medium">Private key (keep it secret, anyone with it controls the funds):</p>
                <code className="break-all">{shownKey}</code>
                <Button size="sm" variant="light" className="mt-2" onPress={() => setShownKey(null)}>Hide</Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <Button variant="flat" onPress={createAgent} isLoading={busy === 'create'}>Create agent wallet</Button>
              <Button variant="light" onPress={() => setImporting((v) => !v)}>Import existing key</Button>
            </div>
            {importing && (
              <div className="flex items-end gap-2">
                <Input size="sm" type="password" label="ed25519:... private key" value={importKey} onValueChange={setImportKey} />
                <Button size="sm" onPress={doImport} isDisabled={!importKey.startsWith('ed25519:')} isLoading={busy === 'import'}>Import</Button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-medium">Who signs</h3>
        <RadioGroup value={s.signer} onValueChange={(v) => s.setSigner(v as 'wallet' | 'agent')}>
          <Radio value="wallet" description="You approve in chat, then confirm in your wallet.">My wallet</Radio>
          <Radio value="agent" isDisabled={!agent} description="You approve in chat, or nothing at all in YOLO mode within your limits.">Agent wallet</Radio>
        </RadioGroup>
        <Switch isSelected={yolo} onValueChange={(v) => setYolo?.(v)}>
          YOLO mode: run agent-wallet actions inside my limits without asking
        </Switch>
        <p className="text-xs text-default-500">YOLO applies to the whole app (Settings, Features). Over-limit NEAR actions always ask.</p>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-medium">Spending limits</h3>
        <div className="flex flex-wrap gap-3">
          <Input size="sm" className="w-40" type="number" label="Per action (USD)" value={String(s.limits.perActionUsd)}
            onValueChange={(v) => s.setLimits({ perActionUsd: Math.max(0, Number(v) || 0) })} />
          <Input size="sm" className="w-40" type="number" label="Per day (USD)" value={String(s.limits.dailyUsd)}
            onValueChange={(v) => s.setLimits({ dailyUsd: Math.max(0, Number(v) || 0) })} />
          <Chip size="sm" variant="flat" className="self-center">Spent today: ${spent.toFixed(2)}</Chip>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(Object.keys(ACTION_LABELS) as ActionKind[]).map((k) => (
            <Switch key={k} size="sm" isSelected={s.limits.allowed[k]} onValueChange={(v) => s.setLimits({ allowed: { ...s.limits.allowed, [k]: v } })}>
              {ACTION_LABELS[k]}
            </Switch>
          ))}
        </div>
      </section>

      {err && <p className="text-sm text-danger">{err}</p>}
    </div>
  )
}
