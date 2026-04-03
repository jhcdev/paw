import { spawn } from "node:child_process";
import type { AgentTurnResult, LlmProvider } from "../types.js";

export type ClaudeEffort = "low" | "medium" | "high" | "max";

export class ClaudeCliProvider implements LlmProvider {
  private model: string;
  private readonly cwd: string;
  private effort: ClaudeEffort;

  constructor(args: { model: string; cwd: string; effort?: ClaudeEffort }) {
    this.model = args.model;
    this.cwd = args.cwd;
    this.effort = args.effort ?? "high";
  }

  setEffort(effort: ClaudeEffort): void {
    this.effort = effort;
  }

  getEffort(): ClaudeEffort {
    return this.effort;
  }

  setModel(model: string): void {
    this.model = model;
  }

  clear(): void {
    // CLI mode is stateless per call
  }

  async runTurn(prompt: string): Promise<AgentTurnResult> {
    return new Promise((resolve) => {
      const args = [
        "-p",
        "--model", this.model,
        "--effort", this.effort,
        "--no-session-persistence",
        "--dangerously-skip-permissions",
        prompt,
      ];

      const child = spawn("claude", args, {
        cwd: this.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, IS_SANDBOX: "1" },
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
      child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        resolve({ text: "[Claude CLI] Timeout after 5 minutes." });
      }, 300000);

      child.on("close", (code) => {
        clearTimeout(timeout);
        const output = stdout.trim() || stderr.trim() || "(no output)";
        if (code !== 0 && !stdout.trim()) {
          resolve({ text: `[Claude CLI Error] ${output}` });
        } else {
          resolve({ text: output });
        }
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        resolve({ text: `[Claude CLI Error] ${err.message}` });
      });
    });
  }
}
