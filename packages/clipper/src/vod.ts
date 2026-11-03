import { mkdir, readdir, rm } from "node:fs/promises"
import { join } from "node:path"

import type { AiBackend } from "@/ai"
import type { ChatMessage } from "@/chat"
import { cutFile } from "@/cutter"
import { defaultDetectorOptions, spikeStrength, type DetectorOptions, type Spike } from "@/detector"
import {
  defaultLoudnessOptions,
  measureLoudness,
  median,
  type LoudnessOptions,
  type LoudnessSample,
} from "@/loudness"
import { offsetStamp, saveClip, type ClipMeta } from "@/output"
import { sourceSlug, type VodSource } from "@/sources"
import { downloadYoutubeChatReplay } from "@/youtube-chat"

export type VodSection = {
  end: number
  start: number
}

export type VodOptions = {
  ai: AiBackend
  detector?: Partial<DetectorOptions>
  keep?: boolean
  loudness?: Partial<LoudnessOptions>
  maxClips?: number
  ollamaModel?: string
  out: string
  postRollMs?: number
  preRollMs?: number
  section?: VodSection
  source: VodSource
}

const MIN_CHAT_MESSAGES = 200

const firstAfter = (times: number[], t: number) => {
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid]! <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

export const selectPeaks = (candidates: Spike[], separationMs: number) => {
  const chosen: Spike[] = []
  for (const candidate of [...candidates].sort((a, b) => spikeStrength(b) - spikeStrength(a))) {
    if (chosen.every((s) => Math.abs(s.at - candidate.at) >= separationMs)) chosen.push(candidate)
  }
  return chosen.sort((a, b) => a.at - b.at)
}

export const chatSpikes = (chat: ChatMessage[], durationMs: number, options: DetectorOptions) => {
  const { baselineMs, cooldownMs, minMessages, multiplier, warmupMs, windowMs } = options
  const times = chat.map((m) => m.at).sort((a, b) => a - b)
  const candidates: Spike[] = []
  for (let now = Math.max(warmupMs, windowMs + 2_000); now <= durationMs; now += 2_000) {
    const windowStart = now - windowMs
    const baselineStart = Math.max(0, windowStart - baselineMs)
    const messages = firstAfter(times, now) - firstAfter(times, windowStart)
    const before = firstAfter(times, windowStart) - firstAfter(times, baselineStart)
    const baseline = (before / (windowStart - baselineStart)) * windowMs
    if (messages >= minMessages && messages >= baseline * multiplier) {
      candidates.push({
        at: windowStart,
        baseline,
        detectedAt: now,
        signal: "chat",
        value: messages,
      })
    }
  }
  return selectPeaks(candidates, cooldownMs)
}

export const audioSpikes = (samples: LoudnessSample[], options: LoudnessOptions) => {
  const { baselineMs, cooldownMs, minDb, thresholdDb, warmupMs, windowMs } = options
  const sorted = [...samples].sort((a, b) => a.at - b.at)
  const times = sorted.map((s) => s.at)
  const levels = (from: number, to: number) =>
    sorted.slice(firstAfter(times, from), firstAfter(times, to)).map((s) => s.db)
  const candidates: Spike[] = []
  for (const { at: now } of sorted) {
    if (now < warmupMs) continue
    const windowStart = now - windowMs
    const window = levels(windowStart, now)
    const before = levels(windowStart - baselineMs, windowStart)
    if (window.length < (windowMs / 1000) * 0.75 || before.length < 30) continue
    const value = window.reduce((sum, db) => sum + db, 0) / window.length
    const baseline = median(before)
    if (value >= minDb && value - baseline >= thresholdDb) {
      candidates.push({ at: windowStart, baseline, detectedAt: now, signal: "audio", value })
    }
  }
  return selectPeaks(candidates, cooldownMs)
}

export const pickBest = (spikes: Spike[], max: number) =>
  [...spikes]
    .sort((a, b) => spikeStrength(b) - spikeStrength(a))
    .slice(0, max)
    .sort((a, b) => a.at - b.at)

