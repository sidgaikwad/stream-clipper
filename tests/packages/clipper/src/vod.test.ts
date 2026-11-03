import { describe, expect, test } from "bun:test"

import type { Spike } from "../../../../packages/clipper/src/detector"
import {
  audioSpikes,
  chatSpikes,
  pickBest,
  selectPeaks,
} from "../../../../packages/clipper/src/vod"

const options = {
  baselineMs: 60_000,
  cooldownMs: 30_000,
  minMessages: 5,
  multiplier: 3,
  warmupMs: 30_000,
  windowMs: 10_000,
}

const message = (at: number) => ({ at, text: "W", user: "viewer" })

describe("chatSpikes", () => {
  test("finds bursts in a chat replay by video offset", () => {
    const steady = Array.from({ length: 150 }, (_, i) => message(i * 2_000))
    const burst = Array.from({ length: 60 }, (_, i) => message(200_100 + i * 150))
    const spikes = chatSpikes([...burst, ...steady], 300_000, options)
    expect(spikes).toHaveLength(1)
    expect(spikes[0]).toMatchObject({ signal: "chat" })
    expect(spikes[0]!.at).toBeGreaterThanOrEqual(190_000)
    expect(spikes[0]!.at).toBeLessThanOrEqual(210_000)
  })
})

describe("pickBest", () => {
  test("keeps the strongest spikes in time order", () => {
    const spike = (at: number, value: number): Spike => ({
      at,
      baseline: 10,
      detectedAt: at + 10_000,
      signal: "chat",
      value,
    })
    const best = pickBest([spike(100, 20), spike(200, 90), spike(300, 50), spike(400, 10)], 2)
    expect(best.map((s) => s.at)).toEqual([200, 300])
  })
})

describe("audioSpikes", () => {
  test("finds the loudest burst against the running median", () => {
    const levels = [...Array(120).fill(-30), ...Array(6).fill(-18), ...Array(60).fill(-30)]
    const samples = levels.map((db, i) => ({ at: i * 1000, db }))
    const spikes = audioSpikes(samples, {
      baselineMs: 60_000,
      cooldownMs: 30_000,
      minDb: -40,
      thresholdDb: 4,
      warmupMs: 30_000,
      windowMs: 4_000,
    })
    expect(spikes).toHaveLength(1)
    expect(spikes[0]).toMatchObject({ baseline: -30, signal: "audio", value: -18 })
  })
})

describe("selectPeaks", () => {
  test("keeps the strongest candidate in each neighborhood", () => {
    const candidate = (at: number, value: number): Spike => ({
      at,
      baseline: 10,
      detectedAt: at + 10_000,
      signal: "chat",
      value,
    })
    const peaks = selectPeaks(
      [candidate(0, 30), candidate(2_000, 50), candidate(4_000, 40), candidate(60_000, 25)],
      30_000,
    )
    expect(peaks.map((p) => p.at)).toEqual([2_000, 60_000])
  })
})
