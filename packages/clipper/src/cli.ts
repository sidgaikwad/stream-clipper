import { resolve } from "node:path"
import { parseArgs } from "node:util"

import type { AiBackend } from "@/ai"
import { watch } from "@/watch"

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    ai: { default: "claude", type: "string" },
    "min-messages": { type: "string" },
    multiplier: { type: "string" },
    "ollama-model": { type: "string" },
    out: { default: "clips", type: "string" },
    quality: { type: "string" },
    warmup: { type: "string" },
  },
})

const channel = positionals[0]
if (!channel || !["claude", "none", "ollama"].includes(values.ai)) {
  console.log(`Usage: bun run clip <twitch-channel> [options]

  --ai claude|ollama|none   who rates clips (default: claude, your logged-in Claude CLI)
  --out <dir>               where clips are saved (default: ./clips)
  --multiplier <n>          how many times busier than normal chat must be (default: 3)
  --min-messages <n>        minimum chat messages in 10s to count as a spike (default: 15)
  --warmup <seconds>        seconds of chat to learn the normal pace first (default: 120)
  --quality <list>          stream quality preference (default: 720p60,720p,best)
  --ollama-model <name>     model for --ai ollama (default: llama3.2)`)
  process.exit(1)
}

const number = (value: string | undefined) => (value === undefined ? undefined : Number(value))

const stop = watch({
  ai: values.ai as AiBackend,
  channel: channel.toLowerCase(),
  detector: Object.fromEntries(
    Object.entries({
      minMessages: number(values["min-messages"]),
      multiplier: number(values.multiplier),
      warmupMs: values.warmup === undefined ? undefined : Number(values.warmup) * 1000,
    }).filter(([, value]) => value !== undefined),
  ),
  ollamaModel: values["ollama-model"],
  out: resolve(process.env.INIT_CWD ?? process.cwd(), values.out),
  quality: values.quality,
})

process.on("SIGINT", () => {
  stop()
  process.exit(0)
})
