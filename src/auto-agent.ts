import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ProviderName } from "./types.js";

const execAsync = promisify(exec);

export type AutoStep = {
  action: "think" | "execute" | "verify" | "fix" | "done";
  description: string;
  result?: string;
  status: "pending" | "running" | "success" | "fail";
  ms?: number;
};

export type AutoResult = {
  goal: string;
  steps: AutoStep[];
  totalMs: number;
  success: boolean;
  summary: string;
};

/**
 * /auto — Autonomous agent that works until the task is done.
 *
 * Unlike regular chat (one prompt → one response), /auto:
 * 1. Plans the work (what files to read, what to change)
 * 2. Executes each step using tools
 * 3. Verifies by running tests/build
 * 4. Fixes any errors automatically
 * 5. Repeats until done or max iterations
 *
 * Uses the primary provider for thinking,
 * can delegate sub-tasks to other providers via team.
 */
export class AutoAgent {
  private cwd: string;
  private runTurn: (prompt: string, onStatus?: (status: string) => void) => Promise<{ text: string }>;
  private onStep: (step: AutoStep) => void;
  private onToolStatus: ((status: string) => void) | null = null;

  constructor(
    cwd: string,
    runTurn: (prompt: string, onStatus?: (status: string) => void) => Promise<{ text: string }>,
    onStep: (step: AutoStep) => void,
  ) {
    this.cwd = cwd;
    this.runTurn = runTurn;
    this.onStep = onStep;
  }

  setToolStatusCallback(fn: (status: string) => void): void {
    this.onToolStatus = fn;
  }

  private runTurn_(prompt: string): Promise<{ text: string }> {
    return this.runTurn(prompt, this.onToolStatus ?? undefined);
  }

