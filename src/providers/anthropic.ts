import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { toolDefinitions, toolHandlers } from "../tools.js";
import type { AgentTurnResult, LlmProvider, ToolDefinition, ToolHandler, TokenUsage } from "../types.js";

const SYSTEM_PROMPT = `You are Cat's Claw, a terminal coding assistant.\nWork step by step, prefer inspecting files before editing, and use tools when needed.\nKeep tool inputs minimal and precise.\nAssume the workspace root is the allowed boundary.`;

export class AnthropicProvider implements LlmProvider {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly cwd: string;
  private readonly messages: MessageParam[] = [];
  private extraTools: ToolDefinition[] = [];
  private extraHandlers: Record<string, ToolHandler> = {};

  constructor(args: { apiKey: string; model: string; cwd: string }) {
    this.client = new Anthropic({ apiKey: args.apiKey });
    this.model = args.model;
    this.cwd = args.cwd;
  }

  addExternalTools(defs: ToolDefinition[], handlers: Record<string, ToolHandler>): void {
    this.extraTools.push(...defs);
    Object.assign(this.extraHandlers, handlers);
  }

  clear(): void {
    this.messages.length = 0;
  }

  async runTurn(prompt: string): Promise<AgentTurnResult> {
    this.messages.push({ role: "user", content: prompt });
    let assistantText = "";
    const allTools = [...toolDefinitions, ...this.extraTools];
    const allHandlers = { ...toolHandlers, ...this.extraHandlers };
    const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    for (let i = 0; i < 10; i++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: this.messages,
        tools: allTools,
      });

      totalUsage.inputTokens += response.usage.input_tokens;
      totalUsage.outputTokens += response.usage.output_tokens;

      this.messages.push({ role: "assistant", content: response.content });

      const textBlocks = response.content.filter((b) => b.type === "text");
      if (textBlocks.length > 0) {
        assistantText = textBlocks.map((b) => b.text).join("\n");
      }

      const toolUses = response.content.filter((b) => b.type === "tool_use");
      if (toolUses.length === 0) return { text: assistantText, usage: totalUsage };

      const toolResults: ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const handler = allHandlers[toolUse.name];
        if (!handler) {
          toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: `Unknown tool: ${toolUse.name}` });
          continue;
        }
        try {
          const result = await handler(toolUse.input as Record<string, unknown>, this.cwd);
          const tr: ToolResultBlockParam = { type: "tool_result", tool_use_id: toolUse.id, content: result.content };
          if (result.isError) tr.is_error = true;
          toolResults.push(tr);
        } catch (error) {
          toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: error instanceof Error ? error.message : String(error) });
        }
      }

      this.messages.push({ role: "user", content: toolResults });
    }

    return { text: assistantText || "Stopped after reaching the tool iteration limit.", usage: totalUsage };
  }
}
