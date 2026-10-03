export interface OrganizationPlan {
    newTranscriptPath: string;
    reasoning: string;
    confidence: 'high' | 'medium' | 'low';
}

export function getClassificationModel(
    env: Record<string, string | undefined> = process.env,
    provider: 'impossibl' | 'anthropic' = 'anthropic',
): string {
    if (provider === 'anthropic') return env.ANTHROPIC_MODEL || 'claude-sonnet-5';
    // Impossibl model ids are creator-prefixed; accept bare Anthropic ids too.
    const model = env.ANTHROPIC_MODEL || 'anthropic/claude-haiku-4-5';
    return model.includes('/') ? model : `anthropic/${model}`;
}

export function extractTextContent(content: unknown[]): string {
    const textBlock = content.find(
        (block): block is { type: 'text'; text: string } =>
            typeof block === 'object' &&
            block !== null &&
            (block as { type?: unknown }).type === 'text' &&
            typeof (block as { text?: unknown }).text === 'string',
    );

    if (!textBlock) {
        throw new Error('Unexpected response type from Claude');
    }

    return textBlock.text;
}

// Some models wrap the JSON in ```json fences or add prose; take the outermost object.
export function parseOrganizationPlan(text: string): OrganizationPlan {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end < start) throw new Error(`No JSON object in classification response: ${text.slice(0, 100)}`);
    return JSON.parse(text.slice(start, end + 1)) as OrganizationPlan;
}

export async function classifyWithFallback(
    classify: () => Promise<OrganizationPlan>,
): Promise<OrganizationPlan> {
    try {
        return await classify();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            newTranscriptPath: 'uncategorized',
            reasoning: `Category classification unavailable: ${message}`,
            confidence: 'low',
        };
    }
}
