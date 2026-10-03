import assert from 'node:assert/strict';
import test from 'node:test';

import {
    classifyWithFallback,
    extractTextContent,
    getClassificationModel,
} from '../classification.ts';

test('classification failures fall back to uncategorized instead of aborting transcription', async () => {
    const plan = await classifyWithFallback(async () => {
        throw new Error('model not found');
    });

    assert.deepEqual(plan, {
        newTranscriptPath: 'uncategorized',
        reasoning: 'Category classification unavailable: model not found',
        confidence: 'low',
    });
});

test('classification model defaults to an available model and supports an environment override', () => {
    assert.equal(getClassificationModel({}), 'claude-sonnet-5');
    assert.equal(
        getClassificationModel({ ANTHROPIC_MODEL: 'claude-sonnet-4-6' }),
        'claude-sonnet-4-6',
    );
});

test('classification reads the text block when reasoning appears first', () => {
    assert.equal(
        extractTextContent([
            { type: 'thinking', thinking: 'internal reasoning' },
            { type: 'text', text: '{"newTranscriptPath":"developer-tools"}' },
        ]),
        '{"newTranscriptPath":"developer-tools"}',
    );
});
