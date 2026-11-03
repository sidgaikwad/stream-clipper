import { join } from "node:path"

import { buildPrompt, reviewClip, type AiBackend, type ClipReview } from "@/ai"
import type { ChatMessage } from "@/chat"
import type { Spike } from "@/detector"
import type { Platform } from "@/sources"

export type ClipMeta = {
  channel: string
  chat: ChatMessage[]
  file: string
  from: number
  platform: Platform
  review: ClipReview | null
  reviewError?: string
  spike: Spike
  to: number
  vod?: { id: string; title: string; url: string }
}

export type SaveClipOptions = Omit<ClipMeta, "review" | "reviewError"> & {
  ai: AiBackend
  dir: string
  log: (message: string) => void
  ollamaModel?: string
}

export const stamp = (at: number) =>
  new Date(at - new Date(at).getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", "_")
    .replaceAll(":", "-")

export const offsetStamp = (ms: number) => {
  const total = Math.floor(ms / 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(Math.floor(total / 3600))}-${pad(Math.floor((total % 3600) / 60))}-${pad(total % 60)}`
}

export const saveClip = async ({ ai, dir, log, ollamaModel, ...clip }: SaveClipOptions) => {
  const meta: ClipMeta = { ...clip, review: null }
  if (clip.chat.length) {
    try {
      meta.review = await reviewClip(
        ai,
        buildPrompt(clip.channel, clip.from, clip.chat),
        ollamaModel,
      )
    } catch (error) {
      meta.reviewError = String(error)
    }
  }
  await Bun.write(join(dir, "meta.json"), JSON.stringify(meta, null, 2))
  log(
    meta.review
      ? `clip saved (score ${meta.review.score}/10): "${meta.review.title}" -> ${clip.file}`
      : `clip saved${meta.reviewError ? ` (AI review failed: ${meta.reviewError})` : ""} -> ${clip.file}`,
  )
  return meta
}
