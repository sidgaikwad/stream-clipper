import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"

import type { ChatMessage } from "@/chat"

export type YoutubeChatItem = {
  message: ChatMessage
  offsetMs?: number
}

type Run = { emoji?: { emojiId?: string; shortcuts?: string[] }; text?: string }

const runsToText = (runs: Run[] = []) =>
  runs.map((run) => run.text ?? run.emoji?.shortcuts?.[0] ?? run.emoji?.emojiId ?? "").join("")

export const parseYoutubeChatLine = (line: string): YoutubeChatItem[] => {
  if (!line.trim()) return []
  let data: any
  try {
    data = JSON.parse(line)
  } catch {
    return []
  }
  const replay = data.replayChatItemAction
  const actions: any[] = replay?.actions ?? (data.addChatItemAction ? [data] : [])
  const offset = replay?.videoOffsetTimeMsec
  return actions.flatMap((action) => {
    const item = action.addChatItemAction?.item
    const renderer = item?.liveChatTextMessageRenderer ?? item?.liveChatPaidMessageRenderer
    if (!renderer) return []
    const message = {
      at: Math.round(Number(renderer.timestampUsec) / 1000),
      text: runsToText(renderer.message?.runs),
      user: renderer.authorName?.simpleText ?? "",
    }
    return [{ message, offsetMs: offset === undefined ? undefined : Number(offset) }]
  })
}

const chatArgs = (url: string, output: string) => [
  "yt-dlp",
  "--quiet",
  "--no-warnings",
  "--skip-download",
  "--write-subs",
  "--sub-langs",
  "live_chat",
  "--force-overwrites",
  "-o",
  output,
  url,
]

export const connectYoutubeChat = (
  url: string,
  dir: string,
  onMessage: (message: ChatMessage) => void,
) => {
  let stopped = false
  let ytdlp: Bun.Subprocess | undefined
  const output = join(dir, "chat")
  const file = `${output}.live_chat.json.part`

  const follow = async () => {
    await mkdir(dir, { recursive: true })
    while (!stopped) {
      await rm(file, { force: true })
      ytdlp = Bun.spawn(chatArgs(url, output), { stderr: "ignore", stdout: "ignore" })
      let position = 0
      let partial = ""
      let exited = false
      void ytdlp.exited.then(() => (exited = true))
      while (!stopped) {
        const size = Bun.file(file).size
        if (size > position) {
          const lines = (partial + (await Bun.file(file).slice(position, size).text())).split("\n")
          partial = lines.pop() ?? ""
          position = size
          for (const line of lines)
            for (const item of parseYoutubeChatLine(line)) onMessage(item.message)
        } else if (exited) break
        await Bun.sleep(2_000)
      }
      if (!stopped) await Bun.sleep(60_000)
    }
  }

  void follow()
  return () => {
    stopped = true
    ytdlp?.kill()
  }
}

export const downloadYoutubeChatReplay = async (url: string, dir: string) => {
  const output = join(dir, "chat")
  const ytdlp = Bun.spawn(chatArgs(url, output), { stderr: "pipe", stdout: "ignore" })
  if ((await ytdlp.exited) !== 0) return []
  const file = Bun.file(`${output}.live_chat.json`)
  if (!(await file.exists())) return []
  return (await file.text())
    .split("\n")
    .flatMap(parseYoutubeChatLine)
    .filter((item) => item.offsetMs !== undefined)
    .map((item) => ({ ...item.message, at: item.offsetMs! }))
}
