import type { ProviderName } from "./types.js";

export type PlanLevel = "free" | "pro" | "max" | "team" | "enterprise" | "api";

type ModelInfo = {
  id: string;
  name: string;
  tier: "fast" | "standard" | "strong";
  minPlan: PlanLevel;
};

// Plan hierarchy: higher index = more access
const PLAN_RANK: Record<PlanLevel, number> = {
  free: 0, pro: 1, max: 2, team: 3, enterprise: 4, api: 5,
};

function hasAccess(userPlan: PlanLevel, required: PlanLevel): boolean {
  return PLAN_RANK[userPlan] >= PLAN_RANK[required];
}

// ── Full model catalogs with plan requirements ──

const CATALOG: Record<ProviderName, ModelInfo[]> = {
  codex: [
    { id: "gpt-5.4", name: "GPT-5.4 (default)", tier: "strong", minPlan: "free" },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", tier: "standard", minPlan: "free" },
    { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", tier: "strong", minPlan: "free" },
    { id: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark (ultra-fast)", tier: "fast", minPlan: "free" },
    { id: "gpt-5.2-codex", name: "GPT-5.2 Codex", tier: "strong", minPlan: "free" },
    { id: "gpt-5.2", name: "GPT-5.2", tier: "strong", minPlan: "free" },
    { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max", tier: "strong", minPlan: "pro" },
    { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini", tier: "fast", minPlan: "free" },
    { id: "o4-mini", name: "o4 Mini", tier: "standard", minPlan: "free" },
    { id: "o3", name: "o3", tier: "strong", minPlan: "pro" },
  ],
  ollama: [
    { id: "qwen3", name: "Qwen3 8B", tier: "standard", minPlan: "free" },
    { id: "qwen2.5-coder:7b", name: "Qwen2.5 Coder 7B", tier: "standard", minPlan: "free" },
    { id: "qwen2.5-coder:14b", name: "Qwen2.5 Coder 14B", tier: "strong", minPlan: "free" },
    { id: "deepseek-r1:8b", name: "DeepSeek R1 8B", tier: "standard", minPlan: "free" },
    { id: "llama3.3:70b", name: "Llama 3.3 70B", tier: "strong", minPlan: "free" },
    { id: "codestral:latest", name: "Codestral", tier: "standard", minPlan: "free" },
  ],
};

const TIER_LABELS: Record<string, string> = {
  fast: "fast", standard: "balanced", strong: "powerful",
};

const PLAN_LABELS: Record<PlanLevel, string> = {
  free: "", pro: "pro", max: "max", team: "team", enterprise: "ent", api: "api",
};

/** Detect locally pulled Ollama models */
async function detectOllamaModels(): Promise<ModelInfo[]> {
  try {
    const baseUrl = process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = await res.json() as { models?: { name: string; size: number; details?: { parameter_size?: string } }[] };
    return (data.models ?? []).map((m) => {
      const size = m.details?.parameter_size ?? "";
      const tier: "fast" | "standard" | "strong" =
        size.includes("70") || size.includes("120") ? "strong" :
        size.includes("14") || size.includes("32") ? "standard" : "standard";
      return { id: m.name, name: `${m.name} (${size || formatBytes(m.size)})`, tier, minPlan: "free" as PlanLevel };
    });
  } catch {
    return [];
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)}MB`;
  return `${bytes}B`;
}

/** Live-detect models for API key providers */
export async function detectLiveModels(provider: ProviderName, apiKey: string, baseUrl?: string): Promise<ModelInfo[] | null> {
  switch (provider) {
    case "ollama":
      return detectOllamaModels();
    default:
      return null;
  }
}

/** Detect plan for a provider. API key = all models. Login = plan-based. */
export async function detectPlan(provider: ProviderName): Promise<PlanLevel> {
  switch (provider) {
    case "codex": return "api";
    case "ollama":
      return "free"; // Local = all models (all marked free)
    default:
      return "api";
  }
}

// ── Public API ──

export function getModelsForProvider(provider: ProviderName): ModelInfo[] {
  return CATALOG[provider] ?? [];
}

export function getFilteredModels(provider: ProviderName, plan: PlanLevel): ModelInfo[] {
  return (CATALOG[provider] ?? []).filter((m) => hasAccess(plan, m.minPlan));
}

export function getAllModels(): { provider: ProviderName; models: ModelInfo[] }[] {
  return (Object.entries(CATALOG) as [ProviderName, ModelInfo[]][]).map(([provider, models]) => ({
    provider, models,
  }));
}

export async function getAllFilteredModels(
  providerKeys?: Map<string, { apiKey: string; baseUrl?: string }>,
): Promise<{ provider: ProviderName; plan: PlanLevel; models: ModelInfo[] }[]> {
  const results: { provider: ProviderName; plan: PlanLevel; models: ModelInfo[] }[] = [];

  for (const [provider, catalogModels] of Object.entries(CATALOG) as [ProviderName, ModelInfo[]][]) {
    const plan = await detectPlan(provider);
    const keyInfo = providerKeys?.get(provider);

    // Try live detection for providers with API keys
    if (keyInfo?.apiKey || provider === "ollama") {
      const live = await detectLiveModels(provider, keyInfo?.apiKey ?? "", keyInfo?.baseUrl);
      if (live && live.length > 0) {
        results.push({ provider, plan, models: live });
        continue;
      }
    }

    // Fallback to plan-filtered static catalog
    results.push({ provider, plan, models: catalogModels.filter((m) => hasAccess(plan, m.minPlan)) });
  }

  return results;
}

export function formatModelList(provider: ProviderName, activeModel?: string, plan?: PlanLevel): string {
  const models = plan ? getFilteredModels(provider, plan) : (CATALOG[provider] ?? []);
  if (models.length === 0) return `  No models available. Check your plan or enter a model ID directly.`;
  return models.map((m, i) => {
    const active = m.id === activeModel ? " *" : "";
    const planTag = m.minPlan !== "free" ? ` [${PLAN_LABELS[m.minPlan]}]` : "";
    return `  ${i + 1}. ${m.id}${active} — ${m.name} (${TIER_LABELS[m.tier] ?? m.tier})${planTag}`;
  }).join("\n");
}

export function resolveModelByIndex(provider: ProviderName, index: number, plan?: PlanLevel): string | null {
  const models = plan ? getFilteredModels(provider, plan) : (CATALOG[provider] ?? []);
  if (index < 1 || index > models.length) return null;
  return models[index - 1]!.id;
}
