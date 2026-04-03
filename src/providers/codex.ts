import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { AgentTurnResult, LlmProvider, TokenUsage } from "../types.js";

const execAsync = promisify(exec);

export type CodexEffort = "low" | "medium" | "high" | "extra_high";

export class CodexProvider implements LlmProvider {
  private readonly model: string;
  private readonly cwd: string;
  private effort: CodexEffort;

  constructor(args: { model: string; cwd: string; effort?: CodexEffort }) {
    this.model = args.model;
    this.cwd = args.cwd;
    this.effort = args.effort ?? "medium";
  }

  setEffort(effort: CodexEffort): void {
    this.effort = effort;
  }

  getEffort(): CodexEffort {
    return this.effort;
  }

  clear(): void {
    // Codex exec is stateless per call
  }

  async runTurn(prompt: string): Promise<AgentTurnResult> {
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const cmd = [
      "codex", "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      `-c`, `model="${this.model}"`,
      `-c`, `effort="${this.effort}"`,
      `'${escapedPrompt}'`,
    ].join(" ");

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: this.cwd,
        maxBuffer: 5 * 1024 * 1024,
        timeout: 300000, // 5 min
      });

      const output = stdout.trim() || stderr.trim() || "(no output)";
      return { text: output };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      const output = err.stdout?.trim() || err.stderr?.trim() || err.message || "Codex execution failed";
      return { text: `[Codex Error] ${output}` };
    }
  }
}
