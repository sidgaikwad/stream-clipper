import { describe, expect, test } from "bun:test"

import { liveUrl, parseSource, sourceSlug } from "../../../../packages/clipper/src/sources"

describe("parseSource", () => {
  test("treats a bare name as a Twitch channel", () => {
    expect(parseSource("xQc")).toEqual({ channel: "xqc", kind: "live", platform: "twitch" })
  })

  test("reads platform prefixes", () => {
    expect(parseSource("kick:XQC")).toEqual({ channel: "xqc", kind: "live", platform: "kick" })
    expect(parseSource("youtube:IShowSpeed")).toEqual({
      channel: "@IShowSpeed",
      kind: "live",
      platform: "youtube",
    })
  })

  test("reads live channel links", () => {
    expect(parseSource("https://www.twitch.tv/xqc")).toMatchObject({
      channel: "xqc",
      platform: "twitch",
    })
    expect(parseSource("https://kick.com/xqc/")).toMatchObject({ channel: "xqc", platform: "kick" })
    expect(parseSource("https://www.youtube.com/@IShowSpeed/live")).toMatchObject({
      channel: "@IShowSpeed",
      platform: "youtube",
    })
  })

  test("reads VOD links", () => {
    expect(parseSource("https://www.youtube.com/watch?v=IkhjzYsvCmw&t=10")).toMatchObject({
      id: "IkhjzYsvCmw",
      kind: "vod",
      platform: "youtube",
    })
    expect(parseSource("https://youtu.be/IkhjzYsvCmw")).toMatchObject({
      id: "IkhjzYsvCmw",
      kind: "vod",
    })
    expect(parseSource("https://www.youtube.com/live/IkhjzYsvCmw")).toMatchObject({ kind: "vod" })
    expect(parseSource("https://www.twitch.tv/videos/2917899069")).toMatchObject({
      id: "2917899069",
      kind: "vod",
      platform: "twitch",
    })
    expect(
      parseSource("https://kick.com/xqc/videos/0b5f2c1e-aaaa-bbbb-cccc-1234567890ab"),
    ).toMatchObject({ kind: "vod", platform: "kick" })
  })

  test("rejects anything else", () => {
    expect(parseSource("https://example.com/video")).toBeNull()
    expect(parseSource("not a channel!")).toBeNull()
  })
})

describe("liveUrl and sourceSlug", () => {
  test("build per-platform URLs and folder names", () => {
    const youtube = parseSource("youtube:@IShowSpeed")!
    expect(youtube.kind === "live" && liveUrl(youtube)).toBe(
      "https://www.youtube.com/@IShowSpeed/live",
    )
    expect(sourceSlug(youtube)).toBe("youtube-ishowspeed")
    expect(sourceSlug(parseSource("https://youtu.be/IkhjzYsvCmw")!)).toBe("youtube-vod-IkhjzYsvCmw")
  })
})
