---
name: transcribee
description: Use when asked to transcribe a YouTube/Instagram/TikTok URL, podcast, or local audio/video file; saves speaker-labeled transcripts filed by topic.
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
brew install yt-dlp ffmpeg            # macOS
pip install yt-dlp && apt install ffmpeg   # Linux
```

## Troubleshooting

| Error | Fix |
|-------|-----|
| `yt-dlp not found` | `brew install yt-dlp` / `pip install yt-dlp` |
| `ffmpeg not found` | `brew install ffmpeg` / `apt install ffmpeg` |
| `Sign in to confirm you're not a bot` (cloud servers) | Add to `~/.config/yt-dlp/config`: `--cookies-from-browser chrome`, `--js-runtimes node`, `--remote-components ejs:github` (needs a YouTube login in that browser) |
| API errors | Check `IMPOSSIBL_API_KEY` in transcribee's `.env` |
| Long files | Uploads whole up to the model's limit from Impossibl's `/v1/models` (5 GB for Scribe v2) and 10 h; chunked only past 10 h or on a 413 (speaker labels restart per chunk). Downloads are audio-only (~1 MB/min) |
