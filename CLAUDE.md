# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A video transcription system that downloads audio from YouTube, Instagram Reels, TikTok, and local files, transcribes it (ElevenLabs Scribe v2 via the Impossibl gateway by default), and automatically categorizes transcripts into a knowledge library using Claude (also via Impossibl).

## Quick Start

```bash
# Install dependencies
pnpm install

# Setup environment variables
cp .env.example .env
# Edit .env and add IMPOSSIBL_API_KEY (used for both speech-to-text and classification).
# Optional fallbacks: ELEVEN_LABS_API_KEY, ANTHROPIC_API_KEY, ATLASCLOUD_API_KEY

# Transcribe a YouTube video
pnpm exec tsx index.ts "https://www.youtube.com/watch?v=..."

# Or use the convenience wrapper script
./transcribe.sh "https://www.youtube.com/watch?v=..."
```

## System Dependencies

This project requires `yt-dlp` to be installed on the system:
- macOS: `brew install yt-dlp`
- Linux: `pip install yt-dlp`
- Windows: `winget install yt-dlp`

## Architecture

### Core Workflow (index.ts)

The main script follows this pipeline:

1. **Video Metadata Extraction** (`getVideoTitle`): Uses yt-dlp to extract and sanitize the video title
2. **Audio Download** (`downloadAudio`): yt-dlp with `-f bestaudio[ext=m4a]/bestaudio/best`, so only the audio stream is fetched (m4a is a remux). No forced `player_client`: `android,web` plus cookies left only combined format 18 (video). Cloud boxes need `~/.config/yt-dlp/config` with `--cookies-from-browser chrome --js-runtimes node --remote-components ejs:github`
3. **Transcription** (`transcribeAudio`): Provider picked by `providers.ts` (`ASR_PROVIDER`, default `impossibl`). `impossibl.ts` posts multipart to `/v1/audio/transcriptions` with `elevenlabs/scribe-v2` + diarization; the size limit is the model's `max_file_size_bytes` from `GET /v1/models` (5 GB for Scribe v2; fetched once per run, 10 s timeout, one retry, 25 MB if unavailable), and duration is capped at 10 h. Env `IMPOSSIBL_MAX_UPLOAD_MB` / `IMPOSSIBL_MAX_DURATION_HOURS` override; `IMPOSSIBL_ASR_MODEL` picks the model. Files under both upload whole. Longer audio is split into time chunks whose word timings are offset and merged; a 413 retries once with the old re-encode (mono 16 kHz 32 kbps) + chunking under 24 MB. `elevenlabs` (direct SDK) and `atlascloud.ts` remain opt-in
4. **Library Structure Analysis** (`readLibraryStructure`): Reads existing transcript library from `~/Documents/transcripts/` as a flat folder structure
5. **Category Classification** (`classifyAndOrganize`): Uses Claude (via Impossibl's Anthropic-compatible API by default, `LLM_PROVIDER=anthropic` for direct) to decide which single-level category folder to place it in
6. **Output Generation**: Saves per transcript:
   - `transcript.txt`: Formatted with speaker labels
   - `metadata.json`: Source info, theme classification, transcription provider/model
   - `transcript-raw.json`: Full provider response with word timings (only with `--raw`)

### Transcript Organization System

The system maintains a knowledge library at `~/Documents/transcripts/`:

- **Folder Structure**: Single-level categories, kebab-case naming (e.g., `ai-podcasts/video-title-2025-10-21/`)
- **Metadata Tracking**: Each transcript folder contains `metadata.json` with theme classification and summary
- **Category Reuse**: Claude analyzes existing categories and reuses them when semantically appropriate

### Key Functions

- `wordsToTranscript(words: Word[]): string` - Converts word-level timestamps into speaker-labeled dialogue format
- `truncateTranscript(text: string, maxTokens: number): string` - Intelligently samples beginning/middle/end of long transcripts to fit token limits
- `folderTreeToString(node: FolderNode): string` - Converts library structure into compact string representation for Claude

### TypeScript Interfaces

The codebase uses strong typing throughout:

- `Word`: Individual transcribed word with timing and speaker info
- `ThemeClassification`: AI-determined topic categories and confidence
- `TranscriptMetadata`: Video metadata and theme classification
- `FolderNode`: Recursive tree structure for library representation
- `OrganizationPlan`: Claude's decision on which category to use

## Claude AI Integration

Classification uses `@anthropic-ai/sdk`; with Impossibl it sets `baseURL: https://api.impossibl.com` (no `/v1`). Default model: `anthropic/claude-haiku-4-5` via Impossibl, `claude-sonnet-5` direct; `ANTHROPIC_MODEL` overrides (`getClassificationModel` in `classification.ts`).

- **Token Management**: Estimates ~4 chars per token, truncates transcripts to 150K tokens max using beginning/middle/end sampling
- **Context-Aware**: Provides Claude with full library structure to reuse existing categories when appropriate
- **Confidence Tracking**: Returns high/medium/low confidence levels for category decisions

## Output Location

All transcripts are saved to: `~/Documents/transcripts/{category}/{video-title-YYYY-MM-DD}/`

## Development Notes

- The project uses `tsx` for direct TypeScript execution without compilation
- Uses `pnpm` as package manager (v10.10.0)
- All file operations use Node's `fs.promises` API
- Tests: `npx tsx --test *.test.ts tests/*.test.ts`
- Impossibl upload size comes from `/v1/models` (5 GB for Scribe v2), duration 10 h; chunking is a fallback (>10 h or gateway 413) and speaker ids restart per chunk
- Temporary audio files stored in OS tmpdir and cleaned up after processing
