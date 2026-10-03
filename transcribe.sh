#!/usr/bin/env bash
# transcribee: transcribe YouTube/Instagram/TikTok URLs or local media
# Usage: transcribee "<url|file>" [--raw]
set -euo pipefail
if [ $# -eq 0 ] || [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    echo 'Usage: transcribee "<url|audio-file|video-file>" [--raw]' >&2
    echo 'Quote URLs containing & or other special characters.' >&2
    [ $# -eq 0 ] && exit 2 || exit 0
fi
cd "$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
exec npx --no-install tsx index.ts "$@"
