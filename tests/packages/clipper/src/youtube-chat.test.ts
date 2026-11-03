import { describe, expect, test } from "bun:test"

import { parseYoutubeChatLine } from "../../../../packages/clipper/src/youtube-chat"

const textMessage = (text: string, user: string, timestampUsec: string) => ({
  addChatItemAction: {
    item: {
      liveChatTextMessageRenderer: {
        authorName: { simpleText: user },
        message: { runs: [{ text }, { emoji: { emojiId: "x", shortcuts: [":fire:"] } }] },
        timestampUsec,
      },
    },
  },
})

describe("parseYoutubeChatLine", () => {
  test("parses a replay line with its video offset", () => {
    const line = JSON.stringify({
      replayChatItemAction: {
        actions: [textMessage("no way ", "@viewer", "1793482244460706")],
        videoOffsetTimeMsec: "8639",
      },
    })
    expect(parseYoutubeChatLine(line)).toEqual([
      { message: { at: 1793482244461, text: "no way :fire:", user: "@viewer" }, offsetMs: 8639 },
    ])
  })

  test("ignores banners, bad JSON, and blank lines", () => {
    const banner = JSON.stringify({
      replayChatItemAction: { actions: [{ addBannerToLiveChatCommand: {} }] },
    })
    expect(parseYoutubeChatLine(banner)).toEqual([])
    expect(parseYoutubeChatLine("{not json")).toEqual([])
    expect(parseYoutubeChatLine("  ")).toEqual([])
  })
})
