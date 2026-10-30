import { describe, expect, test } from "bun:test"

import { SpikeDetector } from "../../../../packages/clipper/src/detector"

const options = {
  baselineMs: 60_000,
  cooldownMs: 30_000,
  minMessages: 5,
  multiplier: 3,
  warmupMs: 30_000,
  windowMs: 10_000,
}

const steadyChat = (detector: SpikeDetector, from: number, to: number, everyMs: number) => {
  for (let t = from; t < to; t += everyMs) detector.add(t)
}

describe("SpikeDetector", () => {
  test("ignores steady chat", () => {
    const detector = new SpikeDetector(0, options)
    steadyChat(detector, 0, 120_000, 1_000)
    expect(detector.check(120_000)).toBeNull()
  })

  test("flags a burst well above the baseline", () => {
    const detector = new SpikeDetector(0, options)
    steadyChat(detector, 1_000, 110_000, 2_000)
    steadyChat(detector, 110_100, 120_000, 200)
    const spike = detector.check(120_000)
    expect(spike).toMatchObject({ at: 110_000, detectedAt: 120_000, messages: 50 })
    expect(spike!.baseline).toBeCloseTo(5)
  })

  test("waits for warmup", () => {
    const detector = new SpikeDetector(0, options)
    steadyChat(detector, 10_000, 20_000, 100)
    expect(detector.check(20_000)).toBeNull()
  })

  test("needs a minimum number of messages", () => {
    const detector = new SpikeDetector(0, options)
    steadyChat(detector, 110_000, 120_000, 2_500)
    expect(detector.check(120_000)).toBeNull()
  })

  test("does not fire twice within the cooldown", () => {
    const detector = new SpikeDetector(0, options)
    steadyChat(detector, 110_000, 130_000, 200)
    expect(detector.check(120_000)).not.toBeNull()
    expect(detector.check(130_000)).toBeNull()
  })
})
