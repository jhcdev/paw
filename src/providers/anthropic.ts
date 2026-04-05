import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { toolDefinitions, toolHandlers, createSafeHandlers } from "../tools.js";
import type { AgentTurnResult, LlmProvider, ToolDefinition, ToolHandler, TokenUsage } from "../types.js";
import type { SafetyConfig } from "../safety.js";

const SYSTEM_PROMPT = `You are Paw, a terminal coding assistant.\nWork step by step, prefer inspecting files before editing, and use tools when needed.\nKeep tool inputs minimal and precise.\nAssume the workspace root is the allowed boundary.`;

export type ToolHookCallback = {
  preTool?: (toolName: string, input: Record<string, unknown>) => Promise<{ blocked: boolean; reason?: string; additionalContext?: string }>;
  postTool?: (toolName: string, input: Record<string, unknown>, result: { content: string; isError?: boolean }) => Promise<{ additionalContext?: string }>;
  postToolFailure?: (toolName: string, input: Record<string, unknown>, error: string) => Promise<void>;
};

export class AnthropicProvider implements LlmProvider {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly cwd: string;
  private readonly messages: MessageParam[] = [];
  private extraTools: ToolDefinition[] = [];
  private extraHandlers: Record<string, ToolHandler> = {};
  private safetyConfig: SafetyConfig = { enabled: true, autoCheckpoint: true, blockCritical: true };
  private toolHooks: ToolHookCallback = {};

  constructor(args: { apiKey: string; model: string; cwd: string }) {
    this.client = new Anthropic({ apiKey: args.apiKey });
    this.model = args.model;
    this.cwd = args.cwd;
  }

  addExternalTools(defs: ToolDefinition[], handlers: Record<string, ToolHandler>): void {
    this.extraTools.push(...defs);
    Object.assign(this.extraHandlers, handlers);
  }

  setSafetyConfig(config: SafetyConfig): void {
    this.safetyConfig = config;
  }

  setToolHooks(hooks: ToolHookCallback): void {
    this.toolHooks = hooks;
  }

  clear(): void { this.messages.length = 0; }

  async runTurn(prompt: string): Promise<AgentTurnResult> {
    this.messages.push({ role: "user", content: prompt });
    let assistantText = "";
    const allTools = [...toolDefinitions, ...this.extraTools];
    const baseHandlers = { ...toolHandlers, ...this.extraHandlers };
    const allHandlers = createSafeHandlers(this.cwd, this.safetyConfig, baseHandlers);
    const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    for (let i = 0; i < 10; i++) {
      const response = await this.client.messages.create({
        model: this.model, max_tokens: 4096, system: SYSTEM_PROMPT,
        messages: this.messages, tools: allTools,
      });
      totalUsage.inputTokens += response.usage.input_tokens;
      totalUsage.outputTokens += response.usage.output_tokens;
      this.messages.push({ role: "assistant", content: response.content });

      const textBlocks = response.content.filter((b) => b.type === "text");
      if (textBlocks.length > 0) assistantText = textBlocks.map((b) => b.text).join("\n");

      const toolUses = response.content.filter((b) => b.type === "tool_use");
      if (toolUses.length === 0) return { text: assistantText, usage: totalUsage };

      const toolResults: ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const handler = allHandlers[toolUse.name];
        if (!handler) {
          toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: `Unknown tool: ${toolUse.name}` });
          continue;
        }

        // Pre-tool hook
        if (this.toolHooks?.preTool) {
          const hookResult = await this.toolHooks.preTool(toolUse.name, toolUse.input as Record<string, unknown>);
          if (hookResult.blocked) {
            toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: hookResult.reason ?? "Blocked by hook" });
            continue;
          }
        }

        try {
          const result = await handler(toolUse.input as Record<string, unknown>, this.cwd);
          const tr: ToolResultBlockParam = { type: "tool_result", tool_use_id: toolUse.id, content: result.content };
          if (result.isError) tr.is_error = true;
          toolResults.push(tr);

          // Post-tool hook
          if (this.toolHooks?.postTool) {
            await this.toolHooks.postTool(toolUse.name, toolUse.input as Record<string, unknown>, result);
          }
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: errMsg });

          // Post-tool failure hook
          if (this.toolHooks?.postToolFailure) {
            await this.toolHooks.postToolFailure(toolUse.name, toolUse.input as Record<string, unknown>, errMsg);
          }
        }
      }
      this.messages.push({ role: "user", content: toolResults });
    }
    return { text: assistantText || "Stopped after reaching the tool iteration limit.", usage: totalUsage };
  }
}
