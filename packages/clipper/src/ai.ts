import { tmpdir } from "node:os"

import type { ChatMessage } from "@/chat"

export type AiBackend = "claude" | "none" | "ollama"

export type ClipReview = {
  reason: string
  score: number
  title: string
}

const schema = {
  properties: {
    reason: { type: "string" },
    score: { maximum: 10, minimum: 1, type: "integer" },
    title: { type: "string" },
  },
  required: ["reason", "score", "title"],
  type: "object",
}

export const buildPrompt = (channel: string, from: number, messages: ChatMessage[]) =>
  [
    `You review moments from the Twitch streamer "${channel}" for a clips channel.`,
    "Chat suddenly got much busier. Below is the chat during the clip window, with seconds from the start of the clip.",
    "Judge from the chat reaction how clip-worthy the moment probably is.",
    "Return score (1 = nothing happened, 10 = must clip), a punchy YouTube Shorts title under 60 characters, and a one-sentence reason.",
    "",
    ...messages
      .slice(-300)
      .map((m) => `[${Math.round((m.at - from) / 1000)}s] ${m.user}: ${m.text}`),
  ].join("\n")

const reviewWithClaude = async (prompt: string): Promise<ClipReview> => {
  const claude = Bun.spawn(
    [
      "claude",
      "-p",
      "--model",
      "haiku",
      "--output-format",
      "json",
      "--tools",
      "",
      "--no-session-persistence",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--json-schema",
      JSON.stringify(schema),
    ],
    { cwd: tmpdir(), stderr: "pipe", stdin: new Blob([prompt]), stdout: "pipe" },
  )
  const output = await new Response(claude.stdout).text()
  await claude.exited
  const result = JSON.parse(output)
  if (result.is_error) throw new Error(`claude: ${result.result}`)
  return result.structured_output ?? JSON.parse(result.result)
}

const reviewWithOllama = async (prompt: string, model: string): Promise<ClipReview> => {
  const response = await fetch("http://localhost:11434/api/generate", {
    body: JSON.stringify({ format: schema, model, prompt, stream: false }),
    method: "POST",
  })
  if (!response.ok) throw new Error(`ollama: ${response.status} ${await response.text()}`)
  return JSON.parse((await response.json()).response)
}

export const reviewClip = async (
  backend: AiBackend,
  prompt: string,
  ollamaModel = "llama3.2",
): Promise<ClipReview | null> => {
  if (backend === "claude") return reviewWithClaude(prompt)
  if (backend === "ollama") return reviewWithOllama(prompt, ollamaModel)
  return null
}
