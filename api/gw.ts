/**
 * Same-origin model gateway for Quant Agent.
 *
 * The browser calls `/api/gw/<path>` on its own origin, so there is no CORS
 * allow-list to keep in sync. This function forwards the request server side to
 * the upstream OpenAI-compatible gateway and streams the response back.
 *
 * Upstream is `QA_UPSTREAM_URL` (set in the Vercel project). Until the
 * RealCryptoCap `/api/agent` lane (Pro on ASI1, Ultra on M3) is live, it falls
 * back to the shared Nemotron gateway.
 *
 * Only the headers a model call needs are forwarded. Cookies never leave.
 */
const DEFAULT_UPSTREAM = 'https://agentasia-gateway.realcryptocap.com'
const FORWARD_REQUEST_HEADERS = ['authorization', 'content-type', 'accept', 'x-agentasia-plan']
const DROP_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection'])
const ALLOWED_PREFIXES = ['v1/chat/completions', 'v1/models', 'v1/search', 'v1/usage', 'v1/culture']

async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  // vercel.json routes /api/gw/<path> here as ?p=<path>.
  const path = (url.searchParams.get('p') || url.pathname.replace(/^\/api\/gw\/?/, '')).replace(/^\/+/, '')
  url.searchParams.delete('p')
  if (!ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return Response.json({ error: { message: 'not_found' } }, { status: 404 })
  }

  const upstreamBase = (process.env.QA_UPSTREAM_URL || DEFAULT_UPSTREAM).replace(/\/+$/, '')
  const qs = url.searchParams.toString()
  const target = `${upstreamBase}/${path}${qs ? `?${qs}` : ''}`

  const headers = new Headers()
  for (const h of FORWARD_REQUEST_HEADERS) {
    const v = request.headers.get(h)
    if (v) headers.set(h, v)
  }
  const init: RequestInit & { duplex?: string } = {
    method: request.method,
    headers,
    redirect: 'manual',
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer()
  }
  let upstream: Response
  try {
    upstream = await fetch(target, init)
  } catch {
    return Response.json({ error: { message: 'upstream_unreachable' } }, { status: 502 })
  }
  const out = new Headers()
  upstream.headers.forEach((v, k) => {
    if (!DROP_RESPONSE_HEADERS.has(k.toLowerCase())) out.set(k, v)
  })
  out.set('cache-control', 'no-store')
  out.set('x-qa-upstream-path', `/${path}${qs ? `?${qs}` : ''}`)
  return new Response(upstream.body, { status: upstream.status, headers: out })
}

export default { fetch: handler }
