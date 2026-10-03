import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    chunkSecondsFor,
    FALLBACK_MAX_UPLOAD_BYTES,
    MAX_DURATION_SECS,
    MAX_UPLOAD_BYTES,
    mergeChunkTranscripts,
    prepareAudioForUpload,
    transcribeFileWithImpossibl,
    resolveUploadLimits,
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
        [413, /HTTP 413 \(upload exceeds the gateway's size limit\)/],
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

test('defaults to ElevenLabs limits: 3 GB and 10 h', () => {
    assert.equal(MAX_UPLOAD_BYTES, 3 * 1024 ** 3);
    assert.equal(MAX_DURATION_SECS, 36000);
    assert.equal(FALLBACK_MAX_UPLOAD_BYTES, 24 * 1024 * 1024);
    assert.deepEqual(resolveUploadLimits({}, {}), { maxBytes: MAX_UPLOAD_BYTES, maxDurationSecs: MAX_DURATION_SECS });
});

test('env overrides the upload limits; explicit options win', () => {
    const env = { IMPOSSIBL_MAX_UPLOAD_MB: '24', IMPOSSIBL_MAX_DURATION_HOURS: '1.5' };
    assert.deepEqual(resolveUploadLimits({}, env), { maxBytes: 24 * 1024 * 1024, maxDurationSecs: 5400 });
    assert.deepEqual(resolveUploadLimits({ maxBytes: 10, maxDurationSecs: 20 }, env), { maxBytes: 10, maxDurationSecs: 20 });
    assert.throws(() => resolveUploadLimits({}, { IMPOSSIBL_MAX_UPLOAD_MB: 'zero' }), /IMPOSSIBL_MAX_UPLOAD_MB must be a positive number/);
    assert.throws(() => resolveUploadLimits({}, { IMPOSSIBL_MAX_DURATION_HOURS: '0' }), /IMPOSSIBL_MAX_DURATION_HOURS must be a positive number/);
});

test('chunk length respects the duration limit even for small files', () => {
    const limits = { maxBytes: MAX_UPLOAD_BYTES, maxDurationSecs: MAX_DURATION_SECS };
    // 11 h in 5 MB: size is no issue, but each chunk must stay under 10 h.
    const chunkSecs = chunkSecondsFor(5 * 1024 * 1024, 11 * 3600, limits);
    assert.ok(chunkSecs < MAX_DURATION_SECS);
    assert.equal(Math.ceil((11 * 3600) / chunkSecs), 2);
    // Size-bound case keeps the old behaviour: 90% of the byte limit per chunk.
    assert.equal(chunkSecondsFor(100, 100, { maxBytes: 50, maxDurationSecs: MAX_DURATION_SECS }), 45);
});

test('a big file under 3 GB and 10 h is uploaded untouched', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'transcribee-impossibl-'));
    const audioPath = path.join(directory, 'long.m4a');
    try {
        await writeFile(audioPath, '');
        await truncate(audioPath, 2.5 * 1024 ** 3); // sparse, no real disk use
        const result = await prepareAudioForUpload(audioPath, { probeDuration: async () => 9.5 * 3600 });
        assert.deepEqual(result, { chunks: [{ path: audioPath, offsetSecs: 0 }] });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

async function toneFile(seconds: number, name = 'tone.wav'): Promise<{ directory: string; source: string }> {
    const directory = await mkdtemp(path.join(tmpdir(), 'transcribee-impossibl-'));
    const source = path.join(directory, name);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-ar', '44100', source]);
    return { directory, source };
}

function probe(filePath: string): number {
    return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath]).toString());
}

test('audio over the duration limit is split without re-encoding even when small', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
    const { directory, source } = await toneFile(60);
    const previous = process.env.IMPOSSIBL_MAX_DURATION_HOURS;
    process.env.IMPOSSIBL_MAX_DURATION_HOURS = String(20 / 3600); // 20 s
    try {
        const { chunks } = await prepareAudioForUpload(source, { workDir: directory });
        assert.ok(chunks.length >= 3, `expected >= 3 chunks, got ${chunks.length}`);
        assert.ok(!(await readdir(directory)).includes('compressed.mp3'), 'should not re-encode a small file');
        for (const chunk of chunks) {
            assert.equal(path.extname(chunk.path), '.wav');
            assert.ok(probe(chunk.path) <= 20, `${chunk.path} is longer than 20 s`);
        }
    } finally {
        if (previous === undefined) delete process.env.IMPOSSIBL_MAX_DURATION_HOURS;
        else process.env.IMPOSSIBL_MAX_DURATION_HOURS = previous;
        await rm(directory, { recursive: true, force: true });
    }
});

