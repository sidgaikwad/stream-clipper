# Stream-clipper

Built on top of [ZeroStarter](https://zerostarter.dev).

## Development

```bash
bun run dev
```

This serves named `.localhost` dev URLs via portless (`bunx portless list` shows them); `PORTLESS=0 bun run dev` uses fixed ports instead (web `:3000`, api `:4000`).

## Clipper

Finds hype moments in Twitch, Kick, and YouTube streams and saves each one as a clip, rated and titled by AI. It works on live streams and on past broadcasts (VODs).

Needs `ffmpeg`, `streamlink`, and `yt-dlp` (`brew install ffmpeg streamlink yt-dlp`), plus a logged-in `claude` CLI for AI ratings.

```bash
bun run clip xqc kick:xqc youtube:@IShowSpeed
bun run clip "https://www.youtube.com/watch?v=..." --section 1:00:00-1:30:00
```

| Source                               | How moments are found             |
| ------------------------------------ | --------------------------------- |
| Twitch live (`xqc`, `twitch:xqc`)    | chat spikes                       |
| Kick live (`kick:xqc`)               | audio spikes (no chat reader yet) |
| YouTube live (`youtube:@handle`)     | chat spikes                       |
| YouTube VOD (`watch?v=` link)        | chat replay spikes                |
| Twitch or Kick VOD (`/videos/` link) | audio spikes                      |

Several live channels can run at once. A VOD is downloaded at up to 720p, scanned, and cut into its best `--max-clips` moments (default 10); the download is deleted afterwards unless you pass `--keep`.

Clips land in `clips/<platform>-<channel>/<time>/` (VODs: `clips/<platform>-vod-<id>/<hh-mm-ss>/`) as `clip.mp4` plus `meta.json` (chat during the clip, the spike, AI score, title). AI rating needs chat, so audio-only clips are saved unrated. Run `bun run clip` with no source to see every option, such as `--ai ollama`, `--ai none`, `--multiplier`, or `--audio-threshold` to make detection more or less sensitive.
