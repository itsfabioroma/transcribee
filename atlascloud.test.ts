import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { atlasAudioFormat, normalizeAtlasCloudApiBase, transcribeWithAtlasCloud } from './atlascloud';

test('normalizes common Atlas Cloud API base forms', () => {
    assert.equal(normalizeAtlasCloudApiBase('https://api.atlascloud.ai/v1'), 'https://api.atlascloud.ai/api/v1');
    assert.equal(normalizeAtlasCloudApiBase('https://api.atlascloud.ai/api/v1/'), 'https://api.atlascloud.ai/api/v1');
    assert.equal(normalizeAtlasCloudApiBase('https://example.test'), 'https://example.test/api/v1');
});

test('accepts only formats supported by the Atlas ASR schema', () => {
    assert.equal(atlasAudioFormat('/tmp/audio.MP3'), 'mp3');
    assert.throws(() => atlasAudioFormat('/tmp/audio.m4a'), /supports mp3, wav, ogg, and raw/);
});

test('submits once and maps a completed prediction', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'transcribee-atlas-'));
    const audioPath = path.join(directory, 'sample.wav');
    await writeFile(audioPath, Buffer.from('audio'));

    const requests: Array<{ url: string; method: string }> = [];
    const responses = [
        new Response(JSON.stringify({ data: { id: 'prediction-1', status: 'created' } }), { status: 200 }),
        new Response(JSON.stringify({
            data: {
                id: 'prediction-1',
                status: 'completed',
                stt_result: {
                    text: 'hello world',
                    words: [{ text: 'hello world', start: 0, end: 1, type: 'utterance', speaker_id: 'speaker_0' }],
                },
            },
        }), { status: 200 }),
    ];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: input.toString(), method: init?.method || 'GET' });
        return responses.shift() as Response;
    };

    const transcript = await transcribeWithAtlasCloud(audioPath, {
        apiKey: 'test-key',
        apiBase: 'https://api.atlascloud.ai/v1',
        pollIntervalMs: 0,
        fetchImpl: fetchImpl as typeof fetch,
    });

    assert.deepEqual(requests.map(request => request.method), ['POST', 'GET']);
    assert.equal(requests[0].url, 'https://api.atlascloud.ai/api/v1/model/generateAudio');
    assert.equal(transcript.words[0].speaker_id, 'speaker_0');
});

test('surfaces a failed prediction instead of polling to exhaustion', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'transcribee-atlas-'));
    const audioPath = path.join(directory, 'sample.wav');
    await writeFile(audioPath, Buffer.from('audio'));

    const responses = [
        new Response(JSON.stringify({ data: { id: 'prediction-2', status: 'created' } }), { status: 200 }),
        new Response(JSON.stringify({ data: { id: 'prediction-2', status: 'failed' } }), { status: 200 }),
    ];
    const fetchImpl = async () => responses.shift() as Response;

    await assert.rejects(
        transcribeWithAtlasCloud(audioPath, {
            apiKey: 'test-key',
            pollIntervalMs: 0,
            maxPollAttempts: 5,
            fetchImpl: fetchImpl as typeof fetch,
        }),
        /prediction-2 failed/
    );
});

test('keeps polling the submitted id when a status read comes back malformed', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'transcribee-atlas-'));
    const audioPath = path.join(directory, 'sample.wav');
    await writeFile(audioPath, Buffer.from('audio'));

    const urls: string[] = [];
    const responses = [
        new Response(JSON.stringify({ data: { id: 'prediction-3', status: 'created' } }), { status: 200 }),
        new Response('gateway hiccup', { status: 200 }),
        new Response(JSON.stringify({
            data: { id: 'prediction-3', status: 'completed', stt_result: { text: 'hi', language: 'en' } },
        }), { status: 200 }),
    ];
    const fetchImpl = async (input: string | URL | Request) => {
        urls.push(input.toString());
        return responses.shift() as Response;
    };

    const transcript = await transcribeWithAtlasCloud(audioPath, {
        apiKey: 'test-key',
        pollIntervalMs: 0,
        fetchImpl: fetchImpl as typeof fetch,
    });

    assert.ok(urls.every(url => !url.includes('undefined')));
    assert.equal(transcript.language_code, 'en');
    assert.equal(transcript.words[0].text, 'hi');
});

test('rejects an unsupported format before reading the file', async () => {
    let fetched = false;
    await assert.rejects(
        transcribeWithAtlasCloud('/nonexistent/audio.m4a', {
            apiKey: 'test-key',
            fetchImpl: (async () => { fetched = true; return new Response('{}'); }) as typeof fetch,
        }),
        /supports mp3, wav, ogg, and raw/
    );
    assert.equal(fetched, false);
});
