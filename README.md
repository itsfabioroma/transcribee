# transcribee 🐝

Extract high-quality transcripts from YouTube videos and local media files to use as context for LLM conversations.

## Why 🍯

LLMs can analyze, summarize, and answer questions about video content - but they need text input. This tool bridges that gap by converting audio/video into clean, speaker-labeled transcripts ready to paste into ChatGPT, Claude, or any other LLM.

**Use cases:**
- 🐝 Chat with podcast episodes, interviews, lectures
- 🐝 Summarize long videos without watching them
- 🐝 Search and reference specific parts of video content
- 🐝 Build a personal knowledge base from video content

## Features 🪻

- Transcribes YouTube videos and local audio/video files
- Speaker diarization (identifies different speakers)
- Auto-categorizes transcripts into a knowledge library using Claude
- Outputs raw text, formatted transcript with speaker labels, and metadata

## Requirements

- Node.js 18+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) for YouTube downloads
- [ffmpeg](https://ffmpeg.org/) for local video files
- ElevenLabs API key (speech-to-text)
- Anthropic API key (categorization)

```bash
# macOS
brew install yt-dlp ffmpeg
```

## Setup 🪺

```bash
pnpm install
cp .env.example .env
# Add your API keys to .env
```

### Shell alias (optional)

Add to `~/.zshrc` for quick access:

```bash
alias transcribee="noglob /path/to/transcribee/transcribe.sh"
```

## Usage 🌸

```bash
# YouTube video
transcribee "https://www.youtube.com/watch?v=..."

# Local video file
transcribee ~/Videos/interview.mp4

# Local audio file
transcribee ~/Downloads/podcast.mp3

# Without alias
pnpm exec tsx index.ts "https://www.youtube.com/watch?v=..."
```

## Output 🍯

Transcripts are saved to `~/Documents/transcripts/{category}/{title}-{date}/`:

| File | Description |
|------|-------------|
| `transcription.txt` | Formatted with speaker labels - **paste this into your LLM** |
| `transcription-raw.txt` | Raw text without speaker labels |
| `transcription-raw.json` | Full API response with word-level timings |
| `metadata.json` | Video info, detected language, theme classification |

## How it works 🐝

1. Downloads audio from YouTube (yt-dlp) or extracts from local video (ffmpeg)
2. Transcribes via ElevenLabs `scribe_v1_experimental` model with speaker diarization
3. Analyzes existing library structure
4. Claude classifies content into appropriate category folder
5. Saves transcript files with metadata

## Supported formats

| Type | Formats |
|------|---------|
| Audio | mp3, m4a, wav, ogg, flac |
| Video | mp4, mkv, webm, mov, avi |

---

*bzz bzz* 🐝
