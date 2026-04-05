import { McpManager, type McpServerEntry } from "./mcp.js";
import { UsageTracker } from "./usage-tracker.js";
import { ActivityLog } from "./activity-log.js";
import { MultiProvider, detectProviders } from "./multi-provider.js";
import { TeamRunner, autoConfigureTeam } from "./team.js";
import { createProvider } from "./providers/index.js";
import { HookManager } from "./hooks.js";
import { Verifier } from "./verify.js";
import { loadMemory } from "./memory.js";
import { shouldCompact, buildCompactionPrompt, buildCompactedMessages, type CompactionMessage } from "./compaction.js";
import type { AgentTurnResult, LlmProvider, ProviderName, ToolDefinition, ToolHandler, TokenUsage } from "./types.js";
import type { SafetyConfig } from "./safety.js";

export class CodingAgent {
  private provider: LlmProvider;
  private readonly mcpManager: McpManager;
  private readonly multi: MultiProvider;
  private readonly team: TeamRunner;
  private readonly hooks: HookManager;
  private currentProvider: ProviderName;
  private currentModel: string;
  private readonly cwd: string;
  private mcpReady = false;
  private memoryContext = "";
  private memoryInjected = false;
  private totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  private detectedProviders?: { provider: ProviderName; apiKey: string; model: string; baseUrl?: string }[];
  private verifyEnabled = false;
  private safetyConfig: SafetyConfig = { enabled: true, autoCheckpoint: true, blockCritical: true };
  readonly tracker = new UsageTracker();
  readonly activityLog = new ActivityLog();
  readonly verifier: Verifier;

  constructor(args: { provider: ProviderName; apiKey: string; model: string; cwd: string; baseUrl?: string; detected?: { provider: ProviderName; apiKey: string; model: string; baseUrl?: string }[] }) {
    this.mcpManager = new McpManager();
    this.provider = createProvider(args);
    this.currentProvider = args.provider;
    this.currentModel = args.model;
    this.cwd = args.cwd;
    this.multi = new MultiProvider(args.cwd);
    this.multi.register(args.provider, args.apiKey, args.model, args.baseUrl);
    this.team = new TeamRunner(args.cwd);
    this.hooks = new HookManager(args.cwd);
    this.detectedProviders = args.detected;
    this.verifier = new Verifier(this.multi, args.provider, args.cwd);
    this.wireToolHooks();
  }

  async initTeam(): Promise<void> {
    const { config: loadEnv } = await import("dotenv");
    loadEnv({ quiet: true });
    const detected = this.detectedProviders ?? await detectProviders(process.env as Record<string, string | undefined>);
    // Register all detected providers for multi/team use
    for (const p of detected) {
      if (p.provider !== this.currentProvider) {
        this.multi.register(p.provider, p.apiKey, p.model, p.baseUrl);
      }
    }
    const teamConfig = await autoConfigureTeam(detected);
    this.team.configure(teamConfig);
    await this.hooks.load();
  }

  getHooks(): HookManager {
    return this.hooks;
  }

  /** Restore conversation history from a session into the provider */
  restoreHistory(entries: { role: "user" | "assistant" | "system"; text: string }[]): void {
    for (const entry of entries) {
      if (entry.role === "user") {
        // Inject as a fake turn so the provider has context
        if ("messages" in this.provider && Array.isArray((this.provider as any).messages)) {
          (this.provider as any).messages.push({ role: "user", content: entry.text });
        }
      } else if (entry.role === "assistant") {
        if ("messages" in this.provider && Array.isArray((this.provider as any).messages)) {
          (this.provider as any).messages.push({ role: "assistant", content: [{ type: "text", text: entry.text }] });
        }
      }
    }
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
    this.memoryInjected = false;
  }

  async loadMemoryContext(): Promise<string> {
    const { context } = await loadMemory(this.cwd);
    this.memoryContext = context;
    return context;
  }