test('IMPOSSIBL_MAX_UPLOAD_MB forces re-encoding', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
    const { directory, source } = await toneFile(60); // ~5 MB WAV, ~240 KB as 32 kbps MP3
    const previous = process.env.IMPOSSIBL_MAX_UPLOAD_MB;
    process.env.IMPOSSIBL_MAX_UPLOAD_MB = '1';
    try {
        const { chunks } = await prepareAudioForUpload(source, { workDir: directory });
        assert.deepEqual(chunks, [{ path: path.join(directory, 'compressed.mp3'), offsetSecs: 0 }]);
    } finally {
        if (previous === undefined) delete process.env.IMPOSSIBL_MAX_UPLOAD_MB;
        else process.env.IMPOSSIBL_MAX_UPLOAD_MB = previous;
        await rm(directory, { recursive: true, force: true });
    }
});

test('a 413 triggers exactly one fallback retry with chunking, then merges', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async t => {
    const log = t.mock.method(console, 'log', () => {});
    const { directory, source } = await toneFile(60);
    const fallbackMaxBytes = 100 * 1024;
    const uploads: number[] = [];
    const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
        uploads.push(((init?.body as FormData).get('file') as File).size);
        if (uploads.length === 1) return new Response('{"error":"payload too large"}', { status: 413 });
        return ok({ text: 't', words: [{ text: 't', start: 1, end: 2, type: 'word', speaker_id: 'speaker_0' }] });
    };
    try {
        const { transcript, chunks } = await transcribeWithImpossibl(source, {
            apiKey: 'k', fallbackMaxBytes, fetchImpl: fetchImpl as typeof fetch,
        });
        assert.ok(chunks >= 3, `expected >= 3 chunks, got ${chunks}`);
        assert.equal(uploads.length, 1 + chunks);
        assert.ok(uploads[0] > fallbackMaxBytes, 'first attempt uploads the original file');
        for (const size of uploads.slice(1)) assert.ok(size <= fallbackMaxBytes);
        assert.equal(transcript.words.length, chunks);
        assert.equal(transcript.words[0].start, 1);
        assert.ok((transcript.words[1].start ?? 0) > 1, 'later chunks are offset');

        const warnings = log.mock.calls.map(call => String(call.arguments[0])).filter(line => line.includes('413'));
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /gateway rejected 5(\.\d)? MB upload \(413\); retrying with re-encode\/chunking under 0\.1 MB/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('a second 413 surfaces a clear error without looping', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async t => {
    t.mock.method(console, 'log', () => {});
    const { directory, source } = await toneFile(60);
    let calls = 0;
    const fetchImpl = async () => {
        calls += 1;
        return new Response('{"error":"payload too large"}', { status: 413 });
    };
    try {
        await assert.rejects(
            transcribeWithImpossibl(source, { apiKey: 'k', fallbackMaxBytes: 100 * 1024, fetchImpl: fetchImpl as typeof fetch }),
            /rejected the upload \(413\) even after re-encoding\/chunking under 0\.1 MB/,
        );
        assert.equal(calls, 2);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('no fallback retry when the limit is already at or below the fallback cap', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
    const { directory, source } = await toneFile(5);
    let calls = 0;
    const fetchImpl = async () => {
        calls += 1;
        return new Response('too large', { status: 413 });
    };
    try {
        await assert.rejects(
            transcribeWithImpossibl(source, { apiKey: 'k', maxBytes: FALLBACK_MAX_UPLOAD_BYTES, fetchImpl: fetchImpl as typeof fetch }),
            /HTTP 413 \(upload exceeds the gateway's size limit\)/,
        );
        assert.equal(calls, 1);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
