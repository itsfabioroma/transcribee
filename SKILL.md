---
name: transcribee
description: Transcribe YouTube videos and local audio/video files with speaker diarization. Use when user asks to transcribe a YouTube URL, podcast, video, or audio file. Outputs clean speaker-labeled transcripts ready for LLM analysis.
---

# Transcribee

Transcribe YouTube videos and local media files with speaker diarization (ElevenLabs Scribe v2 via the Impossibl gateway; Claude Haiku picks the category). Needs `IMPOSSIBL_API_KEY` in `.env`.

## Usage

```bash
# YouTube video
transcribee "https://www.youtube.com/watch?v=..."

# Local video
transcribee ~/path/to/video.mp4

# Local audio
transcribee ~/path/to/podcast.mp3
```

**Always quote URLs** containing `&` or special characters.

## Output

Transcripts save to: `~/Documents/transcripts/{category}/{title}-{date}/`

| File | Use |
|------|-----|
| `transcript.txt` | Speaker-labeled transcript |
| `metadata.json` | Video info, language, category, provider |
| `transcript-raw.json` | Word-level timings (only with `--raw`) |

## Supported Formats

- **Audio:** mp3, m4a, wav, ogg, flac
- **Video:** mp4, mkv, webm, mov, avi
- **URLs:** youtube.com, youtu.be

## Dependencies

```bash
brew install yt-dlp ffmpeg
```

## Troubleshooting

| Error | Fix |
|-------|-----|
| `yt-dlp not found` | `brew install yt-dlp` |
| `ffmpeg not found` | `brew install ffmpeg` |
| API errors | Check `IMPOSSIBL_API_KEY` in transcribee's `.env` |
| Long files | Over 25 MB is auto-compressed/chunked; speaker labels restart per chunk |
