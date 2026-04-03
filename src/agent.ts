import { McpManager, type McpServerEntry } from "./mcp.js";
import { MultiProvider, detectProviders } from "./multi-provider.js";
import { TeamRunner, autoConfigureTeam } from "./team.js";
import { createProvider } from "./providers/index.js";
import type { AgentTurnResult, LlmProvider, ProviderName, ToolDefinition, ToolHandler, TokenUsage } from "./types.js";

export class CodingAgent {
  private readonly provider: LlmProvider;
  private readonly mcpManager: McpManager;
  private readonly multi: MultiProvider;
  private readonly team: TeamRunner;
  private readonly primaryProvider: ProviderName;
  private mcpReady = false;
  private totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  constructor(args: { provider: ProviderName; apiKey: string; model: string; cwd: string; baseUrl?: string }) {
    this.mcpManager = new McpManager();
    this.provider = createProvider(args);
    this.primaryProvider = args.provider;
    this.multi = new MultiProvider(args.cwd);
    this.multi.register(args.provider, args.apiKey, args.model, args.baseUrl);
    this.team = new TeamRunner(args.cwd);

    // Auto-detect other providers from env
    const detected = detectProviders(process.env as Record<string, string | undefined>);
    for (const p of detected) {
      if (p.provider !== args.provider) {
        this.multi.register(p.provider, p.apiKey, p.model, p.baseUrl);
      }
    }

    // Auto-configure team
    const teamConfig = autoConfigureTeam(detected);
    this.team.configure(teamConfig);
  }

  async initMcp(cwd: string): Promise<void> {
    await this.mcpManager.loadAndConnect(cwd);
    this.mcpReady = true;
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

  getMulti(): MultiProvider {
    return this.multi;
  }

  getTeam(): TeamRunner {
    return this.team;
  }

  getPrimaryProvider(): ProviderName {
    return this.primaryProvider;
  }

  getMcpStatus(): { name: string; toolCount: number }[] {
    return this.mcpManager.getStatus();
  }

  getMcpTools(): ToolDefinition[] {
    return this.mcpManager.getToolDefinitions();
  }

  async getMcpFullStatus(): Promise<McpServerEntry[]> {
    return this.mcpManager.getFullStatus();
  }

  async addMcpServer(name: string, config: { command: string; args?: string[]; env?: Record<string, string> }): Promise<{ ok: boolean; error?: string }> {
    const result = await this.mcpManager.addServer(name, config);
    if (result.ok) {
      const defs = this.mcpManager.getToolDefinitions();
      const handlers = this.mcpManager.getToolHandlers();
      if (defs.length > 0 && "addExternalTools" in this.provider) {
        (this.provider as LlmProviderWithExternalTools).addExternalTools(defs, handlers);
      }
    }
    return result;
  }

  async removeMcpServer(name: string): Promise<void> {
    await this.mcpManager.removeServer(name);
  }

  async shutdown(): Promise<void> {
    await this.mcpManager.disconnect();
  }
}

interface LlmProviderWithExternalTools extends LlmProvider {
  addExternalTools(defs: ToolDefinition[], handlers: Record<string, ToolHandler>): void;
}
