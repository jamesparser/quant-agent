import { useEffect, useState } from 'react'

import { gatewayFetch } from '@/lib/auth/gatewayFetch'
import { gatewayBase } from '@/lib/llm/managed-lane'
import { getRciKey } from '@/lib/rcc-session'

/**
 * Read only stand in for the model picker.
 *
 * Quant Agent's model is a plan decision made on the server, not a user choice,
 * so the composer shows the plan and its model and offers nothing to change.
 */
export function modelDisplayName(modelId: string): string {
  const tail = modelId.split('/').pop() || modelId
  return tail
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .map((w) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

const MODEL_BY_PLAN: Record<string, string> = { Pro: 'ASI1', Ultra: 'Agnes + MiniMax M3' }
let cachedPlan: string | null = null

export function ManagedModelBadge() {
  const [plan, setPlan] = useState<string | null>(cachedPlan)
  useEffect(() => {
    if (cachedPlan || !getRciKey()) return
    let live = true
    gatewayFetch(`${gatewayBase()}/credits`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d?.plan) {
          cachedPlan = d.plan
          setPlan(d.plan)
        }
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  const label = plan ? `${plan} · ${MODEL_BY_PLAN[plan] || 'Quant Agent'}` : 'Quant Agent'
  return (
    <div className="text-default-500 flex min-w-0 items-center gap-1.5 px-1 text-xs sm:px-2" title={label}>
      <span className="max-w-[9rem] truncate sm:max-w-[14rem]">{label}</span>
    </div>
  )
}
