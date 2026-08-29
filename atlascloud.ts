import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_API_BASE = 'https://api.atlascloud.ai/api/v1';
const DEFAULT_MODEL = 'bytedance/seed-asr-2.0';

export interface AtlasCloudWord {
    text: string;
    start?: number;
    end?: number;
    type?: string;
    speaker_id?: string;
}

interface AtlasCloudPrediction {
    id?: string;
    status?: string;
    outputs?: string[];
    stt_result?: {
        text?: string;
        duration?: number;
        words?: AtlasCloudWord[];
    };
}

export interface AtlasCloudTranscript {
    language_code?: string;
    language_probability?: number;
    words: AtlasCloudWord[];
    provider: 'atlascloud';
    model: string;
    prediction: AtlasCloudPrediction;
}

interface TranscribeOptions {
    apiKey?: string;
    apiBase?: string;
    model?: string;
    pollIntervalMs?: number;
    maxPollAttempts?: number;
    fetchImpl?: typeof fetch;
}

export function normalizeAtlasCloudApiBase(value?: string): string {
    const base = (value || DEFAULT_API_BASE).replace(/\/+$/, '');
    if (base.endsWith('/api/v1')) return base;
    if (base.endsWith('/v1')) return `${base.slice(0, -3)}/api/v1`;
    return `${base}/api/v1`;
}

export function atlasAudioFormat(filePath: string): 'mp3' | 'wav' | 'ogg' | 'raw' {
    const extension = path.extname(filePath).slice(1).toLowerCase();
    if (extension === 'mp3' || extension === 'wav' || extension === 'ogg' || extension === 'raw') {
        return extension;
    }
    throw new Error(
        `Atlas Cloud ASR supports mp3, wav, ogg, and raw audio; received .${extension || 'unknown'}`
    );
}

function predictionFromResponse(value: unknown): AtlasCloudPrediction {
    if (!value || typeof value !== 'object') return {};
    const envelope = value as { data?: unknown };
    const prediction = envelope.data && typeof envelope.data === 'object' ? envelope.data : value;
    return prediction as AtlasCloudPrediction;
}

async function responseJson(response: Response, action: string): Promise<unknown> {
    const body = await response.text();
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        parsed = body;
    }

    if (!response.ok) {
        throw new Error(`Atlas Cloud ${action} failed with HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
    return parsed;
}

function wait(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export async function transcribeWithAtlasCloud(
    filePath: string,
    options: TranscribeOptions = {}
): Promise<AtlasCloudTranscript> {
    const apiKey = options.apiKey || process.env.ATLASCLOUD_API_KEY;
    if (!apiKey) throw new Error('Missing ATLASCLOUD_API_KEY in .env');

    const apiBase = normalizeAtlasCloudApiBase(options.apiBase || process.env.ATLASCLOUD_API_BASE);
    const model = options.model || process.env.ATLASCLOUD_ASR_MODEL || DEFAULT_MODEL;
    const pollIntervalMs = options.pollIntervalMs ?? 5000;
    const maxPollAttempts = options.maxPollAttempts ?? 120;
    const fetchImpl = options.fetchImpl || fetch;
    const audio = await fs.readFile(filePath);

    // Generation is submitted exactly once. Only subsequent status reads are retried.
    const createResponse = await fetchImpl(`${apiBase}/model/generateAudio`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            audio_url: audio.toString('base64'),
            format: atlasAudioFormat(filePath),
            enable_itn: true,
            enable_punc: true,
            enable_speaker_info: true,
            show_utterances: true,
        }),
    });
    let prediction = predictionFromResponse(await responseJson(createResponse, 'submission'));

    if (!prediction.id && prediction.status !== 'completed') {
        throw new Error('Atlas Cloud submission did not return a prediction id');
    }

    let lastReadError: unknown;
    for (let attempt = 0; prediction.status !== 'completed' && attempt < maxPollAttempts; attempt += 1) {
        if (prediction.status === 'failed') {
            throw new Error(`Atlas Cloud prediction ${prediction.id} failed`);
        }
        await wait(pollIntervalMs);
        try {
            const resultResponse = await fetchImpl(`${apiBase}/model/prediction/${prediction.id}`, {
                headers: { Authorization: `Bearer ${apiKey}` },
            });
            prediction = predictionFromResponse(await responseJson(resultResponse, 'status read'));
            lastReadError = undefined;
        } catch (error) {
            lastReadError = error;
        }
    }

    if (prediction.status !== 'completed') {
        const detail = lastReadError instanceof Error ? `: ${lastReadError.message}` : '';
        throw new Error(`Atlas Cloud prediction ${prediction.id} did not complete${detail}`);
    }

    const text = prediction.stt_result?.text || prediction.outputs?.[0] || '';
    const words = prediction.stt_result?.words?.length
        ? prediction.stt_result.words
        : text
            ? [{ text, start: 0, end: prediction.stt_result?.duration || 0, type: 'utterance', speaker_id: 'speaker_0' }]
            : [];

    return {
        words,
        provider: 'atlascloud',
        model,
        prediction,
    };
}
