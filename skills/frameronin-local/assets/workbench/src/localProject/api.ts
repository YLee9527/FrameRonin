export async function localFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase())) headers.set('X-FrameRonin-Local', '1')
  return fetch(input, { ...init, headers })
}

export async function localJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await localFetch(url, init)
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.detail || payload.error?.message || response.statusText)
  return payload as T
}

export function jsonPost(payload: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
}
