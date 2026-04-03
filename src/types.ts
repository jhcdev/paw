export type ProviderName = "anthropic" | "openai" | "gemini" | "groq" | "openrouter" | "ollama";

export type AgentTurnResult = {
  text: string;
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
