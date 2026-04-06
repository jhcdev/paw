import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, TextBlockParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { toolDefinitions, toolHandlers, createSafeHandlers } from "../tools.js";
import type { AgentTurnResult, LlmProvider, ToolDefinition, ToolHandler, TokenUsage } from "../types.js";
import type { SafetyConfig } from "../safety.js";

function truncLine(s: string, n = 60): string {
  const line = s.split("\n")[0].trim();
  return line.length > n ? line.slice(0, n) + "…" : line;
}

function formatToolStatus(name: string, input: Record<string, unknown>): string {
  const p = (key: string) => typeof input[key] === "string" ? input[key] as string : "";
  switch (name) {
    case "read_file": return `tool: Read ${p("path")}`;
    case "write_file": {
      const lines = p("content").split("\n").length;
      return `tool: Write ${p("path")} (${lines} lines)`;
    }
    case "edit_file": return `tool: Edit ${p("path")}`;
    case "list_files": return `tool: List ${p("path") || "."}`;
    case "search_text": return `tool: Search "${p("query")}"${p("path") ? ` in ${p("path")}` : ""}`;
    case "run_shell": return `tool: Bash ${truncLine(p("command"))}`;
    case "glob": return `tool: Glob ${p("pattern")}`;
    case "web_fetch": return `tool: Fetch ${truncLine(p("url"))}`;
    default: return `tool: ${name}`;
  }
}

function formatToolDiff(name: string, input: Record<string, unknown>): string | null {
  const p = (key: string) => typeof input[key] === "string" ? input[key] as string : "";
  if (name === "edit_file") {
    const oldLines = p("old_string").split("\n").slice(0, 3).map((l) => `  - ${truncLine(l, 70)}`);
    const newLines = p("new_string").split("\n").slice(0, 3).map((l) => `  + ${truncLine(l, 70)}`);
    const oldExtra = p("old_string").split("\n").length > 3 ? `  - … (${p("old_string").split("\n").length} lines)` : "";
    const newExtra = p("new_string").split("\n").length > 3 ? `  + … (${p("new_string").split("\n").length} lines)` : "";
    return [...oldLines, ...(oldExtra ? [oldExtra] : []), ...newLines, ...(newExtra ? [newExtra] : [])].join("\n");
  }
  return null;
}

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

  async runTurn(prompt: string, onChunk?: (chunk: string) => void, onStatus?: (status: string) => void): Promise<AgentTurnResult> {
    this.messages.push({ role: "user", content: prompt });
    let assistantText = "";
    const allTools = [...toolDefinitions, ...this.extraTools];
    const baseHandlers = { ...toolHandlers, ...this.extraHandlers };
    const allHandlers = createSafeHandlers(this.cwd, this.safetyConfig, baseHandlers);
    const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    for (let i = 0; i < 10; i++) {
      let response: Awaited<ReturnType<Anthropic["messages"]["create"]>>;
      if (onChunk) {
        // Streaming mode
        const stream = this.client.messages.stream({
          model: this.model, max_tokens: 4096, system: SYSTEM_PROMPT,
          messages: this.messages, tools: allTools,
        });

        stream.on("text", (text) => { onChunk(text); });

        response = await stream.finalMessage();
      } else {
        // Non-streaming mode
        response = await this.client.messages.create({
          model: this.model, max_tokens: 4096, system: SYSTEM_PROMPT,
          messages: this.messages, tools: allTools,
        });
      }

      totalUsage.inputTokens += response.usage.input_tokens;
      totalUsage.outputTokens += response.usage.output_tokens;
      this.messages.push({ role: "assistant", content: response.content });

      const textBlocks = response.content.filter((b) => b.type === "text");
      if (textBlocks.length > 0) assistantText = textBlocks.map((b) => b.text).join("\n");

      const toolUses = response.content.filter((b) => b.type === "tool_use");
      if (toolUses.length === 0) return { text: assistantText, usage: totalUsage };

      const toolResults: ToolResultBlockParam[] = [];
      const hookContextBlocks: TextBlockParam[] = [];
      for (const toolUse of toolUses) {
        const toolInput = toolUse.input as Record<string, unknown>;
        const toolLabel = formatToolStatus(toolUse.name, toolInput);
        const toolDiff = formatToolDiff(toolUse.name, toolInput);
        if (onStatus) onStatus(toolDiff ? `${toolLabel}\n${toolDiff}` : toolLabel);
        const toolStart = Date.now();
        const handler = allHandlers[toolUse.name];
        if (!handler) {
          toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: `Unknown tool: ${toolUse.name}` });
          continue;
        }

        // Pre-tool hook
        if (this.toolHooks?.preTool) {
          const hookResult = await this.toolHooks.preTool(toolUse.name, toolUse.input as Record<string, unknown>);
          if (hookResult.additionalContext) {
            hookContextBlocks.push({ type: "text", text: hookResult.additionalContext });
          }
          if (hookResult.blocked) {
            if (onStatus) onStatus(`${toolLabel} [blocked]`);
            toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: hookResult.reason ?? "Blocked by hook" });
            continue;
          }
        }

        try {
          const result = await handler(toolUse.input as Record<string, unknown>, this.cwd);
          const elapsed = ((Date.now() - toolStart) / 1000).toFixed(1);
          const brief = toolUse.name === "run_shell" ? (result.isError ? "[error]" : "[ok]") : "";
          if (onStatus) onStatus(`${toolLabel} ${brief} (${elapsed}s)`);
          const tr: ToolResultBlockParam = { type: "tool_result", tool_use_id: toolUse.id, content: result.content };
          if (result.isError) tr.is_error = true;
          toolResults.push(tr);

          // Post-tool hook
          if (this.toolHooks?.postTool) {
            const hookResult = await this.toolHooks.postTool(toolUse.name, toolUse.input as Record<string, unknown>, result);
            if (hookResult.additionalContext) {
              hookContextBlocks.push({ type: "text", text: hookResult.additionalContext });
            }
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
      this.messages.push({ role: "user", content: [...toolResults, ...hookContextBlocks] });
    }
    return { text: assistantText || "Stopped after reaching the tool iteration limit.", usage: totalUsage };
  }
}
