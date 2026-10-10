/** Formats seconds as m:ss.mmm, or h:mm:ss.mmm from one hour up. */
export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const totalMs = Math.round(safe * 1000)
  const ms = totalMs % 1000
  const totalSeconds = Math.floor(totalMs / 1000)
  const s = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const m = totalMinutes % 60
  const h = Math.floor(totalMinutes / 60)
  const tail = `${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${tail}` : `${m}:${tail}`
}

/** Formats a recording clock as m:ss (or h:mm:ss). */
export function formatClock(seconds: number): string {
  const total = Math.floor(Number.isFinite(seconds) && seconds > 0 ? seconds : 0)
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const tail = `${String(m).padStart(h > 0 ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`
  return h > 0 ? `${h}:${tail}` : tail
}

export function formatSampleRate(rate: number): string {
  // 48000 -> "48 kHz", 44100 -> "44.1 kHz", 22050 -> "22.05 kHz"
  return `${Number((rate / 1000).toFixed(3))} kHz`
}

export function formatDb(db: number): string {
  if (!Number.isFinite(db)) return '-∞ dB'
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`
}

/** Removes the extension from a file name ("take 1.mp3" -> "take 1"). */
export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}
