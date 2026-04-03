import { createProvider } from "./providers/index.js";
import type { AgentTurnResult, LlmProvider, ProviderName } from "./types.js";

type ProviderEntry = {
  provider: ProviderName;
  apiKey: string;
  model: string;
  baseUrl?: string;
  instance?: LlmProvider;
};

export type MergeResult = {
  individual: { provider: ProviderName; model: string; text: string; ms: number }[];
  merged: string;
  mergeMs: number;
};

const MERGE_PROMPT = `You received responses from multiple AI models for the same user request.
Synthesize the best answer by combining the strongest parts of each response.
Keep the most accurate, complete, and useful information. Remove redundancy.
If models disagree, note the disagreement briefly and go with the most well-reasoned answer.
Be concise. Output ONLY the merged answer, no meta-commentary about the merging process.

`;

export class MultiProvider {
  private providers: Map<ProviderName, ProviderEntry> = new Map();
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  register(provider: ProviderName, apiKey: string, model: string, baseUrl?: string): void {
    this.providers.set(provider, { provider, apiKey, model, baseUrl });
  }

  private getOrCreate(name: ProviderName): LlmProvider {
    const entry = this.providers.get(name);
    if (!entry) throw new Error(`Provider "${name}" not configured.`);
    if (!entry.instance) {
      entry.instance = createProvider({
        provider: entry.provider,
        apiKey: entry.apiKey,
        model: entry.model,
        cwd: this.cwd,
        baseUrl: entry.baseUrl,
      });
    }
    return entry.instance;
  }

  getRegistered(): { name: ProviderName; model: string }[] {
    return Array.from(this.providers.entries()).map(([name, e]) => ({ name, model: e.model }));
  }

  isRegistered(name: ProviderName): boolean {
    return this.providers.has(name);
  }

  getProviderConfig(name: ProviderName): { apiKey: string; model: string; baseUrl?: string } | null {
    const entry = this.providers.get(name);
    return entry ? { apiKey: entry.apiKey, model: entry.model, baseUrl: entry.baseUrl } : null;
  }

  /** Ask a single provider (one-shot, no history) */
  async ask(provider: ProviderName, prompt: string): Promise<AgentTurnResult> {
    const instance = this.getOrCreate(provider);
    return instance.runTurn(prompt);
  }

  /** Send prompt to all providers in parallel, then merge with the primary model */
  async merge(prompt: string, primaryProvider: ProviderName): Promise<MergeResult> {
    const targets = Array.from(this.providers.keys());
    if (targets.length < 2) throw new Error("Need at least 2 providers for merge mode. Configure more in .env");

    // Phase 1: parallel query to all providers
    const results = await Promise.allSettled(
      targets.map(async (name) => {
        const entry = this.providers.get(name)!;
        const instance = this.getOrCreate(name);
        const start = Date.now();
        const result = await instance.runTurn(prompt);
        return { provider: name, model: entry.model, text: result.text, ms: Date.now() - start };
      }),
    );

    const individual = results
      .filter((r): r is PromiseFulfilledResult<{ provider: ProviderName; model: string; text: string; ms: number }> => r.status === "fulfilled")
      .map((r) => r.value);

    if (individual.length === 0) throw new Error("All providers failed.");

    // If only 1 succeeded, return it directly
    if (individual.length === 1) {
      return { individual, merged: individual[0]!.text, mergeMs: 0 };
    }

    // Phase 2: merge with primary model
    const mergeInput = individual
      .map((r, i) => `--- Response from ${r.provider}/${r.model} (${r.ms}ms) ---\n${r.text}`)
      .join("\n\n");

    const mergeStart = Date.now();
    const primary = this.getOrCreate(primaryProvider);
    const mergeResult = await primary.runTurn(
      `${MERGE_PROMPT}User's original request:\n${prompt}\n\nModel responses:\n${mergeInput}`,
    );

    return {
      individual,
      merged: mergeResult.text,
      mergeMs: Date.now() - mergeStart,
    };
  }
}

/** Auto-detect providers from environment variables */
export function detectProviders(env: Record<string, string | undefined>): { provider: ProviderName; apiKey: string; model: string; baseUrl?: string }[] {
  const found: { provider: ProviderName; apiKey: string; model: string; baseUrl?: string }[] = [];

  const check = (name: ProviderName, keyVar: string, modelVar: string, defaultModel: string, baseUrl?: string) => {
    const key = env[keyVar]?.trim();
    if (key && !isPlaceholder(key)) {
      found.push({ provider: name, apiKey: key, model: env[modelVar]?.trim() || defaultModel, baseUrl });
    }
  };

  check("anthropic", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "claude-sonnet-4-20250514");
  check("openai", "OPENAI_API_KEY", "OPENAI_MODEL", "gpt-5-mini");
  check("gemini", "GEMINI_API_KEY", "GEMINI_MODEL", "gemini-2.5-flash");
  check("groq", "GROQ_API_KEY", "GROQ_MODEL", "openai/gpt-oss-20b", "https://api.groq.com/openai/v1");
  check("openrouter", "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "anthropic/claude-sonnet-4", env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1");

  // Ollama (no key needed)
  if (env.OLLAMA_MODEL?.trim() || env.OLLAMA_BASE_URL?.trim()) {
    found.push({
      provider: "ollama",
      apiKey: "",
      model: env.OLLAMA_MODEL?.trim() || "qwen3",
      baseUrl: env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434",
    });
  }

  return found;
}

function isPlaceholder(value: string): boolean {
  const n = value.toLowerCase();
  return n.startsWith("your_") || n.includes("placeholder") || n.includes("example") || n === "changeme" || n === "replace-me";
}
