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

export type OnChunkCallback = (chunk: string) => void;
export type OnStatusCallback = (status: string) => void;

export interface LlmProvider {
  runTurn(prompt: string, onChunk?: OnChunkCallback, onStatus?: OnStatusCallback): Promise<AgentTurnResult>;
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

/** Generic interactive prompt shown to user during agent execution */
export type UserPromptChoice = {
  label: string;
  value: string;
};

export type UserPrompt = {
  title: string;
  message: string;
  detail?: string;
  choices: UserPromptChoice[];
  /** If true, the last choice opens a free-text input */
  allowCustom?: boolean;
};

export type UserPromptResult = {
  /** The value of the selected choice, or "__custom__" for free-text */
  value: string;
  /** Custom text if user chose free-text input */
  customText?: string;
};

export type UserPromptCallback = (prompt: UserPrompt) => Promise<UserPromptResult>;
