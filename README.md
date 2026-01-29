# transcribee 🐝

**Open source macOS YouTube video transcriber that evolves a self-organizing knowledge base.**

```bash
transcribee "https://youtube.com/watch?v=..."
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

I watch a lot of YouTube — podcasts, technical talks, interviews. I wanted to:
- Ask questions about videos in LLMs
- Have all that knowledge searchable and organized
- Not do any manual work to maintain it

transcribee does exactly that. Transcribe once, knowledge stays forever.

## Features 🪻

- **Transcribes** YouTube videos and local audio/video files
- **Speaker diarization** — identifies different speakers
- **Auto-categorizes** transcripts using Claude based on content
- **Builds a knowledge library** that organizes itself over time

## Quick Start 🪺

```bash
# Install dependencies (macOS)
brew install yt-dlp ffmpeg
pnpm install

# Configure API keys
cp .env.example .env
# Add your ElevenLabs + Anthropic API keys to .env

# Transcribe anything
transcribee "https://youtube.com/watch?v=..."
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
| `transcription.txt` | Speaker-labeled transcript — **paste this into your LLM** |
| `transcription-raw.txt` | Plain text without speaker labels |
| `transcription-raw.json` | Word-level timings for precise references |
| `metadata.json` | Video info, language, auto-detected theme |

## How it works 🐝

1. Downloads audio from YouTube (yt-dlp) or extracts from local video (ffmpeg)
2. Transcribes with ElevenLabs (`scribe_v1_experimental` with speaker diarization)
3. Claude analyzes content and existing library structure
4. Auto-categorizes into the right folder
5. Saves transcript files with metadata

## Requirements

- macOS (tested on Sonoma)
- Node.js 18+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — `brew install yt-dlp`
- [ffmpeg](https://ffmpeg.org/) — `brew install ffmpeg`
- [ElevenLabs API key](https://elevenlabs.io/) — for transcription
- [Anthropic API key](https://anthropic.com/) — for auto-categorization

## Supported formats

| Type | Formats |
|------|---------|
| Audio | mp3, m4a, wav, ogg, flac |
| Video | mp4, mkv, webm, mov, avi |
| URLs | youtube.com, youtu.be |

---

*bzz bzz* 🐝
