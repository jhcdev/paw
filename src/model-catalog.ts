import type { ProviderName } from "./types.js";

type ModelInfo = {
  id: string;
  name: string;
  tier: "fast" | "standard" | "strong";
};

const CATALOG: Record<ProviderName, ModelInfo[]> = {
  anthropic: [
    { id: "claude-haiku-4-5-20251001", name: "Haiku 4.5", tier: "fast" },
    { id: "claude-sonnet-4-20250514", name: "Sonnet 4", tier: "standard" },
    { id: "claude-opus-4-20250514", name: "Opus 4", tier: "strong" },
  ],
  openai: [
    { id: "gpt-5-nano", name: "GPT-5 Nano", tier: "fast" },
    { id: "gpt-5-mini", name: "GPT-5 Mini", tier: "standard" },
    { id: "gpt-5.2", name: "GPT-5.2", tier: "strong" },
    { id: "gpt-5.2-codex", name: "GPT-5.2 Codex", tier: "strong" },
    { id: "o4-mini", name: "o4 Mini", tier: "standard" },
  ],
  gemini: [
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", tier: "fast" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", tier: "strong" },
  ],
  groq: [
    { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B", tier: "fast" },
    { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", tier: "strong" },
    { id: "qwen/qwen3-32b", name: "Qwen3 32B", tier: "standard" },
  ],
  openrouter: [
    { id: "openrouter/free", name: "Free (auto)", tier: "fast" },
    { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", tier: "standard" },
    { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", tier: "strong" },
    { id: "openai/gpt-5-mini", name: "GPT-5 Mini", tier: "standard" },
    { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (free)", tier: "standard" },
  ],
  ollama: [
    { id: "qwen3", name: "Qwen3 8B", tier: "standard" },
    { id: "qwen2.5-coder:7b", name: "Qwen2.5 Coder 7B", tier: "standard" },
    { id: "qwen2.5-coder:14b", name: "Qwen2.5 Coder 14B", tier: "strong" },
    { id: "deepseek-r1:8b", name: "DeepSeek R1 8B", tier: "standard" },
  ],
};

const TIER_LABELS: Record<string, string> = {
  fast: "fast",
  standard: "balanced",
  strong: "powerful",
};

export function getModelsForProvider(provider: ProviderName): ModelInfo[] {
  return CATALOG[provider] ?? [];
}

export function getAllModels(): { provider: ProviderName; models: ModelInfo[] }[] {
  return (Object.entries(CATALOG) as [ProviderName, ModelInfo[]][]).map(([provider, models]) => ({
    provider,
    models,
  }));
}

export function formatModelList(provider: ProviderName, activeModel?: string): string {
  const models = CATALOG[provider] ?? [];
  if (models.length === 0) return `  No model catalog for ${provider}. Enter any model ID.`;
  return models.map((m, i) => {
    const active = m.id === activeModel ? " *" : "";
    return `  ${i + 1}. ${m.id}${active} — ${m.name} (${TIER_LABELS[m.tier] ?? m.tier})`;
  }).join("\n");
}

export function resolveModelByIndex(provider: ProviderName, index: number): string | null {
  const models = CATALOG[provider] ?? [];
  if (index < 1 || index > models.length) return null;
  return models[index - 1]!.id;
}
