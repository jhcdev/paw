export type ProviderName = "anthropic" | "codex" | "ollama";

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type AgentTurnResult = {
  text: string;
  usage?: TokenUsage;
};

export interface LlmProvider {
  runTurn(prompt: string): Promise<AgentTurnResult>;
  clear(): void;
}

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type ToolResult = {
  isError?: boolean;
  content: string;
};

export type ToolHandler = (input: Record<string, unknown>, cwd: string) => Promise<ToolResult>;
