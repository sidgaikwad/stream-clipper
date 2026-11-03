import { describe, expect, test } from "bun:test"

import { LoudnessDetector, parseAstats } from "../../../../packages/clipper/src/loudness"

const options = {
  baselineMs: 60_000,
  cooldownMs: 30_000,
  minDb: -30,
  thresholdDb: 8,
  warmupMs: 30_000,
  windowMs: 4_000,
}

const feed = (detector: LoudnessDetector, levels: number[]) => {
  const spikes = []
  for (const [i, db] of levels.entries()) {
    detector.add({ at: i * 1000, db })
    const spike = detector.check(i * 1000)
    if (spike) spikes.push(spike)
  }
  return spikes
}

describe("parseAstats", () => {
  test("reads one RMS level per frame, offset and with silence as a floor", () => {
    const output = [
      "frame:0    pts:0       pts_time:0",
      "lavfi.astats.Overall.RMS_level=-23.5",
      "frame:1    pts:16000   pts_time:1",
      "lavfi.astats.Overall.RMS_level=-inf",
    ].join("\n")
    expect(parseAstats(output, 5_000)).toEqual([
      { at: 5_000, db: -23.5 },
      { at: 6_000, db: -91 },
    ])
  })
})

describe("LoudnessDetector", () => {
  test("ignores steady audio", () => {
    expect(feed(new LoudnessDetector(0, options), Array(120).fill(-25))).toEqual([])
  })

  test("flags a loud burst well above the baseline", () => {
    const levels = [...Array(90).fill(-28), ...Array(5).fill(-14), ...Array(20).fill(-28)]
    const spikes = feed(new LoudnessDetector(0, options), levels)
    expect(spikes).toHaveLength(1)
    expect(spikes[0]).toMatchObject({ baseline: -28, signal: "audio" })
    expect(spikes[0]!.detectedAt).toBeGreaterThanOrEqual(90_000)
  })

  test("ignores bursts that stay quiet overall", () => {
    const levels = [...Array(90).fill(-60), ...Array(5).fill(-40), ...Array(20).fill(-60)]
    expect(feed(new LoudnessDetector(0, options), levels)).toEqual([])
  })
})