const run = async (args: string[], quiet = true) => {
  const proc = Bun.spawn(args, { stderr: "pipe", stdout: quiet ? "pipe" : "inherit" })
  const stdout = quiet ? await new Response(proc.stdout as ReadableStream).text() : ""
  if ((await proc.exited) !== 0)
    throw new Error(`${args[0]} failed: ${await new Response(proc.stderr).text()}`)
  return stdout
}

export const processVod = async (options: VodOptions) => {
  const {
    ai,
    maxClips = 10,
    out,
    postRollMs = 15_000,
    preRollMs = 30_000,
    section,
    source,
  } = options
  const log = (message: string) =>
    console.log(
      `[${new Date().toLocaleTimeString()}] [${source.platform} vod ${source.id}] ${message}`,
    )
  const root = join(out, sourceSlug(source))
  const work = join(root, ".work")
  await mkdir(work, { recursive: true })

  const info = JSON.parse(await run(["yt-dlp", "-J", "--no-warnings", source.url]))
  const channel = String(info.uploader_id ?? info.uploader ?? info.channel ?? source.platform)
  const startMs = (section?.start ?? 0) * 1000
  const durationMs = ((section?.end ?? info.duration ?? 0) - (section?.start ?? 0)) * 1000
  log(
    `"${info.title}" by ${channel}, downloading ${Math.round(durationMs / 60_000)} min of video...`,
  )

  await run(
    [
      "yt-dlp",
      "--no-warnings",
      "--progress",
      "--no-part",
      "-f",
      "bv*[height<=720]+ba/b[height<=720]/b",
      "--merge-output-format",
      "mp4",
      ...(section ? ["--download-sections", `*${section.start}-${section.end}`] : []),
      "-o",
      join(work, "source.%(ext)s"),
      source.url,
    ],
    false,
  )
  const name = (await readdir(work)).find((f) => f.startsWith("source.") && f.endsWith(".mp4"))
  if (!name) throw new Error("yt-dlp did not produce source.mp4")
  const file = join(work, name)

  let chat: ChatMessage[] = []
  if (source.platform === "youtube") {
    log("downloading chat replay...")
    chat = (await downloadYoutubeChatReplay(source.url, work))
      .map((m) => ({ ...m, at: m.at - startMs }))
      .filter((m) => m.at >= 0 && m.at <= durationMs)
  }

  let spikes: Spike[]
  if (chat.length >= MIN_CHAT_MESSAGES) {
    log(`finding chat peaks in ${chat.length} messages...`)
    spikes = chatSpikes(chat, durationMs, {
      ...defaultDetectorOptions,
      multiplier: 1.5,
      warmupMs: 60_000,
      ...options.detector,
    })
  } else {
    log(
      chat.length
        ? "too little chat, using audio peaks instead..."
        : "no chat replay, finding audio peaks...",
    )
    spikes = audioSpikes(await measureLoudness(file), {
      ...defaultLoudnessOptions,
      thresholdDb: 4,
      warmupMs: 60_000,
      ...options.loudness,
    })
  }

  const best = pickBest(spikes, maxClips)
  log(`found ${spikes.length} peaks, cutting the best ${best.length}`)

  const clips: ClipMeta[] = []
  for (const spike of best) {
    const from = Math.max(0, spike.at - preRollMs)
    const to = Math.min(durationMs, spike.detectedAt + postRollMs)
    const dir = join(root, offsetStamp(startMs + from))
    await mkdir(dir, { recursive: true })
    const clipFile = join(dir, "clip.mp4")
    await cutFile(file, from, to, clipFile)
    clips.push(
      await saveClip({
        ai,
        channel,
        chat: chat
          .filter((m) => m.at >= from && m.at <= to)
          .map((m) => ({ ...m, at: m.at + startMs })),
        dir,
        file: clipFile,
        from: startMs + from,
        log,
        ollamaModel: options.ollamaModel,
        platform: source.platform,
        spike,
        to: startMs + to,
        vod: { id: source.id, title: String(info.title ?? ""), url: source.url },
      }),
    )
  }

  if (!options.keep) await rm(work, { force: true, recursive: true })
  log(`done: ${clips.length} clips in ${root}`)
  return clips
}