  /** Compact conversation history using AI summarization */
  async compact(focus?: string): Promise<{ summary: string; droppedCount: number } | null> {
    // Get current messages from provider
    if (!("messages" in this.provider) || !Array.isArray((this.provider as any).messages)) {
      return null; // Provider doesn't support message access
    }
    const messages = (this.provider as any).messages as { role: string; content: unknown }[];

    // Convert to CompactionMessage format
    const compactionMsgs: CompactionMessage[] = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        text: typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? m.content.map((c: any) => c.text ?? "").join("")
            : String(m.content),
      }));

    const { prompt, toSummarize, toKeep } = buildCompactionPrompt(compactionMsgs, 8, focus);
    if (!prompt || toSummarize.length === 0) return null;

    // Use the provider itself to generate the summary
    const result = await this.provider.runTurn(prompt);
    const summary = result.text;

    // Rebuild messages: clear and re-add
    this.provider.clear();

    // Re-inject memory context
    const compacted = buildCompactedMessages(summary, toKeep, this.memoryContext);
    for (const msg of compacted) {
      if (msg.role === "user") {
        (this.provider as any).messages.push({ role: "user", content: msg.text });
      } else if (msg.role === "assistant") {
        (this.provider as any).messages.push({ role: "assistant", content: [{ type: "text", text: msg.text }] });
      }
    }
    this.memoryInjected = true; // Memory was re-injected via compacted messages

    return { summary, droppedCount: toSummarize.length };
  }

  /** Check if auto-compaction should trigger */
  shouldAutoCompact(): boolean {
    if (!("messages" in this.provider) || !Array.isArray((this.provider as any).messages)) {
      return false;
    }
    return shouldCompact((this.provider as any).messages.length);
  }

  async runTurn(prompt: string, onChunk?: (chunk: string) => void, onStatus?: (status: string) => void): Promise<AgentTurnResult> {
    // Inject memory context on first turn of session
    if (!this.memoryInjected && this.memoryContext) {
      prompt = `[Context]\n${this.memoryContext}\n\n[User]\n${prompt}`;
      this.memoryInjected = true;
    }
    const preResults = await this.hooks.run("pre-turn", { prompt }).catch(() => []);
    const hookContext = preResults.filter(r => r.additionalContext).map(r => r.additionalContext).join("\n");
    if (hookContext) prompt = hookContext + "\n\n" + prompt;
    const actId = this.activityLog.start("agent", "thinking", prompt.slice(0, 50));
    this.activityLog.log(actId, "prompt", prompt);
    try {
      const result = await this.provider.runTurn(prompt, onChunk, onStatus);
      this.totalUsage.inputTokens += result.usage?.inputTokens ?? 0;
      this.totalUsage.outputTokens += result.usage?.outputTokens ?? 0;
      this.tracker.record(this.currentProvider, this.currentModel, result.usage?.inputTokens ?? 0, result.usage?.outputTokens ?? 0);
      await this.hooks.run("post-turn", { response: result.text }).catch(() => []);
      this.activityLog.log(actId, "response", result.text);
      this.activityLog.finish(actId, result.text.slice(0, 100));

      if (this.verifyEnabled && this.verifier.hasPendingChanges()) {
        const vr = await this.verifier.verify().catch(() => null);
        this.verifier.clear();
        if (vr) {
          const lines: string[] = [
            "---",
            `Verification (by ${vr.provider}):`,
            `  Confidence: ${vr.confidence}/100`,
          ];
          if (vr.issues.length === 0) {
            lines.push("  No issues found");
          } else {
            for (const issue of vr.issues) {
              const prefix = issue.severity === "error" ? "[error]" : issue.severity === "warning" ? "[warn] " : "[info] ";
              lines.push(`  ${prefix} ${issue.file}: ${issue.description}`);
            }
          }
          lines.push("---");
          return { ...result, text: result.text + "\n" + lines.join("\n") };
        }
      }

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.hooks.run("on-error", { error: msg }).catch(() => []);
      this.activityLog.fail(actId, msg);
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
              const fbId = this.activityLog.start("agent", "fallback", alt.name);
              this.activityLog.log(fbId, "info", `Fallback from ${originalProvider} due to: ${msg}`);
              const fallbackResult = await this.provider.runTurn(prompt);
              this.totalUsage.inputTokens += fallbackResult.usage?.inputTokens ?? 0;
              this.totalUsage.outputTokens += fallbackResult.usage?.outputTokens ?? 0;
              this.switchProvider(originalProvider);
              this.activityLog.log(fbId, "response", fallbackResult.text);
              this.activityLog.finish(fbId);
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

  enableVerify(enabled: boolean): void {
    this.verifyEnabled = enabled;
  }

  isVerifyEnabled(): boolean {
    return this.verifyEnabled;
  }

  setVerifyProvider(provider: ProviderName | null, model?: string | null, effort?: string | null): void {
    this.verifier.setProvider(provider, model, effort);
  }

  getVerifyProvider(): ProviderName | null {
    return this.verifier.getProvider();
  }

  setSafetyConfig(config: Partial<SafetyConfig>): void {
    this.safetyConfig = { ...this.safetyConfig, ...config };
    if ("setSafetyConfig" in this.provider && typeof (this.provider as any).setSafetyConfig === "function") {
      (this.provider as any).setSafetyConfig(this.safetyConfig);
    }
  }

  getSafetyConfig(): SafetyConfig {
    return { ...this.safetyConfig };
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

    this.wireToolHooks();
    return { ok: true };
  }

  private wireToolHooks(): void {
    if ("setToolHooks" in this.provider && typeof (this.provider as any).setToolHooks === "function") {
      (this.provider as any).setToolHooks({
        preTool: async (toolName: string, input: Record<string, unknown>) => {
          const results = await this.hooks.run("pre-tool", { tool_name: toolName, tool_input: input }, toolName).catch(() => []);
          const blocked = results.some(r => r.blocked);
          const reason = results.find(r => r.blocked)?.stderr || "Blocked by hook";
          const additionalContext = results.filter(r => r.additionalContext).map(r => r.additionalContext).join("\n") || undefined;
          return { blocked, reason, additionalContext };
        },
        postTool: async (toolName: string, input: Record<string, unknown>, result: { content: string; isError?: boolean }) => {
          const results = await this.hooks.run("post-tool", { tool_name: toolName, tool_input: input, tool_result: result }, toolName).catch(() => []);
          const additionalContext = results.filter(r => r.additionalContext).map(r => r.additionalContext).join("\n") || undefined;
          return { additionalContext };
        },
        postToolFailure: async (toolName: string, input: Record<string, unknown>, error: string) => {
          await this.hooks.run("post-tool-failure", { tool_name: toolName, tool_input: input, error }, toolName).catch(() => []);
        },
      });
    }
  }

  async runStopHook(): Promise<{ blocked: boolean; reason?: string }> {
    const results = await this.hooks.run("stop", {}).catch(() => []);
    const blocked = results.some(r => r.blocked);
    const reason = results.find(r => r.blocked)?.stderr;
    return { blocked, reason };
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
