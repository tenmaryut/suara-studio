import { net } from 'electron'
import { GITHUB_REPO, RELEASES_URL } from '../shared/app-info'

export interface LatestRelease {
  version: string
  url: string
}

/** Reads the newest published (non-draft, non-prerelease) release from GitHub. */
export async function fetchLatestRelease(timeoutMs = 10_000): Promise<LatestRelease> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await net.fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'suara-studio' },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`GitHub responded with ${response.status}`)
    const body = (await response.json()) as { tag_name?: unknown; html_url?: unknown }
    if (typeof body.tag_name !== 'string') throw new Error('Unexpected release data')
    const url =
      typeof body.html_url === 'string' && body.html_url.startsWith(`${RELEASES_URL}/`)
        ? body.html_url
        : RELEASES_URL
    return { version: body.tag_name.replace(/^v/, ''), url }
  } finally {
    clearTimeout(timer)
  }
}
