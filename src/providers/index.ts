import type { LlmProvider, ProviderName } from "../types.js";
import { AnthropicProvider } from "./anthropic.js";
import { ClaudeCliProvider } from "./claude-cli.js";
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
    case "anthropic":
      // Use CLI if Claude Code is installed (no rate limit sharing)
      // Fall back to SDK if API key is provided
      if (!args.apiKey || args.apiKey.startsWith("sk-ant-oat")) {
        return new ClaudeCliProvider({ model: args.model, cwd: args.cwd });
      }
      return new AnthropicProvider(args);
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
