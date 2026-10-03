import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const IMPOSSIBL_API_BASE = 'https://api.impossibl.com';
export const IMPOSSIBL_ASR_MODEL = 'elevenlabs/scribe-v2';
// ElevenLabs Speech-to-Text limits: 3 GB per file, 10 h of audio (standard mode).
// Override with IMPOSSIBL_MAX_UPLOAD_MB / IMPOSSIBL_MAX_DURATION_HOURS.
export const MAX_UPLOAD_BYTES = 3 * 1024 ** 3;
export const MAX_DURATION_SECS = 10 * 60 * 60;
// Cap used to retry once if the gateway answers 413 (its old 25 MB limit, minus multipart headroom).
export const FALLBACK_MAX_UPLOAD_BYTES = 24 * 1024 * 1024;

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

export interface UploadLimits {
    maxBytes: number;
    maxDurationSecs: number;
}

interface PrepareOptions {
    maxBytes?: number;
    maxDurationSecs?: number;
    workDir?: string;
    probeDuration?: (filePath: string) => Promise<number>;
}

interface TranscribeOptions extends RequestOptions, PrepareOptions {
    fallbackMaxBytes?: number;
}

export class ImpossiblHttpError extends Error {
    constructor(message: string, readonly status: number, readonly uploadBytes: number) {
        super(message);
        this.name = 'ImpossiblHttpError';
    }
}

function positiveEnvNumber(env: NodeJS.ProcessEnv, name: string): number | undefined {
    const raw = env[name]?.trim();
    if (!raw) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number, got "${raw}"`);
    return value;
}

/**
 * Upload limits: explicit options win, then env overrides, then ElevenLabs' own limits.
 */
export function resolveUploadLimits(options: PrepareOptions = {}, env: NodeJS.ProcessEnv = process.env): UploadLimits {
    const envMb = positiveEnvNumber(env, 'IMPOSSIBL_MAX_UPLOAD_MB');
    const envHours = positiveEnvNumber(env, 'IMPOSSIBL_MAX_DURATION_HOURS');
    return {
        maxBytes: options.maxBytes ?? (envMb === undefined ? MAX_UPLOAD_BYTES : Math.floor(envMb * 1024 * 1024)),
        maxDurationSecs: options.maxDurationSecs ?? (envHours === undefined ? MAX_DURATION_SECS : envHours * 3600),
    };
}

/**
 * Seconds per chunk so every chunk is under both limits, with headroom
 * (90% of the size limit, assuming constant bitrate; 98% of the duration limit).
 */
export function chunkSecondsFor(sizeBytes: number, durationSecs: number, limits: UploadLimits): number {
    const bySize = (durationSecs * limits.maxBytes * 0.9) / sizeBytes;
    const byDuration = limits.maxDurationSecs * 0.98;
    return Math.max(1, Math.floor(Math.min(bySize, byDuration)));
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
        const hint = response.status === 413 ? " (upload exceeds the gateway's size limit)" : '';
        throw new ImpossiblHttpError(
            `Impossibl transcription failed with HTTP ${response.status}${hint}: ${body.slice(0, 300)}`,
            response.status,
            audio.length,
        );
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
    let stdout: string;
    try {
        ({ stdout } = await execFileAsync('ffprobe', [
            '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath,
        ]));
    } catch (error: any) {
        if (error.code === 'ENOENT') throw new Error('ffprobe not found. Install ffmpeg with: brew install ffmpeg');
        throw new Error(`Could not read duration of ${filePath}: ${error.message}`);
    }
    const duration = parseFloat(stdout.trim());
    if (!Number.isFinite(duration)) throw new Error(`Could not read duration of ${filePath}`);
    return duration;
}

/**
 * Return upload-ready chunks for a file. A file under both the size and duration limits
 * passes through untouched as one piece (consistent speaker labels). Over the size limit
 * it is re-encoded to mono 16 kHz 32 kbps MP3 (~14 MB/hour); if still too big, or longer
 * than the duration limit, it is split into time chunks under both limits.
 * Generated files live in workDir; caller cleans up.
 */
export async function prepareAudioForUpload(
    filePath: string,
    options: PrepareOptions = {}
): Promise<{ chunks: AudioChunk[]; workDir?: string }> {
    const limits = resolveUploadLimits(options);
    const probe = options.probeDuration || probeDuration;
    const fits = (bytes: number, secs: number) => bytes <= limits.maxBytes && secs <= limits.maxDurationSecs;

    let size = (await fs.stat(filePath)).size;
    let duration = await probe(filePath);
    if (fits(size, duration)) {
        return { chunks: [{ path: filePath, offsetSecs: 0 }] };
    }

    const workDir = options.workDir || await fs.mkdtemp(path.join(tmpdir(), 'transcribee-impossibl-'));
    let source = filePath;
    if (size > limits.maxBytes) {
        source = path.join(workDir, 'compressed.mp3');
        await runFfmpeg(['-i', filePath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', source]);
        size = (await fs.stat(source)).size;
        duration = await probe(source);
        if (fits(size, duration)) {
            return { chunks: [{ path: source, offsetSecs: 0 }], workDir };
        }
    }

    const chunkSecs = chunkSecondsFor(size, duration, limits);
    const extension = path.extname(source) || '.mp3';
    const chunks: AudioChunk[] = [];
    for (let start = 0, index = 0; start < duration; start += chunkSecs, index += 1) {
        const chunkPath = path.join(workDir, `chunk-${String(index).padStart(3, '0')}${extension}`);
        await runFfmpeg(['-ss', String(start), '-t', String(chunkSecs), '-i', source, '-vn', '-c', 'copy', chunkPath]);
        if ((await fs.stat(chunkPath)).size > limits.maxBytes) {
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

function formatMb(bytes: number): string {
    return String(Number((bytes / 1024 / 1024).toFixed(1)));
}

async function transcribePrepared(
    filePath: string,
    options: TranscribeOptions
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

/**
 * Transcribe with ElevenLabs' limits. If the gateway still answers 413 (older deploy or a
 * lower provider limit), retry once with the old re-encode/chunking under 24 MB.
 */
export async function transcribeWithImpossibl(
    filePath: string,
    options: TranscribeOptions = {}
): Promise<{ transcript: ImpossiblTranscript; chunks: number }> {
    const fallbackMaxBytes = options.fallbackMaxBytes ?? FALLBACK_MAX_UPLOAD_BYTES;
    try {
        return await transcribePrepared(filePath, options);
    } catch (error) {
        const limits = resolveUploadLimits(options);
        if (!(error instanceof ImpossiblHttpError) || error.status !== 413 || limits.maxBytes <= fallbackMaxBytes) {
            throw error;
        }
        const rejectedMb = formatMb(error.uploadBytes);
        const capMb = formatMb(fallbackMaxBytes);
        console.log(`⚠️  gateway rejected ${rejectedMb} MB upload (413); retrying with re-encode/chunking under ${capMb} MB`);
        try {
            return await transcribePrepared(filePath, { ...options, maxBytes: fallbackMaxBytes });
        } catch (retryError) {
            if (retryError instanceof ImpossiblHttpError && retryError.status === 413) {
                throw new Error(
                    `Impossibl gateway rejected the upload (413) even after re-encoding/chunking under ${capMb} MB. ` +
                    `Set IMPOSSIBL_MAX_UPLOAD_MB lower to force smaller chunks. Last error: ${retryError.message}`
                );
            }
            throw retryError;
        }
    }
}
