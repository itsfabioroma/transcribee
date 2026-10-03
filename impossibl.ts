import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const IMPOSSIBL_API_BASE = 'https://api.impossibl.com';
export const IMPOSSIBL_ASR_MODEL = 'elevenlabs/scribe-v2';
// The gateway rejects uploads over 25 MB; leave headroom for multipart overhead.
export const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;

export interface ImpossiblWord {
    text: string;
    start?: number;
    end?: number;
    type?: 'word' | 'spacing' | 'audio_event' | string;
    speaker_id?: string;
    logprob?: number;
}

// ElevenLabs' native speech-to-text JSON, passed through by the gateway.
export interface ImpossiblTranscript {
    language_code?: string;
    language_probability?: number;
    text?: string;
    words: ImpossiblWord[];
    transcription_id?: string;
    audio_duration_secs?: number;
}

export interface AudioChunk {
    path: string;
    offsetSecs: number;
}

interface RequestOptions {
    apiKey?: string;
    apiBase?: string;
    model?: string;
    language?: string;
    fetchImpl?: typeof fetch;
}

interface PrepareOptions {
    maxBytes?: number;
    workDir?: string;
}

const MIME_TYPES: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
};

/**
 * Upload one file (must already be under the size limit) and return the transcript.
 */
export async function transcribeFileWithImpossibl(
    filePath: string,
    options: RequestOptions = {}
): Promise<ImpossiblTranscript> {
    const apiKey = options.apiKey || process.env.IMPOSSIBL_API_KEY;
    if (!apiKey) throw new Error('Missing IMPOSSIBL_API_KEY in .env');

    const apiBase = (options.apiBase || process.env.IMPOSSIBL_API_BASE || IMPOSSIBL_API_BASE).replace(/\/+$/, '');
    const fetchImpl = options.fetchImpl || fetch;
    const audio = await fs.readFile(filePath);
    const mimeType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';

    // Only send fields the gateway allows; anything else is a 400.
    const form = new FormData();
    form.append('model', options.model || IMPOSSIBL_ASR_MODEL);
    form.append('file', new Blob([audio], { type: mimeType }), path.basename(filePath));
    form.append('diarize', 'true');
    form.append('tag_audio_events', 'true');
    if (options.language) form.append('language', options.language);

    const response = await fetchImpl(`${apiBase}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
    });

    const body = await response.text();
    if (!response.ok) {
        const hint = response.status === 413 ? ' (upload exceeds the 25 MB limit)' : '';
        throw new Error(`Impossibl transcription failed with HTTP ${response.status}${hint}: ${body.slice(0, 300)}`);
    }
    return JSON.parse(body) as ImpossiblTranscript;
}

async function runFfmpeg(args: string[]): Promise<void> {
    try {
        await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    } catch (error: any) {
        if (error.code === 'ENOENT') throw new Error('ffmpeg not found. Install it with: brew install ffmpeg');
        throw error;
    }
}

async function probeDuration(filePath: string): Promise<number> {
    const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath,
    ]);
    const duration = parseFloat(stdout.trim());
    if (!Number.isFinite(duration)) throw new Error(`Could not read duration of ${filePath}`);
    return duration;
}

/**
 * Return upload-ready chunks for a file. Files under the limit pass through untouched;
 * larger ones are re-encoded to mono 16 kHz 32 kbps MP3 (~14 MB/hour) and, if still
 * too big, split into time chunks. Generated files live in workDir; caller cleans up.
 */
export async function prepareAudioForUpload(
    filePath: string,
    options: PrepareOptions = {}
): Promise<{ chunks: AudioChunk[]; workDir?: string }> {
    const maxBytes = options.maxBytes ?? MAX_UPLOAD_BYTES;
    if ((await fs.stat(filePath)).size <= maxBytes) {
        return { chunks: [{ path: filePath, offsetSecs: 0 }] };
    }

    const workDir = options.workDir || await fs.mkdtemp(path.join(tmpdir(), 'transcribee-impossibl-'));
    const compressed = path.join(workDir, 'compressed.mp3');
    await runFfmpeg(['-i', filePath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', compressed]);

    const size = (await fs.stat(compressed)).size;
    if (size <= maxBytes) {
        return { chunks: [{ path: compressed, offsetSecs: 0 }], workDir };
    }

    // Constant bitrate, so size scales with duration; aim for 90% of the limit per chunk.
    const duration = await probeDuration(compressed);
    const chunkSecs = Math.max(1, Math.floor((duration * maxBytes * 0.9) / size));
    const chunks: AudioChunk[] = [];
    for (let start = 0, index = 0; start < duration; start += chunkSecs, index += 1) {
        const chunkPath = path.join(workDir, `chunk-${String(index).padStart(3, '0')}.mp3`);
        await runFfmpeg(['-ss', String(start), '-t', String(chunkSecs), '-i', compressed, '-c', 'copy', chunkPath]);
        if ((await fs.stat(chunkPath)).size > maxBytes) {
            throw new Error(`Audio chunk ${chunkPath} is still over the upload limit`);
        }
        chunks.push({ path: chunkPath, offsetSecs: start });
    }
    return { chunks, workDir };
}

/**
 * Concatenate per-chunk transcripts, shifting word timings by each chunk's start.
 * Speaker ids are kept as returned: the same id in two chunks may be different people.
 */
export function mergeChunkTranscripts(
    parts: Array<{ offsetSecs: number; transcript: ImpossiblTranscript }>
): ImpossiblTranscript {
    if (parts.length === 1 && parts[0].offsetSecs === 0) return parts[0].transcript;

    const first = parts[0]?.transcript;
    return {
        language_code: first?.language_code,
        language_probability: first?.language_probability,
        text: parts.map(part => part.transcript.text?.trim() || '').filter(Boolean).join(' '),
        words: parts.flatMap(({ offsetSecs, transcript }) =>
            transcript.words.map(word => ({
                ...word,
                start: word.start === undefined ? undefined : word.start + offsetSecs,
                end: word.end === undefined ? undefined : word.end + offsetSecs,
            }))
        ),
        transcription_id: parts.map(part => part.transcript.transcription_id).filter(Boolean).join(','),
        audio_duration_secs: parts.reduce((total, part) => total + (part.transcript.audio_duration_secs || 0), 0),
    };
}

export async function transcribeWithImpossibl(
    filePath: string,
    options: RequestOptions & PrepareOptions = {}
): Promise<{ transcript: ImpossiblTranscript; chunks: number }> {
    const { chunks, workDir } = await prepareAudioForUpload(filePath, options);
    try {
        if (chunks.length > 1) console.log(`✂️  Audio over upload limit; transcribing in ${chunks.length} chunks`);
        const parts = [];
        for (const chunk of chunks) {
            parts.push({ offsetSecs: chunk.offsetSecs, transcript: await transcribeFileWithImpossibl(chunk.path, options) });
        }
        return { transcript: mergeChunkTranscripts(parts), chunks: chunks.length };
    } finally {
        if (workDir && !options.workDir) await fs.rm(workDir, { recursive: true, force: true });
    }
}
