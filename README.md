# transcribee 🐝

**Open source macOS transcriber for YouTube, Instagram Reels, TikTok, and local media — evolves a self-organizing knowledge base.**

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

Make sure you have the dependencies installed (`brew install yt-dlp ffmpeg`) and API keys configured.

## Quick Start 🪺

```bash
# Install dependencies (macOS)
brew install yt-dlp ffmpeg
pnpm install

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

### Shell alias (recommended)

Add to `~/.zshrc`:

```bash
alias transcribee="noglob /path/to/transcribee/transcribe.sh"
```

## Output 🍯

Each transcript saves to `~/Documents/transcripts/{category}/{title}/`:

| File | What it's for |
|------|---------------|
| `transcript.txt` | Speaker-labeled transcript — **paste this into your LLM** |
| `metadata.json` | Video info, language, auto-detected theme |

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
those and says so. Override the classification model with `ANTHROPIC_MODEL`.

Impossibl uploads are capped at 25 MB. Bigger files are re-encoded to mono 16 kHz 32 kbps
MP3 (about 14 MB per hour), and anything over ~1h40m is split into chunks that are
transcribed separately and merged. Speaker labels restart in each chunk, so `speaker_0`
in one chunk may not be the same person as `speaker_0` in the next.

Atlas Cloud (`ASR_PROVIDER=atlascloud`, `ATLASCLOUD_API_KEY`) accepts MP3, WAV, OGG, and raw
audio; anything else is converted to MP3 automatically.

## How it works 🐝

1. Downloads audio from YouTube (yt-dlp) or extracts from local video (ffmpeg)
2. Transcribes with ElevenLabs Scribe v2 via Impossibl (speaker diarization), chunking files over 25 MB
3. Claude Haiku (via Impossibl) analyzes content and existing library structure
4. Auto-categorizes into the right folder
5. Saves transcript files with metadata

## Requirements

- macOS (tested on Sonoma)
- Node.js 18+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — `brew install yt-dlp`
- [ffmpeg](https://ffmpeg.org/) — `brew install ffmpeg`
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
