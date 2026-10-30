import { mkdir, readdir, rm } from "node:fs/promises"
import { join } from "node:path"

import type { Segment } from "@/cutter"

export const SEGMENT_SECONDS = 10

export type RecorderOptions = {
  bufferMs: number
  channel: string
  dir: string
  log: (message: string) => void
  quality: string
}

export const listSegments = async (dir: string): Promise<Segment[]> => {
  const names = await readdir(dir).catch(() => [] as string[])
  return names
    .filter((name) => /^\d+\.ts$/.test(name))
    .map((name) => ({ path: join(dir, name), start: Number.parseInt(name, 10) * 1000 }))
    .sort((a, b) => a.start - b.start)
}

export const startRecorder = ({ bufferMs, channel, dir, log, quality }: RecorderOptions) => {
  let stopped = false
  let streamlink: Bun.Subprocess | undefined
  let ffmpeg: Bun.Subprocess | undefined

  const record = async () => {
    await mkdir(dir, { recursive: true })
    while (!stopped) {
      streamlink = Bun.spawn(
        ["streamlink", "--stdout", "--twitch-disable-ads", `https://twitch.tv/${channel}`, quality],
        { stderr: "ignore", stdout: "pipe" },
      )
      ffmpeg = Bun.spawn(
        [
          "ffmpeg",
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          "pipe:0",
          "-c",
          "copy",
          "-f",
          "segment",
          "-segment_time",
          String(SEGMENT_SECONDS),
          "-reset_timestamps",
          "1",
          "-strftime",
          "1",
          join(dir, "%s.ts"),
        ],
        { stderr: "inherit", stdin: streamlink.stdout as ReadableStream },
      )
      log(`recording ${channel} (${quality})`)
      await ffmpeg.exited
      streamlink.kill()
      if (stopped) break
      log(`${channel} is offline or the stream dropped, retrying in 60s`)
      await Bun.sleep(60_000)
    }
  }

  const prune = setInterval(async () => {
    const cutoff = Date.now() - bufferMs
    for (const segment of await listSegments(dir)) {
      if (segment.start < cutoff) await rm(segment.path, { force: true })
    }
  }, 30_000)

  void record()

  return () => {
    stopped = true
    clearInterval(prune)
    streamlink?.kill()
    ffmpeg?.kill()
  }
}
