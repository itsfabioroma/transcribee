# transcribee 🐝

**Open source transcriber (macOS and Linux) for YouTube, Instagram Reels, TikTok, and local media — evolves a self-organizing knowledge base.**

```bash
transcribee "https://youtube.com/watch?v=..."
transcribee "https://instagram.com/reel/..."
transcribee "https://vt.tiktok.com/..."
transcribee ~/Downloads/podcast.mp3
```

Over time, your `~/Documents/transcripts/` folder naturally evolves into a personal library:

```
transcripts/
├── AI-Research/
│   ├── ilya-sutskever-agi-2024/
│   └── anthropic-constitutional-ai/
├── Startups/
│   ├── ycombinator-how-to-get-users/
│   └── pmarca-founder-mode/
└── Health/
    └── huberman-sleep-optimization/
```

Each transcript is speaker-labeled and ready to paste into ChatGPT, Claude, or any LLM.

## Why 🍯

I consume a lot of video content — YouTube, Instagram, TikTok, podcasts, interviews. I wanted to:
- Ask questions about videos in LLMs
- Have all that knowledge searchable and organized
- Not do any manual work to maintain it

transcribee does exactly that. Transcribe once, knowledge stays forever.

## Features 🪻

- **Transcribes** YouTube, Instagram Reels, TikTok, and local audio/video files
- **Audio-only downloads** — grabs just the audio stream (~1 MB/min), never the video
- **Long files in one piece** — up to 5 GB / 10 h per upload, so normal podcasts aren't chunked
- **Speaker diarization** — identifies different speakers
- **Auto-categorizes** transcripts using Claude based on content
- **Builds a knowledge library** that organizes itself over time

## Use with OpenClaw 🤖

