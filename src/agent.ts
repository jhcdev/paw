import { McpManager } from "./mcp.js";
import { createProvider } from "./providers/index.js";
import type { AgentTurnResult, LlmProvider, ProviderName, ToolDefinition, ToolHandler, TokenUsage } from "./types.js";

export class CodingAgent {
  private readonly provider: LlmProvider;
  private readonly mcpManager: McpManager;
  private mcpReady = false;
  private totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  constructor(args: { provider: ProviderName; apiKey: string; model: string; cwd: string; baseUrl?: string }) {
    this.mcpManager = new McpManager();
    this.provider = createProvider(args);
  }

  async initMcp(cwd: string): Promise<void> {
    await this.mcpManager.loadAndConnect(cwd);
    this.mcpReady = true;

    // Inject MCP tools into the provider if it supports it
    const defs = this.mcpManager.getToolDefinitions();
    const handlers = this.mcpManager.getToolHandlers();
    if (defs.length > 0 && "addExternalTools" in this.provider) {
      (this.provider as LlmProviderWithExternalTools).addExternalTools(defs, handlers);
    }
  }

  clear(): void {
    this.provider.clear();
  }

  async runTurn(prompt: string): Promise<AgentTurnResult> {
    const result = await this.provider.runTurn(prompt);
    this.totalUsage.inputTokens += result.usage?.inputTokens ?? 0;
    this.totalUsage.outputTokens += result.usage?.outputTokens ?? 0;
    return result;
  }

  getUsage(): TokenUsage {
    return { ...this.totalUsage };
  }

  getMcpStatus(): { name: string; toolCount: number }[] {
    return this.mcpManager.getStatus();
  }

  getMcpTools(): ToolDefinition[] {
    return this.mcpManager.getToolDefinitions();
  }

  async shutdown(): Promise<void> {
    await this.mcpManager.disconnect();
  }
}

interface LlmProviderWithExternalTools extends LlmProvider {
  addExternalTools(defs: ToolDefinition[], handlers: Record<string, ToolHandler>): void;
}
