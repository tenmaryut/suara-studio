interface ParsedVersion {
  core: [number, number, number]
  prerelease: string[]
}

function parse(version: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version.trim())
  if (!match) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : []
  }
}

function compareIdentifiers(a: string, b: string): number {
  const aNum = /^\d+$/.test(a)
  const bNum = /^\d+$/.test(b)
  if (aNum && bNum) return Math.sign(Number(a) - Number(b))
  if (aNum) return -1
  if (bNum) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Compares two semantic versions ("1.2.3", "v1.2.3-beta.1").
 * Returns -1, 0 or 1, or null when either string is not a valid version.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return null
  for (let i = 0; i < 3; i++) {
    const diff = Math.sign(pa.core[i]! - pb.core[i]!)
    if (diff !== 0) return diff as -1 | 1
  }
  // A version without a prerelease tag ranks above one with it (1.0.0 > 1.0.0-rc.1).
  if (pa.prerelease.length === 0 || pb.prerelease.length === 0) {
    return Math.sign(pb.prerelease.length - pa.prerelease.length) as -1 | 0 | 1
  }
  const length = Math.max(pa.prerelease.length, pb.prerelease.length)
  for (let i = 0; i < length; i++) {
    const x = pa.prerelease[i]
    const y = pb.prerelease[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const diff = compareIdentifiers(x, y)
    if (diff !== 0) return diff as -1 | 1
  }
  return 0
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) === 1
}
