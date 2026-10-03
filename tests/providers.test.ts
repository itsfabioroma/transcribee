import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAsrProvider, resolveLlmProvider } from '../providers.ts';

test('Impossibl is the default provider for both steps', () => {
    const env = { IMPOSSIBL_API_KEY: 'k', ELEVEN_LABS_API_KEY: 'e', ANTHROPIC_API_KEY: 'a' };
    assert.deepEqual(resolveAsrProvider(env), { provider: 'impossibl' });
    assert.deepEqual(resolveLlmProvider(env), { provider: 'impossibl' });
});

test('explicit providers are honoured', () => {
    const env = { IMPOSSIBL_API_KEY: 'k', ASR_PROVIDER: 'AtlasCloud', LLM_PROVIDER: 'anthropic' };
    assert.equal(resolveAsrProvider(env).provider, 'atlascloud');
    assert.equal(resolveLlmProvider(env).provider, 'anthropic');
});

test('falls back to legacy keys with a notice when IMPOSSIBL_API_KEY is missing', () => {
    const env = { ELEVEN_LABS_API_KEY: 'e', ANTHROPIC_API_KEY: 'a' };
    const asr = resolveAsrProvider(env);
    const llm = resolveLlmProvider(env);
    assert.equal(asr.provider, 'elevenlabs');
    assert.match(asr.notice ?? '', /IMPOSSIBL_API_KEY not set/);
    assert.equal(llm.provider, 'anthropic');
    assert.match(llm.notice ?? '', /IMPOSSIBL_API_KEY not set/);
    assert.equal(resolveAsrProvider({ ATLASCLOUD_API_KEY: 'x' }).provider, 'atlascloud');
});

test('with no keys at all, stays on Impossibl so the missing-key error is clear', () => {
    assert.deepEqual(resolveAsrProvider({}), { provider: 'impossibl' });
    assert.deepEqual(resolveLlmProvider({}), { provider: 'impossibl' });
});

test('rejects unknown providers', () => {
    assert.throws(() => resolveAsrProvider({ ASR_PROVIDER: 'whisper' }), /ASR_PROVIDER must be/);
    assert.throws(() => resolveLlmProvider({ LLM_PROVIDER: 'openai' }), /LLM_PROVIDER must be/);
});
