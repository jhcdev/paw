import { config as loadEnv } from "dotenv";
import { z } from "zod";
import type { ProviderName } from "./types.js";

loadEnv({ quiet: true });

const providerSchema = z.enum(["anthropic", "openai", "gemini", "groq", "openrouter", "ollama"]);

const envSchema = z.object({
  LLM_PROVIDER: providerSchema.default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-4-20250514"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().min(1).default("gpt-5-mini"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().min(1).default("gemini-2.5-flash"),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().min(1).default("openai/gpt-oss-20b"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().min(1).default("https://openrouter.ai/api/v1"),
  OPENROUTER_MODEL: z.string().min(1).default("anthropic/claude-sonnet-4"),
  OLLAMA_BASE_URL: z.string().min(1).default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().min(1).default("qwen3"),
});

export type AppConfig = {
  provider: ProviderName;
  apiKey: string;
  model: string;
  baseUrl?: string;
};

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return (
    !normalized ||
    normalized.startsWith("your_") ||
    normalized.includes("placeholder") ||
    normalized.includes("example") ||
    normalized === "changeme" ||
    normalized === "replace-me"
  );
}

export function loadConfig(overrides?: Partial<Pick<AppConfig, "provider" | "model">>): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    throw new Error(message);
  }

  const provider = overrides?.provider ?? parsed.data.LLM_PROVIDER;

  switch (provider) {
    case "openai": {
      const apiKey = parsed.data.OPENAI_API_KEY?.trim();
      if (isPlaceholder(apiKey)) throw new Error("OPENAI_API_KEY is required when LLM_PROVIDER=openai");
      return { provider, apiKey: apiKey!, model: overrides?.model ?? parsed.data.OPENAI_MODEL };
    }
    case "gemini": {
      const apiKey = parsed.data.GEMINI_API_KEY?.trim();
      if (isPlaceholder(apiKey)) throw new Error("GEMINI_API_KEY is required when LLM_PROVIDER=gemini");
      return { provider, apiKey: apiKey!, model: overrides?.model ?? parsed.data.GEMINI_MODEL };
    }
    case "groq": {
      const apiKey = parsed.data.GROQ_API_KEY?.trim();
      if (isPlaceholder(apiKey)) throw new Error("GROQ_API_KEY is required when LLM_PROVIDER=groq");
      return {
        provider,
        apiKey: apiKey!,
        model: overrides?.model ?? parsed.data.GROQ_MODEL,
        baseUrl: "https://api.groq.com/openai/v1",
      };
    }
    case "openrouter": {
      const apiKey = parsed.data.OPENROUTER_API_KEY?.trim();
      if (isPlaceholder(apiKey)) throw new Error("OPENROUTER_API_KEY is required when LLM_PROVIDER=openrouter");
      return {
        provider,
        apiKey: apiKey!,
        model: overrides?.model ?? parsed.data.OPENROUTER_MODEL,
        baseUrl: parsed.data.OPENROUTER_BASE_URL,
      };
    }
    case "ollama": {
      return {
        provider,
        apiKey: "",
        model: overrides?.model ?? parsed.data.OLLAMA_MODEL,
        baseUrl: parsed.data.OLLAMA_BASE_URL,
      };
    }
    default: {
      const apiKey = parsed.data.ANTHROPIC_API_KEY?.trim();
      if (isPlaceholder(apiKey)) throw new Error("ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic");
      return { provider: "anthropic", apiKey: apiKey!, model: overrides?.model ?? parsed.data.ANTHROPIC_MODEL };
    }
  }
}
