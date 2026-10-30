import { mkdir } from "node:fs/promises"
import { join } from "node:path"

import { buildPrompt, reviewClip, type AiBackend, type ClipReview } from "@/ai"
import { connectChat, type ChatMessage } from "@/chat"
import { cutClip } from "@/cutter"
import { defaultDetectorOptions, SpikeDetector, type DetectorOptions, type Spike } from "@/detector"
import { listSegments, SEGMENT_SECONDS, startRecorder } from "@/recorder"

export type WatchOptions = {
  ai: AiBackend
  channel: string
  detector?: Partial<DetectorOptions>
  ollamaModel?: string
  out: string
  postRollMs?: number
  preRollMs?: number
  quality?: string
}

export type ClipMeta = {
  channel: string
  chat: ChatMessage[]
  file: string
  from: number
  review: ClipReview | null
  reviewError?: string
  spike: Spike
  to: number
}

const stamp = (at: number) =>
  new Date(at - new Date(at).getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", "_")
    .replaceAll(":", "-")

export const watch = (options: WatchOptions) => {
  const {
    ai,
    channel,
    out,
    postRollMs = 15_000,
    preRollMs = 30_000,
    quality = "720p60,720p,best",
  } = options
  const log = (message: string) => console.log(`[${new Date().toLocaleTimeString()}] ${message}`)
  const segmentsDir = join(out, channel, ".segments")
  const detector = new SpikeDetector(Date.now(), { ...defaultDetectorOptions, ...options.detector })
  let chat: ChatMessage[] = []

  const stopRecorder = startRecorder({
    bufferMs: 10 * 60_000,
    channel,
    dir: segmentsDir,
    log,
    quality,
  })
  const stopChat = connectChat(channel, (message) => {
    chat.push(message)
    detector.add(message.at)
  })

  const makeClip = async (spike: Spike) => {
    const from = spike.at - preRollMs
    const to = spike.detectedAt + postRollMs
    await Bun.sleep(to - Date.now() + (SEGMENT_SECONDS + 3) * 1000)

    const dir = join(out, channel, stamp(spike.at))
    await mkdir(dir, { recursive: true })
    const file = join(dir, "clip.mp4")
    await cutClip(await listSegments(segmentsDir), from, to, file)

    const window = chat.filter((m) => m.at >= from && m.at <= to)
    const meta: ClipMeta = { channel, chat: window, file, from, review: null, spike, to }
    try {
      meta.review = await reviewClip(ai, buildPrompt(channel, from, window), options.ollamaModel)
    } catch (error) {
      meta.reviewError = String(error)
    }
    await Bun.write(join(dir, "meta.json"), JSON.stringify(meta, null, 2))
    log(
      meta.review
        ? `clip saved (score ${meta.review.score}/10): "${meta.review.title}" -> ${file}`
        : `clip saved${meta.reviewError ? ` (AI review failed: ${meta.reviewError})` : ""} -> ${file}`,
    )
  }

  const tick = setInterval(() => {
    const now = Date.now()
    chat = chat.filter((m) => m.at > now - 15 * 60_000)
    const spike = detector.check(now)
    if (!spike) return
    log(
      `chat spike: ${spike.messages} messages in 10s (normal ~${spike.baseline.toFixed(1)}), clipping`,
    )
    makeClip(spike).catch((error) => log(`clip failed: ${error}`))
  }, 2_000)

  log(`watching ${channel}, warming up chat baseline...`)
  return () => {
    clearInterval(tick)
    stopChat()
    stopRecorder()
  }
}
