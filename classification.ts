export interface OrganizationPlan {
    newTranscriptPath: string;
    reasoning: string;
    confidence: 'high' | 'medium' | 'low';
}

export function getClassificationModel(
    env: Record<string, string | undefined> = process.env,
): string {
    return env.ANTHROPIC_MODEL || 'claude-sonnet-5';
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
