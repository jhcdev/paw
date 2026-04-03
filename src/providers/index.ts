import type { LlmProvider, ProviderName } from "../types.js";
import { CodexProvider } from "./codex.js";
import { OpenAIProvider } from "./openai.js";

export function createProvider(args: {
  provider: ProviderName;
  apiKey: string;
  model: string;
  cwd: string;
  baseUrl?: string;
}): LlmProvider {
  switch (args.provider) {
    case "codex":
      return new CodexProvider({ model: args.model, cwd: args.cwd });
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
