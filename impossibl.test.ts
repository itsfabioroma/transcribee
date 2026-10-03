import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    mergeChunkTranscripts,
    prepareAudioForUpload,
    transcribeFileWithImpossibl,
    transcribeWithImpossibl,
} from './impossibl';

async function sampleAudio(name = 'sample.m4a'): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), 'transcribee-impossibl-'));
    const audioPath = path.join(directory, name);
    await writeFile(audioPath, Buffer.from('audio'));
    return audioPath;
}

function ok(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200 });
}

test('posts a multipart request with only allowed fields', async () => {
    const audioPath = await sampleAudio();
    let captured: { url: string; init?: RequestInit } | undefined;
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
        captured = { url: input.toString(), init };
        return ok({ language_code: 'eng', text: 'hi', words: [{ text: 'hi', start: 0, end: 0.5, type: 'word', speaker_id: 'speaker_0' }] });
    };

    const transcript = await transcribeFileWithImpossibl(audioPath, {
        apiKey: 'test-key',
        apiBase: 'https://api.impossibl.com/',
        language: 'en',
        fetchImpl: fetchImpl as typeof fetch,
    });

    assert.equal(captured?.url, 'https://api.impossibl.com/v1/audio/transcriptions');
    assert.equal(captured?.init?.method, 'POST');
    assert.deepEqual(captured?.init?.headers, { Authorization: 'Bearer test-key' });
    const form = captured?.init?.body as FormData;
    assert.deepEqual([...form.keys()].sort(), ['diarize', 'file', 'language', 'model', 'tag_audio_events']);
    assert.equal(form.get('model'), 'elevenlabs/scribe-v2');
    assert.equal(form.get('diarize'), 'true');
    assert.equal(form.get('language'), 'en');
    assert.equal((form.get('file') as File).name, 'sample.m4a');
    assert.equal(transcript.words[0].speaker_id, 'speaker_0');
});

test('omits language when not set', async () => {
    const audioPath = await sampleAudio();
    let form: FormData | undefined;
    const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
        form = init?.body as FormData;
        return ok({ words: [] });
    };
    await transcribeFileWithImpossibl(audioPath, { apiKey: 'k', fetchImpl: fetchImpl as typeof fetch });
    assert.equal(form?.has('language'), false);
    assert.equal(form?.has('language_code'), false);
});

test('surfaces 400 and 413 errors with the response body', async () => {
    const audioPath = await sampleAudio();
    for (const [status, pattern] of [
        [400, /HTTP 400: \{"error":"unknown field foo"\}/],
        [413, /HTTP 413 \(upload exceeds the 25 MB limit\)/],
    ] as const) {
        const fetchImpl = async () => new Response('{"error":"unknown field foo"}', { status });
        await assert.rejects(
            transcribeFileWithImpossibl(audioPath, { apiKey: 'k', fetchImpl: fetchImpl as typeof fetch }),
            pattern,
        );
    }
});

test('requires an API key', async () => {
    const audioPath = await sampleAudio();
    const previous = process.env.IMPOSSIBL_API_KEY;
    delete process.env.IMPOSSIBL_API_KEY;
    try {
        await assert.rejects(transcribeFileWithImpossibl(audioPath), /Missing IMPOSSIBL_API_KEY/);
    } finally {
        if (previous !== undefined) process.env.IMPOSSIBL_API_KEY = previous;
    }
});

test('merges chunk transcripts by offsetting word timings', () => {
    const merged = mergeChunkTranscripts([
        {
            offsetSecs: 0,
            transcript: {
                language_code: 'eng', language_probability: 0.9, text: 'hello', transcription_id: 'a', audio_duration_secs: 600,
                words: [{ text: 'hello', start: 1, end: 1.5, type: 'word', speaker_id: 'speaker_0' }],
            },
        },
        {
            offsetSecs: 600,
            transcript: {
                language_code: 'eng', text: 'world', transcription_id: 'b', audio_duration_secs: 30,
                words: [
                    { text: ' ', start: 1.5, end: 2, type: 'spacing', speaker_id: 'speaker_0' },
                    { text: 'world', start: 2, end: 2.5, type: 'word', speaker_id: 'speaker_1' },
                ],
            },
        },
    ]);

    assert.equal(merged.language_code, 'eng');
    assert.equal(merged.text, 'hello world');
    assert.equal(merged.transcription_id, 'a,b');
    assert.equal(merged.audio_duration_secs, 630);
    assert.deepEqual(merged.words.map(word => [word.text, word.start, word.end, word.speaker_id]), [
        ['hello', 1, 1.5, 'speaker_0'],
        [' ', 601.5, 602, 'speaker_0'],
        ['world', 602, 602.5, 'speaker_1'],
    ]);
});

test('a single unshifted chunk is returned unchanged', () => {
    const transcript = { text: 'x', words: [{ text: 'x', start: 0, end: 1 }] };
    assert.equal(mergeChunkTranscripts([{ offsetSecs: 0, transcript }]), transcript);
});

const hasFfmpeg = (() => {
    try {
        execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
})();

test('splits oversized audio into chunks under the limit and merges offsets', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'transcribee-impossibl-'));
    const source = path.join(directory, 'tone.wav');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60', '-ar', '44100', source]);

    // 60 s at 32 kbps is ~240 KB; a 100 KB limit forces three chunks.
    const maxBytes = 100 * 1024;
    const { chunks } = await prepareAudioForUpload(source, { maxBytes, workDir: directory });
    assert.ok(chunks.length >= 3, `expected >= 3 chunks, got ${chunks.length}`);
    assert.equal(chunks[0].offsetSecs, 0);
    for (const chunk of chunks) assert.ok((await stat(chunk.path)).size <= maxBytes);

    const offsets: number[] = [];
    const fetchImpl = async () => ok({ text: 't', words: [{ text: 't', start: 1, end: 2, type: 'word', speaker_id: 'speaker_0' }] });
    const { transcript, chunks: count } = await transcribeWithImpossibl(source, {
        apiKey: 'k', maxBytes, fetchImpl: fetchImpl as typeof fetch,
    });
    for (const word of transcript.words) offsets.push((word.start ?? 0) - 1);
    assert.equal(count, chunks.length);
    assert.deepEqual(offsets, chunks.map(chunk => chunk.offsetSecs));
});
