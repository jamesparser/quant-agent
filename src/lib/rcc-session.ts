/**
 * RealCryptoCap session for Quant Agent.
 *
 * Quant Agent is opened from realcryptocap.com/quant-agent (Pro and Ultra only).
 * That page passes the account API key in the URL fragment (#rci=...), which the
 * browser never sends to a server. We keep it in this browser and strip it from
 * the address bar. Every model call is re-checked by realcryptocap.com/api/agent,
 * so holding a key never grants more than the account's real plan.
 */
const STORAGE_KEY = 'qa:rci-key'
const KEY_RE = /^rci_[a-z0-9]{8,}$/i

export const RCC_QUANT_AGENT_URL = 'https://realcryptocap.com/quant-agent'

export function captureRciKeyFromHash(): void {
  if (typeof window === 'undefined') return
  const hash = window.location.hash || ''
  const m = hash.match(/(?:^#|&)rci=([^&]+)/)
  if (!m) return
  const key = decodeURIComponent(m[1])
  if (KEY_RE.test(key)) {
    try {
      localStorage.setItem(STORAGE_KEY, key)
    } catch {
      // Storage blocked: the key still works for this page load below.
      ;(window as unknown as { __qaRciKey?: string }).__qaRciKey = key
    }
  }
  const rest = hash.replace(/(?:^#|&)rci=[^&]+/, '').replace(/^&/, '')
  const clean = window.location.pathname + window.location.search + (rest ? `#${rest}` : '')
  window.history.replaceState(null, '', clean)
}

export function getRciKey(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && KEY_RE.test(v)) return v
  } catch {
    // fall through
  }
  return (window as unknown as { __qaRciKey?: string }).__qaRciKey || null
}

export function clearRciKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
