import { spawn } from "node:child_process";
import type { AgentTurnResult, LlmProvider } from "../types.js";

export type CodexEffort = "low" | "medium" | "high" | "extra_high";

export class CodexProvider implements LlmProvider {
  private model: string;
  private readonly cwd: string;
  private effort: CodexEffort;
  private history: { role: "user" | "assistant"; text: string }[] = [];

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

  setModel(model: string): void {
    this.model = model;
  }

  clear(): void {
    this.history = [];
  }

  /** @internal exposed for testing */
  getHistory(): { role: "user" | "assistant"; text: string }[] {
    return this.history;
  }

  /** @internal exposed for testing */
  pushHistory(role: "user" | "assistant", text: string): void {
    this.history.push({ role, text });
  }

  /** @internal exposed for testing */
  buildPromptWithHistory(prompt: string): string {
    if (this.history.length === 0) return prompt;

    // Include last 10 turns as context (keep prompt size reasonable)
    const recent = this.history.slice(-10);
    const contextLines = recent.map((h) =>
      h.role === "user" ? `> ${h.text.slice(0, 300)}` : `AI: ${h.text.slice(0, 300)}`
    );
    return `[Previous conversation]\n${contextLines.join("\n")}\n\n[Current message]\n${prompt}`;
  }

  async runTurn(prompt: string): Promise<AgentTurnResult> {
    const fullPrompt = this.buildPromptWithHistory(prompt);
    this.history.push({ role: "user", text: prompt });

    return new Promise((resolve) => {
      const args = [
        "exec",
        "--dangerously-bypass-approvals-and-sandbox",
        "-c", `model="${this.model}"`,
        "-c", `effort="${this.effort}"`,
        fullPrompt,
      ];

      const child = spawn("codex", args, {
        cwd: this.cwd,
        stdio: ["ignore", "pipe", "pipe"], // Close stdin to prevent hanging
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
      child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        resolve({ text: "[Codex] Timeout after 5 minutes." });
      }, 300000);

      child.on("close", (code) => {
        clearTimeout(timeout);
        const output = extractCodexResponse(stdout) || stderr.trim() || "(no output)";
        this.history.push({ role: "assistant", text: output });
        if (code !== 0 && !output) {
          resolve({ text: `[Codex Error] Exit code ${code}` });
        } else {
          resolve({ text: output });
        }
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        resolve({ text: `[Codex Error] ${err.message}` });
      });
    });
  }
}

/** Extract the actual response from codex exec output (skip headers/metadata) */
function extractCodexResponse(raw: string): string {
  const lines = raw.split("\n");
  // Find the "codex" marker line and get content after it
  let capture = false;
  const result: string[] = [];
  for (const line of lines) {
    if (line.trim() === "codex") {
      capture = true;
      continue;
    }
    if (capture) {
      // Stop at "tokens used" line
      if (line.trim() === "tokens used") break;
      result.push(line);
    }
  }
  if (result.length > 0) return result.join("\n").trim();
  // Fallback: return everything after the header block
  const headerEnd = raw.indexOf("--------\n");
  if (headerEnd >= 0) {
    const afterHeader = raw.slice(raw.indexOf("--------\n", headerEnd + 1) + 9);
    return afterHeader.trim();
  }
  return raw.trim();
}
