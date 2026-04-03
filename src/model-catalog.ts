import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
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
  anthropic: [
    // Free / Pro
    { id: "claude-haiku-4-5-20251001", name: "Haiku 4.5", tier: "fast", minPlan: "free" },
    { id: "claude-sonnet-4-20250514", name: "Sonnet 4", tier: "standard", minPlan: "free" },
    { id: "claude-sonnet-4-6-20250725", name: "Sonnet 4.6", tier: "standard", minPlan: "pro" },
    // Max / Team
    { id: "claude-opus-4-20250514", name: "Opus 4", tier: "strong", minPlan: "max" },
    { id: "claude-opus-4-6-20250725", name: "Opus 4.6", tier: "strong", minPlan: "max" },
    // API only (all models available)
    { id: "claude-3-5-haiku-20241022", name: "Haiku 3.5", tier: "fast", minPlan: "api" },
    { id: "claude-3-5-sonnet-20241022", name: "Sonnet 3.5 v2", tier: "standard", minPlan: "api" },
  ],
  openai: [
    // Free
    { id: "gpt-4o-mini", name: "GPT-4o Mini", tier: "fast", minPlan: "free" },
    { id: "gpt-4o", name: "GPT-4o", tier: "standard", minPlan: "free" },
    // Pro
    { id: "gpt-5-nano", name: "GPT-5 Nano", tier: "fast", minPlan: "pro" },
    { id: "gpt-5-mini", name: "GPT-5 Mini", tier: "standard", minPlan: "pro" },
    { id: "o4-mini", name: "o4 Mini", tier: "standard", minPlan: "pro" },
    { id: "gpt-5.2", name: "GPT-5.2", tier: "strong", minPlan: "pro" },
    // Max (Pro Plus)
    { id: "gpt-5.2-codex", name: "GPT-5.2 Codex", tier: "strong", minPlan: "max" },
    { id: "o3", name: "o3", tier: "strong", minPlan: "max" },
    // API only
    { id: "gpt-4.1", name: "GPT-4.1", tier: "standard", minPlan: "api" },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", tier: "fast", minPlan: "api" },
    { id: "gpt-4.1-nano", name: "GPT-4.1 Nano", tier: "fast", minPlan: "api" },
  ],
  gemini: [
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", tier: "fast", minPlan: "free" },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", tier: "fast", minPlan: "free" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", tier: "strong", minPlan: "free" },
    { id: "gemma-3-27b-it", name: "Gemma 3 27B", tier: "standard", minPlan: "free" },
  ],
  groq: [
    { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B", tier: "fast", minPlan: "free" },
    { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", tier: "strong", minPlan: "free" },
    { id: "qwen/qwen3-32b", name: "Qwen3 32B", tier: "standard", minPlan: "free" },
    { id: "meta-llama/llama-3.3-70b-versatile", name: "Llama 3.3 70B", tier: "standard", minPlan: "free" },
  ],
  openrouter: [
    { id: "openrouter/free", name: "Free (auto)", tier: "fast", minPlan: "free" },
    { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", tier: "standard", minPlan: "free" },
    { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", tier: "strong", minPlan: "free" },
    { id: "openai/gpt-5-mini", name: "GPT-5 Mini", tier: "standard", minPlan: "free" },
    { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (free)", tier: "standard", minPlan: "free" },
    { id: "openai/gpt-5.2", name: "GPT-5.2", tier: "strong", minPlan: "free" },
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

// ── Plan detection ──

/** Detect Anthropic plan from ~/.claude/.credentials.json */
async function detectAnthropicPlan(): Promise<PlanLevel> {
  try {
    const raw = await fs.readFile(path.join(os.homedir(), ".claude", ".credentials.json"), "utf8");
    const data = JSON.parse(raw);
    const sub = data.claudeAiOauth?.subscriptionType?.toLowerCase() ?? "";
    if (sub.includes("max")) return "max";
    if (sub.includes("team")) return "team";
    if (sub.includes("enterprise")) return "enterprise";
    if (sub.includes("pro")) return "pro";
    if (sub) return "free";
    return "api"; // No subscription = API key user, all models available
  } catch {
    return "api"; // Can't read = assume API key
  }
}

/** Detect OpenAI plan from ~/.codex/auth.json JWT */
async function detectOpenAIPlan(): Promise<PlanLevel> {
  try {
    const raw = await fs.readFile(path.join(os.homedir(), ".codex", "auth.json"), "utf8");
    const data = JSON.parse(raw);
    // API key user
    if (data.OPENAI_API_KEY && typeof data.OPENAI_API_KEY === "string") return "api";
    // OAuth user — decode JWT to get plan
    const idToken = data.tokens?.id_token;
    if (idToken) {
      const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64").toString());
      const plan = payload["https://api.openai.com/auth"]?.chatgpt_plan_type?.toLowerCase() ?? "";
      if (plan.includes("enterprise")) return "enterprise";
      if (plan.includes("team")) return "team";
      if (plan.includes("max") || plan.includes("pro_plus")) return "max";
      if (plan.includes("pro") || plan.includes("plus")) return "pro";
      return "free";
    }
    return "api";
  } catch {
    return "api";
  }
}

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

/** Fetch available models from OpenAI-compatible /v1/models endpoint */
async function fetchOpenAIModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]> {
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { data?: { id: string }[] };
    return (data.data ?? []).map((m) => ({
      id: m.id,
      name: m.id,
      tier: "standard" as const,
      minPlan: "free" as PlanLevel,
    }));
  } catch { return []; }
}

/** Fetch Gemini models from Google AI API */
async function fetchGeminiModels(apiKey: string): Promise<ModelInfo[]> {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { models?: { name: string; displayName: string; description?: string }[] };
    return (data.models ?? [])
      .filter((m) => m.name.includes("gemini"))
      .map((m) => {
        const id = m.name.replace("models/", "");
        const tier: "fast" | "standard" | "strong" = id.includes("flash") ? "fast" : id.includes("pro") ? "strong" : "standard";
        return { id, name: m.displayName, tier, minPlan: "free" as PlanLevel };
      });
  } catch { return []; }
}

/** Live-detect models for API key providers */
export async function detectLiveModels(provider: ProviderName, apiKey: string, baseUrl?: string): Promise<ModelInfo[] | null> {
  switch (provider) {
    case "openai":
      if (apiKey) return fetchOpenAIModels("https://api.openai.com/v1", apiKey);
      return null;
    case "gemini":
      if (apiKey) return fetchGeminiModels(apiKey);
      return null;
    case "groq":
      if (apiKey) return fetchOpenAIModels("https://api.groq.com/openai/v1", apiKey);
      return null;
    case "openrouter":
      if (apiKey) return fetchOpenAIModels(baseUrl ?? "https://openrouter.ai/api/v1", apiKey);
      return null;
    case "ollama":
      return detectOllamaModels();
    default:
      return null;
  }
}

/** Detect plan for a provider. API key = all models. Login = plan-based. */
export async function detectPlan(provider: ProviderName): Promise<PlanLevel> {
  switch (provider) {
    case "anthropic": return detectAnthropicPlan();
    case "openai": return detectOpenAIPlan();
    case "gemini":
    case "groq":
    case "openrouter":
      return "api"; // API key providers = all models
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