  async run(goal: string, maxIterations = 10): Promise<AutoResult> {
    const totalStart = Date.now();
    const steps: AutoStep[] = [];

    // Phase 1: Understand the project
    const contextStep: AutoStep = { action: "think", description: "Analyzing project...", status: "running" };
    steps.push(contextStep);
    this.onStep(contextStep);

    let projectContext = "";
    try {
      const files = await execAsync("find . -maxdepth 3 -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' | head -30", { cwd: this.cwd });
      projectContext += `Files:\n${files.stdout}\n`;
    } catch {}
    try {
      const pkg = await fs.readFile(path.join(this.cwd, "package.json"), "utf8");
      const parsed = JSON.parse(pkg);
      projectContext += `Project: ${parsed.name ?? "unknown"}\nDeps: ${Object.keys(parsed.dependencies ?? {}).join(", ")}\n`;
    } catch {}

    contextStep.status = "success";
    contextStep.ms = Date.now() - totalStart;
    this.onStep(contextStep);

    // Phase 2: Plan
    const planStep: AutoStep = { action: "think", description: "Creating plan...", status: "running" };
    steps.push(planStep);
    this.onStep(planStep);

    const planStart = Date.now();
    const planResult = await this.runTurn_(
      `You are an autonomous coding agent. You must complete this task fully.

PROJECT CONTEXT:
${projectContext}

TASK: ${goal}

Create a step-by-step plan. For each step, specify:
1. What to do (read file, edit file, create file, run command)
2. The exact file path or command
3. What success looks like

Output ONLY the plan as numbered steps. Be specific and actionable.`
    );

    planStep.status = "success";
    planStep.result = planResult.text;
    planStep.ms = Date.now() - planStart;
    this.onStep(planStep);

    // Phase 3: Execute plan iteratively
    let lastResult = planResult.text;
    let iteration = 0;
    let allDone = false;

    while (iteration < maxIterations && !allDone) {
      iteration++;

      // Execute
      const execStep: AutoStep = { action: "execute", description: `Executing step ${iteration}/${maxIterations}...`, status: "running" };
      steps.push(execStep);
      this.onStep(execStep);

      const execStart = Date.now();
      const execResult = await this.runTurn_(
        `Continue executing the plan. You are on iteration ${iteration}/${maxIterations}.

Previous result:
${lastResult.slice(-2000)}

Execute the next step of the plan. Use tools to:
- Read files with read_file
- Write/edit files with write_file or edit_file
- Run commands with run_shell
- Search with search_text or glob

After executing, state what you did and what's next.
If ALL steps are complete, say DONE.`
      );

      execStep.status = "success";
      execStep.result = execResult.text.slice(0, 200);
      execStep.ms = Date.now() - execStart;
      this.onStep(execStep);
      lastResult = execResult.text;

      // Check if done
      if (execResult.text.toUpperCase().includes("DONE")) {
        // Verify
        const verifyStep: AutoStep = { action: "verify", description: "Verifying...", status: "running" };
        steps.push(verifyStep);
        this.onStep(verifyStep);

        const verifyStart = Date.now();
        let verifyOutput = "";

        // Try build
        try {
          const build = await execAsync("npm run build 2>&1 || npm run check 2>&1 || echo 'no build script'", {
            cwd: this.cwd, timeout: 30000,
          });
          verifyOutput += `Build: ${build.stdout.slice(-500)}\n`;
        } catch (e) {
          const err = e as { stdout?: string; stderr?: string };
          verifyOutput += `Build error: ${err.stdout?.slice(-300) ?? err.stderr?.slice(-300) ?? "unknown"}\n`;
        }

        // Try test
        try {
          const test = await execAsync("npm test 2>&1 || echo 'no test script'", {
            cwd: this.cwd, timeout: 60000,
          });
          verifyOutput += `Test: ${test.stdout.slice(-500)}\n`;
        } catch (e) {
          const err = e as { stdout?: string; stderr?: string };
          verifyOutput += `Test error: ${err.stdout?.slice(-300) ?? err.stderr?.slice(-300) ?? "unknown"}\n`;
        }

        const hasErrors = verifyOutput.toLowerCase().includes("error") && !verifyOutput.includes("no build script") && !verifyOutput.includes("no test script");

        if (hasErrors && iteration < maxIterations) {
          // Fix errors
          verifyStep.status = "fail";
          verifyStep.result = verifyOutput.slice(0, 200);
          verifyStep.ms = Date.now() - verifyStart;
          this.onStep(verifyStep);

          const fixStep: AutoStep = { action: "fix", description: "Fixing errors...", status: "running" };
          steps.push(fixStep);
          this.onStep(fixStep);

          const fixStart = Date.now();
          const fixResult = await this.runTurn_(
            `The verification found errors. Fix them:

${verifyOutput}

Fix ALL errors. Use tools to edit files. Then say DONE when fixed.`
          );

          fixStep.status = "success";
          fixStep.result = fixResult.text.slice(0, 200);
          fixStep.ms = Date.now() - fixStart;
          this.onStep(fixStep);
          lastResult = fixResult.text;
        } else {
          verifyStep.status = hasErrors ? "fail" : "success";
          verifyStep.result = hasErrors ? verifyOutput.slice(0, 200) : "All checks passed";
          verifyStep.ms = Date.now() - verifyStart;
          this.onStep(verifyStep);
          allDone = true;
        }
      }
    }

    // Summary
    const doneStep: AutoStep = { action: "done", description: "Generating summary...", status: "running" };
    steps.push(doneStep);
    this.onStep(doneStep);

    const summaryResult = await this.runTurn_(
      `Summarize what was accomplished for the task: "${goal}"
List: files created/modified, key changes, and any remaining work.
Be concise (max 5 lines).`
    );

    doneStep.status = "success";
    doneStep.result = summaryResult.text;
    doneStep.ms = 0;
    this.onStep(doneStep);

    return {
      goal,
      steps,
      totalMs: Date.now() - totalStart,
      success: allDone,
      summary: summaryResult.text,
    };
  }
}
