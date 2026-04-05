import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { createProvider } from "./providers/index.js";
import type { ProviderName } from "./types.js";

const execAsync = promisify(exec);

export type SpawnedTask = {
  id: number;
  goal: string;
  provider: ProviderName;
  model: string;
  status: "queued" | "running" | "done" | "failed";
  result?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  ms?: number;
};

export type SpawnConfig = {
  provider: ProviderName;
  apiKey: string;
  model: string;
  cwd: string;
  baseUrl?: string;
};

export class SpawnManager {
  private tasks: SpawnedTask[] = [];
  private nextId = 1;
  private configs: SpawnConfig[] = [];
  private cwd: string;
  private onUpdate: (task: SpawnedTask) => void;
  private getDefaultConfig?: () => SpawnConfig | null;

  constructor(cwd: string, onUpdate: (task: SpawnedTask) => void, getDefaultConfig?: () => SpawnConfig | null) {
    this.cwd = cwd;
    this.onUpdate = onUpdate;
    this.getDefaultConfig = getDefaultConfig;
  }

  /** Register available provider configs for round-robin distribution */
  addConfig(config: SpawnConfig): void {
    this.configs.push(config);
  }

  /** Spawn a new agent for a task. Returns the task id.
   *  preferredProvider: override provider name
   *  preferredModel: override model (creates a new config with the same apiKey)
   *  sessionContext: recent conversation context to inject */
  spawn(goal: string, preferredProvider?: ProviderName, preferredModel?: string, sessionContext?: string): number {
    const id = this.nextId++;

    // Pick provider: preferred > round-robin > current active model
    const allConfigs = this.configs.length > 0 ? this.configs : (() => {
      const def = this.getDefaultConfig?.();
      return def ? [def] : [];
    })();

    let config = preferredProvider
      ? allConfigs.find((c) => c.provider === preferredProvider) ??
        allConfigs[0]!
      : allConfigs[(id - 1) % allConfigs.length]!;

    // Override model if specified
    if (preferredModel && config) {
      config = { ...config, model: preferredModel };
    }

    const task: SpawnedTask = {
      id,
      goal,
      provider: config.provider,
      model: config.model,
      status: "queued",
    };

    this.tasks.push(task);
    this.onUpdate(task);

    // Run async — don't await
    this.runTask(task, config, sessionContext).catch(() => {});

    return id;
  }

  private async runTask(task: SpawnedTask, config: SpawnConfig, sessionContext?: string): Promise<void> {
    task.status = "running";
    task.startedAt = Date.now();
    this.onUpdate(task);

    try {
      const provider = createProvider({
        provider: config.provider,
        apiKey: config.apiKey,
        model: config.model,
        cwd: this.cwd,
        baseUrl: config.baseUrl,
      });

      // Build a rich context prompt
      let projectContext = "";
      try {
        const { stdout } = await execAsync(
          "find . -maxdepth 3 -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' | head -25",
          { cwd: this.cwd },
        );
        projectContext += `Project files:\n${stdout}\n`;
      } catch {
        /* ignore */
      }
      try {
        const pkg = await fs.readFile(
          path.join(this.cwd, "package.json"),
          "utf8",
        );
        const parsed = JSON.parse(pkg) as { name?: string };
        projectContext += `Project: ${parsed.name ?? "unknown"}\n`;
      } catch {
        /* ignore */
      }

      // Multi-turn execution loop (up to 8 turns)
      let lastResponse = "";
      for (let turn = 0; turn < 8; turn++) {
        const prompt =
          turn === 0
            ? `You are an autonomous sub-agent. Complete this task fully using tools.

PROJECT CONTEXT:
${projectContext}
${sessionContext ? `SESSION CONTEXT (recent conversation):\n${sessionContext}\n` : ""}
TASK: ${task.goal}

Work step by step:
1. Read relevant files to understand the codebase
2. Make the necessary changes
3. Verify your changes work (run build/test if applicable)
4. When finished, say DONE and summarize what you did.`
            : `Continue working on the task: "${task.goal}"

Previous response:
${lastResponse.slice(-2000)}

Continue executing. Use tools to read, write, and edit files.
If ALL work is complete, say DONE and summarize.`;

        const result = await provider.runTurn(prompt);
        lastResponse = result.text;

        if (result.text.toUpperCase().includes("DONE")) {
          break;
        }
      }

      // Get a summary
      const summaryResult = await provider.runTurn(
        `Summarize what you accomplished for: "${task.goal}"\nList files changed and key decisions. Be concise (max 5 lines).`,
      );

      task.status = "done";
      task.result = summaryResult.text;
      task.finishedAt = Date.now();
      task.ms = task.finishedAt - task.startedAt!;
      this.onUpdate(task);
    } catch (err) {
      task.status = "failed";
      task.error = err instanceof Error ? err.message : String(err);
      task.finishedAt = Date.now();
      task.ms = task.finishedAt - (task.startedAt ?? task.finishedAt);
      this.onUpdate(task);
    }
  }

  /** Get all tasks */
  getTasks(): SpawnedTask[] {
    return [...this.tasks];
  }

  /** Get a specific task */
  getTask(id: number): SpawnedTask | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  /** Get running count */
  getRunningCount(): number {
    return this.tasks.filter((t) => t.status === "running").length;
  }

  /** Get completed tasks */
  getCompletedTasks(): SpawnedTask[] {
    return this.tasks.filter(
      (t) => t.status === "done" || t.status === "failed",
    );
  }

  /** Clear completed tasks from the list */
  clearCompleted(): number {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter(
      (t) => t.status === "running" || t.status === "queued",
    );
    return before - this.tasks.length;
  }

  /** Format tasks for display */
  formatStatus(): string {
    if (this.tasks.length === 0) return "No spawned tasks.";

    const lines: string[] = [];
    for (const t of this.tasks) {
      const elapsed = t.ms
        ? `${(t.ms / 1000).toFixed(1)}s`
        : t.startedAt
          ? `${((Date.now() - t.startedAt) / 1000).toFixed(0)}s...`
          : "";
      const icon =
        t.status === "done"
          ? "\u2713"
          : t.status === "failed"
            ? "\u2717"
            : t.status === "running"
              ? "\u25C9"
              : "\u25CB";
      const provLabel = `${t.provider}/${t.model}`;
      lines.push(
        `  ${icon} #${t.id} [${t.status}] ${t.goal.slice(0, 60)} (${provLabel}) ${elapsed}`,
      );
    }

    const running = this.getRunningCount();
    const done = this.tasks.filter((t) => t.status === "done").length;
    const failed = this.tasks.filter((t) => t.status === "failed").length;
    lines.push(`\n  ${running} running, ${done} done, ${failed} failed`);

    return lines.join("\n");
  }

  /** Format results of completed tasks */
  formatResults(): string {
    const completed = this.getCompletedTasks();
    if (completed.length === 0) return "No completed tasks yet.";

    const lines: string[] = [];
    for (const t of completed) {
      const icon = t.status === "done" ? "\u2713" : "\u2717";
      const time = t.ms ? `${(t.ms / 1000).toFixed(1)}s` : "";
      lines.push(`${icon} #${t.id}: ${t.goal}`);
      lines.push(`  Provider: ${t.provider}/${t.model} | ${time}`);
      if (t.result) lines.push(`  ${t.result.split("\n").join("\n  ")}`);
      if (t.error) lines.push(`  Error: ${t.error}`);
      lines.push("");
    }
    return lines.join("\n");
  }
}
