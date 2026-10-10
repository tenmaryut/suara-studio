import { net, protocol } from 'electron'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP_HOST, APP_ORIGIN, APP_SCHEME } from '../shared/app-info'

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ])
}

/**
 * Serves the built renderer from `root` at app://suara-studio/. A real origin (instead of
 * file://) gives the page a secure context and lets the AudioWorklet module load normally.
 */
export function serveRenderer(root: string): void {
  const base = normalize(root.endsWith(sep) ? root : root + sep)
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url)
    if (url.host !== APP_HOST) return new Response('Not found', { status: 404 })
    let relative: string
    try {
      relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    } catch {
      return new Response('Bad request', { status: 400 })
    }
    const filePath = normalize(join(base, relative))
    if (!filePath.startsWith(base)) return new Response('Forbidden', { status: 403 })
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

export function isAppUrl(url: string, devOrigin: string | null): boolean {
  if (url === APP_ORIGIN || url.startsWith(`${APP_ORIGIN}/`)) return true
  return devOrigin !== null && (url === devOrigin || url.startsWith(`${devOrigin}/`))
}
