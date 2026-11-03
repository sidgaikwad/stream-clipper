import type { Spike } from "@/detector"

export type LoudnessSample = {
  at: number
  db: number
}

export type LoudnessOptions = {
  baselineMs: number
  cooldownMs: number
  minDb: number
  thresholdDb: number
  warmupMs: number
  windowMs: number
}

export const defaultLoudnessOptions: LoudnessOptions = {
  baselineMs: 5 * 60_000,
  cooldownMs: 90_000,
  minDb: -30,
  thresholdDb: 8,
  warmupMs: 2 * 60_000,
  windowMs: 4_000,
}

const SILENCE_DB = -91

export const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export const parseAstats = (output: string, offsetMs = 0): LoudnessSample[] => {
  const samples: LoudnessSample[] = []
  let time: number | undefined
  for (const line of output.split("\n")) {
    const pts = /pts_time:([\d.]+)/.exec(line)
    if (pts) time = Number(pts[1])
    const rms = /lavfi\.astats\.Overall\.RMS_level=(\S+)/.exec(line)
    if (rms && time !== undefined) {
      const db = Number(rms[1])
      samples.push({ at: offsetMs + time * 1000, db: Number.isFinite(db) ? db : SILENCE_DB })
    }
  }
  return samples
}

export const measureLoudness = async (file: string, offsetMs = 0) => {
  const ffmpeg = Bun.spawn(
    [
      "ffmpeg",
      "-hide_banner",
      "-nostats",
      "-i",
      file,
      "-vn",
      "-af",
      "aresample=16000,asetnsamples=n=16000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
      "-f",
      "null",
      "-",
    ],
    { stderr: "ignore", stdout: "pipe" },
  )
  const output = await new Response(ffmpeg.stdout).text()
  await ffmpeg.exited
  return parseAstats(output, offsetMs)
}

export class LoudnessDetector {
  private lastSpikeAt = -Infinity
  private samples: LoudnessSample[] = []

  constructor(
    private readonly startedAt: number,
    private readonly options: LoudnessOptions = defaultLoudnessOptions,
  ) {}

  add(sample: LoudnessSample) {
    this.samples.push(sample)
  }

  check(now: number): Spike | null {
    const { baselineMs, cooldownMs, minDb, thresholdDb, warmupMs, windowMs } = this.options
    const windowStart = now - windowMs
    this.samples = this.samples.filter((s) => s.at > windowStart - baselineMs && s.at <= now)

    if (now - this.startedAt < warmupMs || now - this.lastSpikeAt < cooldownMs) return null

    const window = this.samples.filter((s) => s.at > windowStart)
    const before = this.samples.filter((s) => s.at <= windowStart)
    if (window.length < (windowMs / 1000) * 0.75 || before.length < 30) return null

    const value = window.reduce((sum, s) => sum + s.db, 0) / window.length
    const baseline = median(before.map((s) => s.db))

    if (value < minDb || value - baseline < thresholdDb) return null

    this.lastSpikeAt = now
    return { at: windowStart, baseline, detectedAt: now, signal: "audio", value }
  }
}
