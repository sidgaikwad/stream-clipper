import { describe, expect, test } from "bun:test"

import { parseTwitchChatLine } from "../../../../packages/clipper/src/chat"

describe("parseTwitchChatLine", () => {
  test("parses a tagged PRIVMSG", () => {
    const line =
      "@badge-info=;color=#FF0000 :viewer1!viewer1@viewer1.tmi.twitch.tv PRIVMSG #streamer :KEKW no way"
    expect(parseTwitchChatLine(line, 5)).toEqual({ at: 5, text: "KEKW no way", user: "viewer1" })
  })

  test("parses an untagged PRIVMSG", () => {
    const line = ":viewer2!viewer2@viewer2.tmi.twitch.tv PRIVMSG #streamer :W"
    expect(parseTwitchChatLine(line, 1)).toEqual({ at: 1, text: "W", user: "viewer2" })
  })

  test("ignores other IRC lines", () => {
    expect(parseTwitchChatLine(":tmi.twitch.tv 001 justinfan123 :Welcome, GLHF!", 0)).toBeNull()
    expect(parseTwitchChatLine("PING :tmi.twitch.tv", 0)).toBeNull()
  })
})
