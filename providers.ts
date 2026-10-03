export type AsrProvider = 'impossibl' | 'elevenlabs' | 'atlascloud';
export type LlmProvider = 'impossibl' | 'anthropic';

type Env = Record<string, string | undefined>;

interface Resolved<T> {
    provider: T;
    notice?: string;
}

const ASR_KEYS: Record<AsrProvider, string> = {
    impossibl: 'IMPOSSIBL_API_KEY',
    elevenlabs: 'ELEVEN_LABS_API_KEY',
    atlascloud: 'ATLASCLOUD_API_KEY',
};

/**
 * Impossibl is the default. When its key is missing but a legacy key exists,
 * fall back to that provider with a one-line notice instead of failing.
 */
export function resolveAsrProvider(env: Env = process.env): Resolved<AsrProvider> {
    const requested = (env.ASR_PROVIDER || 'impossibl').toLowerCase();
    if (!(requested in ASR_KEYS)) {
        throw new Error('ASR_PROVIDER must be impossibl, elevenlabs, or atlascloud');
    }
    if (requested !== 'impossibl' || env.IMPOSSIBL_API_KEY) return { provider: requested as AsrProvider };

    for (const fallback of ['elevenlabs', 'atlascloud'] as const) {
        if (env[ASR_KEYS[fallback]]) {
            return {
                provider: fallback,
                notice: `ℹ️  IMPOSSIBL_API_KEY not set; transcribing with ${fallback} instead`,
            };
        }
    }
    return { provider: 'impossibl' };
}

export function resolveLlmProvider(env: Env = process.env): Resolved<LlmProvider> {
    const requested = (env.LLM_PROVIDER || 'impossibl').toLowerCase();
    if (requested !== 'impossibl' && requested !== 'anthropic') {
        throw new Error('LLM_PROVIDER must be impossibl or anthropic');
    }
    if (requested === 'impossibl' && !env.IMPOSSIBL_API_KEY && env.ANTHROPIC_API_KEY) {
        return {
            provider: 'anthropic',
            notice: 'ℹ️  IMPOSSIBL_API_KEY not set; classifying with Anthropic directly instead',
        };
    }
    return { provider: requested };
}
