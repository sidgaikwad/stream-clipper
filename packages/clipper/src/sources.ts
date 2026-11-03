export type Platform = "kick" | "twitch" | "youtube"

export type LiveSource = {
  channel: string
  kind: "live"
  platform: Platform
  url?: string
}

export type VodSource = {
  id: string
  kind: "vod"
  platform: Platform
  url: string
}

export type Source = LiveSource | VodSource

const PREFIXED = /^(kick|twitch|youtube):(@?[\w.-]+)$/i

const vodPatterns: [Platform, RegExp][] = [
  ["kick", /kick\.com\/[\w-]+\/videos\/([\w-]+)/i],
  ["twitch", /twitch\.tv\/videos\/(\d+)/i],
  ["youtube", /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|live\/|shorts\/)|youtu\.be\/)([\w-]{11})/i],
]

const livePatterns: [Platform, RegExp][] = [
  ["kick", /kick\.com\/([\w-]+)\/?$/i],
  ["twitch", /twitch\.tv\/(\w+)\/?$/i],
  ["youtube", /youtube\.com\/(@[\w.-]+)(?:\/(?:live|streams))?\/?$/i],
]

const normalizeChannel = (platform: Platform, channel: string) => {
  if (platform !== "youtube") return channel.toLowerCase()
  return channel.startsWith("@") ? channel : `@${channel}`
}

export const parseSource = (input: string): Source | null => {
  const value = input.trim()
  for (const [platform, pattern] of vodPatterns) {
    const match = pattern.exec(value)
    if (match) return { id: match[1]!, kind: "vod", platform, url: value }
  }
  for (const [platform, pattern] of livePatterns) {
    const match = pattern.exec(value)
    if (match) return { channel: normalizeChannel(platform, match[1]!), kind: "live", platform }
  }
  const prefixed = PREFIXED.exec(value)
  if (prefixed) {
    const platform = prefixed[1]!.toLowerCase() as Platform
    return { channel: normalizeChannel(platform, prefixed[2]!), kind: "live", platform }
  }
  if (/^\w+$/.test(value)) return { channel: value.toLowerCase(), kind: "live", platform: "twitch" }
  return null
}

export const liveUrl = ({ channel, platform, url }: LiveSource) =>
  url ??
  (platform === "kick"
    ? `https://kick.com/${channel}`
    : platform === "youtube"
      ? `https://www.youtube.com/${channel}/live`
      : `https://twitch.tv/${channel}`)

export const resolveLiveVod = async (source: Source): Promise<Source> => {
  if (source.kind !== "vod" || source.platform !== "youtube") return source
  const ytdlp = Bun.spawn(
    ["yt-dlp", "--no-warnings", "--print", "%(live_status)s %(channel_handle)s", source.url],
    {
      stderr: "ignore",
      stdout: "pipe",
    },
  )
  const [status, handle] = (await new Response(ytdlp.stdout).text()).trim().split(" ")
  if (status !== "is_live") return source
  return {
    channel: handle && handle !== "NA" ? handle : source.id,
    kind: "live",
    platform: "youtube",
    url: source.url,
  }
}

export const sourceSlug = (source: Source) =>
  source.kind === "live"
    ? `${source.platform}-${source.channel.replace(/^@/, "").toLowerCase()}`
    : `${source.platform}-vod-${source.id}`
