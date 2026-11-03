import { mkdir } from "node:fs/promises"
import { join } from "node:path"

import type { AiBackend } from "@/ai"
import { connectTwitchChat, type ChatMessage } from "@/chat"
import { cutClip } from "@/cutter"
import { defaultDetectorOptions, SpikeDetector, type DetectorOptions, type Spike } from "@/detector"
import {
  defaultLoudnessOptions,
  LoudnessDetector,
  measureLoudness,
  type LoudnessOptions,
} from "@/loudness"
import { saveClip, stamp } from "@/output"
import { listSegments, SEGMENT_SECONDS, startRecorder } from "@/recorder"
import { liveUrl, sourceSlug, type LiveSource } from "@/sources"
import { connectYoutubeChat } from "@/youtube-chat"

export type WatchOptions = {
  ai: AiBackend
  detector?: Partial<DetectorOptions>
  loudness?: Partial<LoudnessOptions>
  ollamaModel?: string
  out: string
  postRollMs?: number
  preRollMs?: number
  quality?: string
  source: LiveSource
}

export const watch = (options: WatchOptions) => {
  const {
    ai,
    out,
    postRollMs = 15_000,
    preRollMs = 30_000,
    quality = "720p60,720p,best",
    source,
  } = options
  const name = `${source.platform}:${source.channel}`
  const log = (message: string) =>
    console.log(`[${new Date().toLocaleTimeString()}] [${name}] ${message}`)
  const root = join(out, sourceSlug(source))
  const segmentsDir = join(root, ".segments")
  const url = liveUrl(source)
  const useAudio = source.platform === "kick"
  const chatDetector = new SpikeDetector(Date.now(), {
    ...defaultDetectorOptions,
    ...options.detector,
  })
  const audioDetector = new LoudnessDetector(Date.now(), {
    ...defaultLoudnessOptions,
    ...options.loudness,
  })
  const measured = new Set<string>()
  let chat: ChatMessage[] = []

  const stopRecorder = startRecorder({
    bufferMs: 10 * 60_000,
    dir: segmentsDir,
    log,
    name,
    quality,
    url,
  })

  const onMessage = (message: ChatMessage) => {
    chat.push(message)
    chatDetector.add(message.at)
  }
  const stopChat = useAudio
    ? () => {}
    : source.platform === "youtube"
      ? connectYoutubeChat(url, join(root, ".chat"), onMessage)
      : connectTwitchChat(source.channel, onMessage)

  const makeClip = async (spike: Spike) => {
    const from = spike.at - preRollMs
    const to = spike.detectedAt + postRollMs
    await Bun.sleep(Math.max(0, to - Date.now()) + (SEGMENT_SECONDS + 3) * 1000)

    const dir = join(root, stamp(spike.at))
    await mkdir(dir, { recursive: true })
    const file = join(dir, "clip.mp4")
    await cutClip(await listSegments(segmentsDir), from, to, file)
    await saveClip({
      ai,
      channel: source.channel,
      chat: chat.filter((m) => m.at >= from && m.at <= to),
      dir,
      file,
      from,
      log,
      ollamaModel: options.ollamaModel,
      platform: source.platform,
      spike,
      to,
    })
  }

  const checkAudio = async () => {
    const segments = await listSegments(segmentsDir)
    for (const segment of segments.slice(0, -1)) {
      if (measured.has(segment.path)) continue
      measured.add(segment.path)
      for (const sample of await measureLoudness(segment.path, segment.start)) {
        audioDetector.add(sample)
        const spike = audioDetector.check(sample.at)
        if (spike) onSpike(spike)
      }
    }
    for (const path of measured) if (!segments.some((s) => s.path === path)) measured.delete(path)
  }

  const onSpike = (spike: Spike) => {
    log(
      spike.signal === "audio"
        ? `audio spike: ${spike.value.toFixed(1)} dB (normal ~${spike.baseline.toFixed(1)} dB), clipping`
        : `chat spike: ${spike.value} messages in 10s (normal ~${spike.baseline.toFixed(1)}), clipping`,
    )
    makeClip(spike).catch((error) => log(`clip failed: ${error}`))
  }

  let checking = false
  const tick = setInterval(async () => {
    const now = Date.now()
    chat = chat.filter((m) => m.at > now - 15 * 60_000)
    if (!useAudio) {
      const spike = chatDetector.check(now)
      if (spike) onSpike(spike)
      return
    }
    if (checking) return
    checking = true
    await checkAudio().catch((error) => log(`audio check failed: ${error}`))
    checking = false
  }, 2_000)

  log(`watching, warming up ${useAudio ? "audio" : "chat"} baseline...`)
  return () => {
    clearInterval(tick)
    stopChat()
    stopRecorder()
  }
}
