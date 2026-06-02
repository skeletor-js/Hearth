// Helpers for talking to Hearth from inside a micro-app frame.
//
// A micro-app can only reach external hosts the user has approved for it, and it
// must never hold a raw secret. So authenticated calls go through Hearth's
// credential broker: you call `hearthFetch(targetUrl)`, and Hearth injects the
// credential server-side and forwards the request to your approved host. The
// broker origin + a per-app token are handed to the frame as URL query params.
//
// To request a host, add it to this app's `hearth.app.json`:
//   { "hosts": [{ "host": "https://www.googleapis.com", "reason": "Gmail API" }] }
// The user is prompted to approve it the next time the app launches.

const params = new URLSearchParams(location.search)
const BROKER = params.get('__hearthBroker')
const TOKEN = params.get('__hearthToken')

export interface HearthFetchInit {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Forwarded as the request body (POST/PUT/PATCH). */
  body?: BodyInit
  /** Only content-type is forwarded; the broker sets auth itself. */
  contentType?: string
}

/**
 * Call an approved external host through Hearth's credential broker. Throws if the
 * broker isn't available (app opened outside Hearth) — guard with `hearthBrokerAvailable()`.
 */
export async function hearthFetch(targetUrl: string, init: HearthFetchInit = {}): Promise<Response> {
  if (!BROKER || !TOKEN) throw new Error('Hearth broker unavailable (is this running inside Hearth?)')
  const headers: Record<string, string> = {
    'x-hearth-token': TOKEN,
    'x-hearth-target': targetUrl,
    'x-hearth-method': init.method ?? 'GET',
  }
  if (init.contentType) headers['content-type'] = init.contentType
  return fetch(`${BROKER}/proxy`, { method: 'POST', headers, body: init.body })
}

export function hearthBrokerAvailable(): boolean {
  return Boolean(BROKER && TOKEN)
}
