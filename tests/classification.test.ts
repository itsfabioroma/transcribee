import assert from 'node:assert/strict';
import test from 'node:test';

import {
    classifyWithFallback,
    extractTextContent,
    getClassificationModel,
    parseOrganizationPlan,
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

test('classification model defaults depend on the provider and support an environment override', () => {
    assert.equal(getClassificationModel({}), 'claude-sonnet-5');
    assert.equal(getClassificationModel({}, 'impossibl'), 'anthropic/claude-haiku-4-5');
    assert.equal(getClassificationModel({ ANTHROPIC_MODEL: 'claude-sonnet-4-6' }, 'impossibl'), 'anthropic/claude-sonnet-4-6');
    assert.equal(getClassificationModel({ ANTHROPIC_MODEL: 'anthropic/claude-opus-4-5' }, 'impossibl'), 'anthropic/claude-opus-4-5');
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

test('classification parses JSON wrapped in markdown fences', () => {
    const plan = { newTranscriptPath: 'internet-culture', reasoning: 'zoo vlog', confidence: 'high' };
    assert.deepEqual(parseOrganizationPlan('```json\n' + JSON.stringify(plan) + '\n```'), plan);
    assert.deepEqual(parseOrganizationPlan(JSON.stringify(plan)), plan);
    assert.throws(() => parseOrganizationPlan('no json here'), /No JSON object/);
});
