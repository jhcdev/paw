import { config as loadEnv } from "dotenv";
import { statSync } from "node:fs";
import { z } from "zod";
import type { ProviderName } from "./types.js";

loadEnv({ quiet: true });

const providerSchema = z.enum(["anthropic", "codex", "ollama"]);

const envSchema = z.object({
  LLM_PROVIDER: providerSchema.default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-4-20250514"),
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
  try {
    const envStat = statSync(".env", { throwIfNoEntry: false } as any);
    if (envStat && (envStat.mode & 0o077) !== 0) {
      process.stderr.write("Warning: .env is readable by other users. Run: chmod 600 .env\n");
    }
  } catch {}

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    throw new Error(message);
  }

  const provider = overrides?.provider ?? parsed.data.LLM_PROVIDER;

  switch (provider) {
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
