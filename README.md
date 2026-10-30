# Stream-clipper

Built on top of [ZeroStarter](https://zerostarter.dev).

## Development

```bash
bun run dev
```

This serves named `.localhost` dev URLs via portless (`bunx portless list` shows them); `PORTLESS=0 bun run dev` uses fixed ports instead (web `:3000`, api `:4000`).

## Clipper

Records a live Twitch stream, watches its chat, and saves a clip whenever chat suddenly gets much busier than normal. Each clip is rated and titled by AI.

Needs `ffmpeg` and `streamlink` (`brew install ffmpeg streamlink`), plus a logged-in `claude` CLI for AI ratings.

```bash
bun run clip <twitch-channel>
```

Clips land in `clips/<channel>/<time>/` as `clip.mp4` plus `meta.json` (chat during the clip, AI score, title). Run `bun run clip` with no channel to see every option, such as `--ai ollama`, `--ai none`, or `--multiplier` to make it more or less sensitive.
