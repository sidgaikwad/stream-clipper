import { rm } from "node:fs/promises"

export type Segment = {
  path: string
  start: number
}

export const pickSegments = (segments: Segment[], from: number, to: number) => {
  const sorted = [...segments].sort((a, b) => a.start - b.start)
  const picked = sorted.filter((segment, i) => {
    const end = sorted[i + 1]?.start ?? Infinity
    return segment.start < to && end > from
  })
  return { offsetMs: picked.length ? Math.max(0, from - picked[0]!.start) : 0, segments: picked }
}

export const cutClip = async (segments: Segment[], from: number, to: number, output: string) => {
  const picked = pickSegments(segments, from, to)
  if (!picked.segments.length) throw new Error("no recorded segments cover this clip")

  const list = `${output}.txt`
  await Bun.write(
    list,
    picked.segments.map((s) => `file '${s.path.replaceAll("'", "'\\''")}'`).join("\n"),
  )

  const ffmpeg = Bun.spawn(
    [
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-ss",
      (picked.offsetMs / 1000).toFixed(2),
      "-t",
      ((to - from) / 1000).toFixed(2),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "21",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      output,
    ],
    { stderr: "pipe" },
  )
  const code = await ffmpeg.exited
  await rm(list, { force: true })
  if (code !== 0) throw new Error(`ffmpeg failed: ${await new Response(ffmpeg.stderr).text()}`)
}