transcribee is available as an [OpenClaw](https://github.com/openclaw/openclaw) skill. Just ask your agent to transcribe any YouTube video:

> "Transcribe this video: https://youtube.com/watch?v=..."

### Install the skill

```bash
# Install from ClawHub (recommended)
openclaw skills install transcribee

# Or clone manually
git clone https://github.com/itsfabioroma/transcribee.git ~/.openclaw/workspace/skills/transcribee
```

Make sure you have the dependencies installed (see Quick Start) and `IMPOSSIBL_API_KEY` configured.

## Quick Start 🪺

```bash
# Install dependencies
brew install yt-dlp ffmpeg                    # macOS
pip install yt-dlp && sudo apt install ffmpeg  # Linux
pnpm install                                   # or: npm install


# Configure API keys
cp .env.example .env
# Add your IMPOSSIBL_API_KEY to .env (one key for both steps)

# Transcribe anything
transcribee "https://youtube.com/watch?v=..."
transcribee "https://instagram.com/reel/..."
transcribee "https://vt.tiktok.com/..."
transcribee ~/Downloads/podcast.mp3
transcribee ~/Videos/interview.mp4
```

No pnpm? `npx tsx index.ts "<url|file>"` works too.

### Shell alias (recommended)

Add to `~/.zshrc` (or symlink `transcribe.sh` onto your `PATH`):

```bash
alias transcribee="noglob /path/to/transcribee/transcribe.sh"
```

### "Sign in to confirm you're not a bot" (cloud servers) 🤖

YouTube blocks most datacenter IPs. Add these lines to `~/.config/yt-dlp/config`; they need a
browser on that machine that is logged in to YouTube:

```
--cookies-from-browser chrome
--js-runtimes node
--remote-components ejs:github
```

## Output 🍯

Each transcript saves to `~/Documents/transcripts/{category}/{title}-{YYYY-MM-DD}/`:

| File | What it's for |
|------|---------------|
| `transcript.txt` | Speaker-labeled transcript — **paste this into your LLM** |
| `metadata.json` | Source info, language, auto-detected theme, transcription provider/model |

### Raw JSON (optional)

For power users who need word-level timestamps and confidence scores:

```bash
transcribee --raw "https://youtube.com/watch?v=..."
```

This adds `transcript-raw.json` with the full transcription-provider response.

## Providers

| Step | Default | Opt-in alternatives |
|------|---------|---------------------|
| Transcription (`ASR_PROVIDER`) | `impossibl`: ElevenLabs Scribe v2, $0.22/audio hour | `elevenlabs` (direct), `atlascloud` |
| Classification (`LLM_PROVIDER`) | `impossibl`: `anthropic/claude-haiku-4-5` | `anthropic` (direct, `claude-sonnet-5`) |

[Impossibl](https://impossibl.com) is one key (`IMPOSSIBL_API_KEY`) for both steps. If it's
missing but `ELEVEN_LABS_API_KEY` / `ANTHROPIC_API_KEY` are set, transcribee falls back to
those and says so.

**Upload limits.** Before uploading, transcribee reads the model's `max_file_size_bytes` from
Impossibl's `GET /v1/models` (5 GB for ElevenLabs Scribe v2). ElevenLabs also caps audio at 10 h
per file. Anything under both goes up whole, so a normal podcast is never chunked. If
`/v1/models` can't be read, transcribee logs it and assumes a safe 25 MB.

**Chunking is a fallback only**: audio over 10 h, or a 413 from the gateway, which triggers one
retry with the file re-encoded to mono 16 kHz 32 kbps MP3 and split under 24 MB. Speaker labels
restart in each chunk, so `speaker_0` in one chunk may not be the next chunk's `speaker_0`.

Atlas Cloud accepts MP3, WAV, OGG, and raw audio; anything else is converted to MP3 automatically.

### Environment variables

| Variable | Default | What it does |
|----------|---------|--------------|
| `IMPOSSIBL_API_KEY` | — | **Required.** Transcription + classification |
| `ASR_PROVIDER` | `impossibl` | `impossibl`, `elevenlabs`, or `atlascloud` |
| `LLM_PROVIDER` | `impossibl` | `impossibl` or `anthropic` |
| `ANTHROPIC_MODEL` | `anthropic/claude-haiku-4-5` | Classification model (`claude-sonnet-5` when direct) |
| `IMPOSSIBL_ASR_MODEL` | `elevenlabs/scribe-v2` | Transcription model on Impossibl |
| `IMPOSSIBL_MAX_UPLOAD_MB` | from `/v1/models` | Force a smaller upload cap (forces re-encode/chunking) |
| `IMPOSSIBL_MAX_DURATION_HOURS` | `10` | Max audio length per upload before chunking |
| `ASR_LANGUAGE` | auto | Language code, e.g. `en` |
| `ELEVEN_LABS_API_KEY`, `ANTHROPIC_API_KEY`, `ATLASCLOUD_API_KEY` | — | Fallback / direct providers |

## How it works 🐝

1. Downloads the audio-only stream with yt-dlp (or extracts audio from local video with ffmpeg)
2. Transcribes with ElevenLabs Scribe v2 via Impossibl (speaker diarization), whole files up to 5 GB / 10 h
3. Claude Haiku (via Impossibl) analyzes content and existing library structure
4. Auto-categorizes into the right folder
5. Saves transcript files with metadata

## Requirements

- macOS (tested on Sonoma) or Linux (tested on Ubuntu)
- Node.js 18+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — `brew install yt-dlp` / `pip install yt-dlp`
- [ffmpeg](https://ffmpeg.org/) — `brew install ffmpeg` / `apt install ffmpeg`
- [Impossibl API key](https://impossibl.com) — transcription + auto-categorization
- Optional: ElevenLabs, Anthropic, or Atlas Cloud keys to use those providers directly

## Supported formats

| Type | Formats |
|------|---------|
| Audio | mp3, m4a, wav, ogg, flac |
| Video | mp4, mkv, webm, mov, avi |
| URLs | youtube.com, youtu.be, instagram.com/reel, tiktok.com |

---

*bzz bzz* 🐝
