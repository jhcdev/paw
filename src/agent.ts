import { McpManager, type McpServerEntry } from "./mcp.js";
import { UsageTracker } from "./usage-tracker.js";
import { MultiProvider, detectProviders } from "./multi-provider.js";
import { TeamRunner, autoConfigureTeam } from "./team.js";
import { createProvider } from "./providers/index.js";
import type { AgentTurnResult, LlmProvider, ProviderName, ToolDefinition, ToolHandler, TokenUsage } from "./types.js";

export class CodingAgent {
  private provider: LlmProvider;
  private readonly mcpManager: McpManager;
  private readonly multi: MultiProvider;
  private readonly team: TeamRunner;
  private currentProvider: ProviderName;
  private currentModel: string;
  private readonly cwd: string;
  private mcpReady = false;
  private totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  readonly tracker = new UsageTracker();

  constructor(args: { provider: ProviderName; apiKey: string; model: string; cwd: string; baseUrl?: string }) {
    this.mcpManager = new McpManager();
    this.provider = createProvider(args);
    this.currentProvider = args.provider;
    this.currentModel = args.model;
    this.cwd = args.cwd;
    this.multi = new MultiProvider(args.cwd);
    this.multi.register(args.provider, args.apiKey, args.model, args.baseUrl);
    this.team = new TeamRunner(args.cwd);
  }

  async initTeam(): Promise<void> {
    const { config: loadEnv } = await import("dotenv");
    loadEnv({ quiet: true });
    const detected = await detectProviders(process.env as Record<string, string | undefined>);
    // Register all detected providers for multi/team use
    for (const p of detected) {
      if (p.provider !== this.currentProvider) {
        this.multi.register(p.provider, p.apiKey, p.model, p.baseUrl);
      }
    }
    const teamConfig = await autoConfigureTeam(detected);
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
    try {
      const result = await this.provider.runTurn(prompt);
      this.totalUsage.inputTokens += result.usage?.inputTokens ?? 0;
      this.totalUsage.outputTokens += result.usage?.outputTokens ?? 0;
      this.tracker.record(this.currentProvider, this.currentModel, result.usage?.inputTokens ?? 0, result.usage?.outputTokens ?? 0);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      const isRetryable = lower.includes("rate limit") || lower.includes("429") ||
        lower.includes("overloaded") || lower.includes("401") || lower.includes("403") ||
        lower.includes("billing") || lower.includes("credit") || lower.includes("quota");

      if (isRetryable) {
        const originalProvider = this.currentProvider;
        const registered = this.multi.getRegistered();
        for (const alt of registered) {
          if (alt.name !== originalProvider) {
            const switched = this.switchProvider(alt.name);
            if (switched.ok) {
              const fallbackResult = await this.provider.runTurn(prompt);
              this.totalUsage.inputTokens += fallbackResult.usage?.inputTokens ?? 0;
              this.totalUsage.outputTokens += fallbackResult.usage?.outputTokens ?? 0;
              this.switchProvider(originalProvider);
              return { ...fallbackResult, text: `[Fallback: ${alt.name}/${alt.model}]\n${fallbackResult.text}` };
            }
          }
        }
      }
      throw err;
    }
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

  getActiveProvider(): ProviderName {
    return this.currentProvider;
  }

  getActiveModel(): string {
    return this.currentModel;
  }

  setEffort(effort: string): void {
    if ("setEffort" in this.provider && typeof (this.provider as any).setEffort === "function") {
      (this.provider as any).setEffort(effort);
    }
  }

  getEffort(): string {
    if ("getEffort" in this.provider && typeof (this.provider as any).getEffort === "function") {
      return (this.provider as any).getEffort();
    }
    return "medium";
  }

  /** Switch the active provider and model. Returns true if successful. */
  switchProvider(provider: ProviderName, model?: string): { ok: boolean; error?: string } {
    const registered = this.multi.getRegistered();
    const entry = registered.find((r) => r.name === provider);
    if (!entry) {
      return { ok: false, error: `Provider "${provider}" not configured. Available: ${registered.map((r) => r.name).join(", ")}` };
    }
    const targetModel = model ?? entry.model;
    const config = this.multi.getProviderConfig(provider);
    if (!config) {
      return { ok: false, error: `Provider "${provider}" not found in registry.` };
    }
    this.provider = createProvider({
      provider,
      apiKey: config.apiKey,
      model: targetModel,
      cwd: this.cwd,
      baseUrl: config.baseUrl,
    });
    this.currentProvider = provider;
    this.currentModel = targetModel;

    // Re-inject MCP tools if available
    if (this.mcpReady) {
      const defs = this.mcpManager.getToolDefinitions();
      const handlers = this.mcpManager.getToolHandlers();
      if (defs.length > 0 && "addExternalTools" in this.provider) {
        (this.provider as LlmProviderWithExternalTools).addExternalTools(defs, handlers);
      }
    }

    return { ok: true };
  }

  getProviderKeys(): Map<string, { apiKey: string; baseUrl?: string }> {
    const map = new Map<string, { apiKey: string; baseUrl?: string }>();
    for (const reg of this.multi.getRegistered()) {
      const cfg = this.multi.getProviderConfig(reg.name);
      if (cfg) map.set(reg.name, { apiKey: cfg.apiKey, baseUrl: cfg.baseUrl });
    }
    return map;
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
