import type { LlmProvider, ProviderName } from "../types.js";
import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { OpenAIProvider } from "./openai.js";

export function createProvider(args: {
  provider: ProviderName;
  apiKey: string;
  model: string;
  cwd: string;
  baseUrl?: string;
}): LlmProvider {
  switch (args.provider) {
    case "anthropic":
      return new AnthropicProvider(args);
    case "gemini":
      return new GeminiProvider(args);
    case "openai":
      return new OpenAIProvider(args);
    case "groq":
    case "openrouter":
      return new OpenAIProvider({ ...args, baseUrl: args.baseUrl });
    case "ollama":
      return new OpenAIProvider({
        ...args,
        apiKey: "ollama",
        baseUrl: `${args.baseUrl ?? "http://127.0.0.1:11434"}/v1`,
      });
    default:
      throw new Error(`Unsupported provider: ${args.provider}`);
  }
}
