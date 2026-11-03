import { resolve } from "node:path"
import { parseArgs } from "node:util"

import type { AiBackend } from "@/ai"
import { parseSource, resolveLiveVod, type LiveSource, type VodSource } from "@/sources"
import { processVod, type VodSection } from "@/vod"
import { watch } from "@/watch"

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    ai: { default: "claude", type: "string" },
    "audio-threshold": { type: "string" },
    keep: { default: false, type: "boolean" },
    "max-clips": { type: "string" },
    "min-messages": { type: "string" },
    multiplier: { type: "string" },
    "ollama-model": { type: "string" },
    out: { default: "clips", type: "string" },
    quality: { type: "string" },
    section: { type: "string" },
    warmup: { type: "string" },
  },
})

const usage = `Usage: bun run clip <source...> [options]

Sources (mix and match, live channels run at the same time):
  xqc  or  twitch:xqc  or  https://twitch.tv/xqc            Twitch live (chat spikes)
  kick:xqc  or  https://kick.com/xqc                        Kick live (audio spikes)
  youtube:@IShowSpeed  or  https://youtube.com/@IShowSpeed  YouTube live (chat spikes)
  https://youtube.com/watch?v=...                           YouTube VOD (chat replay)
  https://twitch.tv/videos/...  or  https://kick.com/<ch>/videos/...   VOD (audio spikes)

Options:
  --ai claude|ollama|none   who rates clips (default: claude, your logged-in Claude CLI)
  --out <dir>               where clips are saved (default: ./clips)
  --multiplier <n>          how many times busier than normal chat must be (default: 3 live, 1.5 VOD)
  --min-messages <n>        minimum chat messages in 10s to count as a spike (default: 15)
  --audio-threshold <dB>    how much louder than normal audio must be (default: 8 live, 4 VOD)
  --warmup <seconds>        seconds to learn the normal pace first (default: 120 live, 60 VOD)
  --quality <list>          live stream quality preference (default: 720p60,720p,best)
  --max-clips <n>           VOD only: keep the n moments that stand out most (default: 10)
  --section <from>-<to>     VOD only: just this part, e.g. 1:00:00-1:30:00
  --keep                    VOD only: keep the downloaded video
  --ollama-model <name>     model for --ai ollama (default: llama3.2)`

const fail = (message: string): never => {
  console.log(`${message}\n\n${usage}`)
  process.exit(1)
}

const parseTime = (value: string) =>
  value.split(":").reduce((total, part) => total * 60 + Number(part), 0)

const parseSection = (value?: string): VodSection | undefined => {
  if (!value) return undefined
  const [start, end] = value.split("-").map(parseTime)
  if (start === undefined || end === undefined || !(end > start))
    fail(`invalid --section "${value}"`)
  return { end: end!, start: start! }
}

const number = (value: string | undefined) => (value === undefined ? undefined : Number(value))

const defined = <T extends object>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>

if (!positionals.length) fail("no source given")
if (!["claude", "none", "ollama"].includes(values.ai)) fail(`unknown --ai "${values.ai}"`)

const sources = await Promise.all(
  positionals.map((input) =>
    resolveLiveVod(parseSource(input) ?? fail(`can't read source "${input}"`)),
  ),
)
const warmupMs = values.warmup === undefined ? undefined : Number(values.warmup) * 1000
const common = {
  ai: values.ai as AiBackend,
  detector: defined({
    minMessages: number(values["min-messages"]),
    multiplier: number(values.multiplier),
    warmupMs,
  }),
  loudness: defined({ thresholdDb: number(values["audio-threshold"]), warmupMs }),
  ollamaModel: values["ollama-model"],
  out: resolve(process.env.INIT_CWD ?? process.cwd(), values.out),
}

const stops = sources
  .filter((s): s is LiveSource => s.kind === "live")
  .map((source) => watch({ ...common, quality: values.quality, source }))

process.on("SIGINT", () => {
  for (const stop of stops) stop()
  process.exit(0)
})

for (const source of sources.filter((s): s is VodSource => s.kind === "vod")) {
  await processVod({
    ...common,
    keep: values.keep,
    maxClips: number(values["max-clips"]),
    section: parseSection(values.section),
    source,
  }).catch((error) => console.log(`[${source.url}] failed: ${error}`))
}

if (!stops.length) process.exit(0)
