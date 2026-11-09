/**
 * ThreadHitl: shows pending approval requests (HITL) inside the workspace
 * thread view. Without it, a tool that asks for approval (NEAR actions,
 * connector orders) waited forever in this view because nothing rendered
 * the Approve / Reject card.
 *
 * Shows requests for this thread's conversation; if none match, it shows any
 * other pending request so an approval is never invisible.
 */
import { useEffect, useRef, useState } from 'react'
import { HitlPrompt } from '@/components/chat'
import { getAllPendingRequests, onHitlRequest } from '@/lib/hitl'
import type { Agent, HitlRequest } from '@/types'

export function ThreadHitl({ conversationId, agent }: { conversationId?: string; agent?: Agent | null }) {
  const [requests, setRequests] = useState<HitlRequest[]>(() => getAllPendingRequests())

  useEffect(() => {
    setRequests(getAllPendingRequests())
    return onHitlRequest((req) => {
      setRequests((prev) => {
        const others = prev.filter((r) => r.id !== req.id)
        // keep answered cards briefly so the user sees the result, drop them after
        if (req.status !== 'pending') {
          setTimeout(() => setRequests((p) => p.filter((r) => r.id !== req.id)), 4000)
        }
        return [...others, req]
      })
    })
  }, [])

  const mine = requests.filter((r) => r.conversationId === conversationId)
  const shown = mine.length ? mine : requests.filter((r) => r.status === 'pending')

  // Bring a new pending approval into view; it renders below the streaming
  // reply, so without this it can sit off-screen while the agent waits.
  const box = useRef<HTMLDivElement>(null)
  const pendingKey = shown.filter((r) => r.status === 'pending').map((r) => r.id).join(',')
  useEffect(() => {
    if (!pendingKey) return
    const t = setTimeout(() => box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150)
    return () => clearTimeout(t)
  }, [pendingKey])

  if (!shown.length) return null
  return (
    <div ref={box} className="mt-4 flex flex-col gap-3">
      {shown.map((r) => (
        <HitlPrompt key={r.id} request={r} agent={agent} />
      ))}
    </div>
  )
}
