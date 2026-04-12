import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export type PipeMode = "analyze" | "fix" | "watch";

export type PipeResult = {
  command: string;
  mode: PipeMode;
  output: string;
  analysis: string;
  iterations: number;
  fixed: boolean;
  totalMs: number;
};

/**
 * /pipe — Feed shell output directly to the AI agent.
 *
 * Three modes:
 * - analyze: run command, feed output to AI for analysis
 * - fix: run command, if errors → AI fixes → re-run (loop until pass)
 * - watch: run command continuously, AI reacts to changes
 *
 * Only possible in Paw because:
 * - Multiple providers can collaborate (Codex fixes, Ollama analyzes)
 * - Auto-fallback if one provider is rate limited
 * - Activity log tracks every iteration
 * - Session saves the fix history
 */
export class PipeAgent {
  private cwd: string;
  private runTurn: (prompt: string) => Promise<{ text: string }>;
  private onStatus: (msg: string) => void;

  constructor(
    cwd: string,
    runTurn: (prompt: string) => Promise<{ text: string }>,
    onStatus: (msg: string) => void,
  ) {
    this.cwd = cwd;
    this.runTurn = runTurn;
    this.onStatus = onStatus;
  }

  /** Run command → analyze output */
  async analyze(command: string): Promise<PipeResult> {
    const start = Date.now();
    this.onStatus(`Running: ${command}`);

    const output = await this.runCommand(command);

    this.onStatus("Analyzing output...");
    const analysis = await this.runTurn(
      `Analyze this command output. Identify: errors, warnings, issues, and suggestions.

Command: ${command}
Output:
${output.slice(-3000)}

Be concise and actionable. If there are errors, explain the root cause and how to fix each one.`
    );

    return {
      command, mode: "analyze", output, analysis: analysis.text,
      iterations: 1, fixed: false, totalMs: Date.now() - start,
    };
  }

  /** Run command → if errors → fix → re-run (loop) */
  async fix(command: string, maxIterations = 5): Promise<PipeResult> {
    const start = Date.now();
    let output = "";
    let lastAnalysis = "";
    let iteration = 0;
    let fixed = false;

    while (iteration < maxIterations) {
      iteration++;
      this.onStatus(`Running (${iteration}/${maxIterations}): ${command}`);

      output = await this.runCommand(command);

      // Check if output has errors
      const hasErrors = this.detectErrors(output);

      if (!hasErrors) {
        fixed = true;
        lastAnalysis = "All clear — no errors detected.";
        this.onStatus("Pass — no errors");
        break;
      }

      this.onStatus(`Errors found — fixing (${iteration}/${maxIterations})...`);

      // Ask AI to fix
      const fixResult = await this.runTurn(
        `This command failed. Fix the errors by editing the relevant files.

Command: ${command}
Error output:
${output.slice(-3000)}

${iteration > 1 ? `This is attempt ${iteration}. Previous fix didn't fully resolve it.` : ""}

Read the relevant files, find the root cause, and fix it. Use edit_file or write_file tools.
After fixing, say what you changed.`
      );

      lastAnalysis = fixResult.text;
    }

    if (!fixed) {
      this.onStatus(`Could not fix after ${maxIterations} attempts`);
      // Final analysis of remaining errors
      const finalAnalysis = await this.runTurn(
        `After ${maxIterations} attempts, these errors persist:

Command: ${command}
Output:
${output.slice(-2000)}

Explain what's still wrong and suggest manual steps to fix it.`
      );
      lastAnalysis = finalAnalysis.text;
    }

    return {
      command, mode: "fix", output, analysis: lastAnalysis,
      iterations: iteration, fixed, totalMs: Date.now() - start,
    };
  }

  /** Run command once, watch for output, analyze on completion */
  async watch(command: string, timeout = 30000): Promise<PipeResult> {
    const start = Date.now();
    this.onStatus(`Watching: ${command}`);

    return new Promise((resolve) => {
      let output = "";
      const child = spawn(command, {
        cwd: this.cwd,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout.on("data", (data: Buffer) => { output += data.toString(); });
      child.stderr.on("data", (data: Buffer) => { output += data.toString(); });

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
      }, timeout);

      child.on("error", async (error) => {
        clearTimeout(timer);
        output = [output, error.message].filter(Boolean).join("\n");
        this.onStatus("Analyzing...");

        const analysis = await this.runTurn(
          `Analyze the output of this watched command:

Command: ${command}
Output:
${output.slice(-3000)}

Summarize what happened. Flag any errors, warnings, or unusual behavior.`
        );

        resolve({
          command, mode: "watch", output, analysis: analysis.text,
          iterations: 1, fixed: false, totalMs: Date.now() - start,
        });
      });

      child.on("close", async () => {
        clearTimeout(timer);
        this.onStatus("Analyzing...");

        const analysis = await this.runTurn(
          `Analyze the output of this watched command:

Command: ${command}
Output:
${output.slice(-3000)}

Summarize what happened. Flag any errors, warnings, or unusual behavior.`
        );

        resolve({
          command, mode: "watch", output, analysis: analysis.text,
          iterations: 1, fixed: false, totalMs: Date.now() - start,
        });
      });
    });
  }

  private async runCommand(command: string): Promise<string> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.cwd,
        maxBuffer: 5 * 1024 * 1024,
        timeout: 120000,
      });
      return [stdout, stderr].filter(Boolean).join("\n");
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      return [err.stdout, err.stderr, err.message].filter(Boolean).join("\n");
    }
  }

  private detectErrors(output: string): boolean {
    const lower = output.toLowerCase();
    return (
      lower.includes("error") ||
      lower.includes("fail") ||
      lower.includes("exception") ||
      lower.includes("fatal") ||
      lower.includes("cannot find") ||
      lower.includes("not found") ||
      lower.includes("exit code 1") ||
      lower.includes("enoent")
    );
  }
}
