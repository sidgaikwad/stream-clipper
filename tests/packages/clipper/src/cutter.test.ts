import { describe, expect, test } from "bun:test"

import { pickSegments } from "../../../../packages/clipper/src/cutter"

const segments = [0, 10_000, 20_000, 30_000, 40_000].map((start) => ({
  path: `${start}.ts`,
  start,
}))

describe("pickSegments", () => {
  test("picks every segment overlapping the window and the offset into the first", () => {
    const { offsetMs, segments: picked } = pickSegments(segments, 15_000, 32_000)
    expect(picked.map((s) => s.start)).toEqual([10_000, 20_000, 30_000])
    expect(offsetMs).toBe(5_000)
  })

  test("treats the newest segment as open-ended", () => {
    expect(pickSegments(segments, 45_000, 60_000).segments.map((s) => s.start)).toEqual([40_000])
  })

  test("returns nothing when the window predates the buffer", () => {
    expect(pickSegments(segments.slice(2), 0, 5_000).segments).toEqual([])
  })
})
