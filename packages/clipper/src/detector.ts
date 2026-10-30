export type DetectorOptions = {
  baselineMs: number
  cooldownMs: number
  minMessages: number
  multiplier: number
  warmupMs: number
  windowMs: number
}

export type Spike = {
  at: number
  baseline: number
  detectedAt: number
  messages: number
}

export const defaultDetectorOptions: DetectorOptions = {
  baselineMs: 5 * 60_000,
  cooldownMs: 90_000,
  minMessages: 15,
  multiplier: 3,
  warmupMs: 2 * 60_000,
  windowMs: 10_000,
}

export class SpikeDetector {
  private lastSpikeAt = -Infinity
  private times: number[] = []

  constructor(
    private readonly startedAt: number,
    private readonly options: DetectorOptions = defaultDetectorOptions,
  ) {}

  add(at: number) {
    this.times.push(at)
  }

  check(now: number): Spike | null {
    const { baselineMs, cooldownMs, minMessages, multiplier, warmupMs, windowMs } = this.options
    const windowStart = now - windowMs
    this.times = this.times.filter((t) => t > windowStart - baselineMs && t <= now)

    if (now - this.startedAt < warmupMs || now - this.lastSpikeAt < cooldownMs) return null

    const messages = this.times.filter((t) => t > windowStart).length
    const baselineSpan = Math.min(baselineMs, windowStart - this.startedAt)
    const baseline = ((this.times.length - messages) / baselineSpan) * windowMs

    if (messages < minMessages || messages < baseline * multiplier) return null

    this.lastSpikeAt = now
    return { at: windowStart, baseline, detectedAt: now, messages }
  }
}
