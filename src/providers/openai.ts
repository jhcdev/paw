import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { toolDefinitions, toolHandlers } from "../tools.js";
import type { AgentTurnResult, LlmProvider, ToolDefinition, ToolHandler, TokenUsage } from "../types.js";

const SYSTEM_PROMPT = `You are Paw, a terminal coding assistant.\nWork step by step, prefer inspecting files before editing, and use tools when needed.\nKeep tool inputs minimal and precise.\nAssume the workspace root is the allowed boundary.`;

function toOpenAITools(extra: ToolDefinition[] = []): ChatCompletionTool[] {
  return [...toolDefinitions, ...extra].map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

export class OpenAIProvider implements LlmProvider {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly cwd: string;
  private readonly messages: ChatCompletionMessageParam[] = [];
  private extraTools: ToolDefinition[] = [];
  private extraHandlers: Record<string, ToolHandler> = {};

  constructor(args: { apiKey: string; model: string; cwd: string; baseUrl?: string }) {
    this.client = new OpenAI({ apiKey: args.apiKey, ...(args.baseUrl ? { baseURL: args.baseUrl } : {}) });
    this.model = args.model;
    this.cwd = args.cwd;
    this.messages.push({ role: "system", content: SYSTEM_PROMPT });
  }

  addExternalTools(defs: ToolDefinition[], handlers: Record<string, ToolHandler>): void {
    this.extraTools.push(...defs);
    Object.assign(this.extraHandlers, handlers);
  }

  clear(): void {
    this.messages.length = 0;
    this.messages.push({ role: "system", content: SYSTEM_PROMPT });
  }

  async runTurn(prompt: string, onChunk?: (chunk: string) => void): Promise<AgentTurnResult> {
    this.messages.push({ role: "user", content: prompt });
    let assistantText = "";
    const allHandlers = { ...toolHandlers, ...this.extraHandlers };
    const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    for (let i = 0; i < 10; i++) {
      if (onChunk) {
        // Streaming mode
        const stream = await this.client.chat.completions.create({
          model: this.model,
          messages: this.messages,
          tools: toOpenAITools(this.extraTools),
          max_tokens: 4096,
          stream: true,
        });

        let content = "";
        const toolCalls: { id: string; name: string; arguments: string }[] = [];
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;
          if (delta.content) {
            content += delta.content;
            onChunk(delta.content);
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.index !== undefined) {
                while (toolCalls.length <= tc.index) toolCalls.push({ id: "", name: "", arguments: "" });
                if (tc.id) toolCalls[tc.index].id = tc.id;
                if (tc.function?.name) toolCalls[tc.index].name = tc.function.name;
                if (tc.function?.arguments) toolCalls[tc.index].arguments += tc.function.arguments;
              }
            }
          }
          if (chunk.usage) {
            totalUsage.inputTokens += chunk.usage.prompt_tokens ?? 0;
            totalUsage.outputTokens += chunk.usage.completion_tokens ?? 0;
          }
        }

        if (content) assistantText = content;
        const message: any = { role: "assistant" as const, content: content || null };
        if (toolCalls.length > 0) {
          message.tool_calls = toolCalls.map(tc => ({
            id: tc.id, type: "function" as const,
            function: { name: tc.name, arguments: tc.arguments },
          }));
        }
        this.messages.push(message);

        if (toolCalls.length === 0) return { text: assistantText, usage: totalUsage };

        for (const toolCall of toolCalls) {
          const handler = allHandlers[toolCall.name];
          if (!handler) {
            this.messages.push({ role: "tool", tool_call_id: toolCall.id, content: `Unknown tool: ${toolCall.name}` });
            continue;
          }
          try {
            const args = JSON.parse(toolCall.arguments) as Record<string, unknown>;
            const result = await handler(args, this.cwd);
            this.messages.push({ role: "tool", tool_call_id: toolCall.id, content: result.content });
          } catch (error) {
            this.messages.push({ role: "tool", tool_call_id: toolCall.id, content: error instanceof Error ? error.message : String(error) });
          }
        }
        continue;
      }

      // Non-streaming mode
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: this.messages,
        tools: toOpenAITools(this.extraTools),
        max_tokens: 4096,
      });

      totalUsage.inputTokens += response.usage?.prompt_tokens ?? 0;
      totalUsage.outputTokens += response.usage?.completion_tokens ?? 0;

      const choice = response.choices[0];
      if (!choice) return { text: assistantText || "(empty response)", usage: totalUsage };

      const message = choice.message;
      this.messages.push(message);

      if (message.content) {
        assistantText = message.content;
      }

      const toolCalls = message.tool_calls;
      if (!toolCalls || toolCalls.length === 0) return { text: assistantText, usage: totalUsage };

      for (const toolCall of toolCalls) {
        const handler = allHandlers[toolCall.function.name];
        if (!handler) {
          this.messages.push({ role: "tool", tool_call_id: toolCall.id, content: `Unknown tool: ${toolCall.function.name}` });
          continue;
        }
        try {
          const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
          const result = await handler(args, this.cwd);
          this.messages.push({ role: "tool", tool_call_id: toolCall.id, content: result.content });
        } catch (error) {
          this.messages.push({ role: "tool", tool_call_id: toolCall.id, content: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    return { text: assistantText || "Stopped after reaching the tool iteration limit.", usage: totalUsage };
  }
}
