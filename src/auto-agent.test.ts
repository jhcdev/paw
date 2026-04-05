import { describe, it, expect, vi } from "vitest";
import { AutoAgent, type AutoStep, type AutoResult } from "./auto-agent.js";

function makeMockRunTurn(responses: string[]) {
  let idx = 0;
  return vi.fn(async (_prompt: string) => {
    const text = responses[idx] ?? "done";
    idx++;
    return { text };
  });
}

function makeMockOnStep() {
  const steps: AutoStep[] = [];
  return { fn: (step: AutoStep) => steps.push({ ...step }), steps };
}

describe("AutoAgent", () => {
  describe("run — basic flow", () => {
    it("completes a simple task with DONE in response", async () => {
      const runTurn = makeMockRunTurn([
        "Plan:\n1. Read file\n2. Edit file",   // plan
        "I read the file and edited it. DONE",  // execute (contains DONE)
        "All checks passed",                      // summary
      ]);
      const { fn: onStep, steps } = makeMockOnStep();

      const agent = new AutoAgent("/tmp", runTurn, onStep);
      const result = await agent.run("fix the bug");

      expect(result.goal).toBe("fix the bug");
      expect(result.success).toBe(true);
      expect(result.summary).toBe("All checks passed");
      expect(runTurn).toHaveBeenCalled();

      // Should have steps: think (analyze), think (plan), execute, verify, done
      const actions = steps.map((s) => s.action);
      expect(actions).toContain("think");
      expect(actions).toContain("execute");
      expect(actions).toContain("done");
    });

    it("iterates when response does not contain DONE", async () => {
      const runTurn = makeMockRunTurn([
        "Plan:\n1. Step one\n2. Step two",       // plan
        "Working on step one...",                   // execute 1 (no DONE)
        "Working on step two... DONE",              // execute 2 (DONE)
        "Summary of work",                          // summary
      ]);
      const { fn: onStep, steps } = makeMockOnStep();

      const agent = new AutoAgent("/tmp", runTurn, onStep);
      const result = await agent.run("implement feature", 5);

      expect(result.success).toBe(true);
      // Should have executed at least twice
      const execSteps = steps.filter((s) => s.action === "execute");
      expect(execSteps.length).toBeGreaterThanOrEqual(2);
    });

    it("stops at maxIterations and reports incomplete", async () => {
      const runTurn = makeMockRunTurn([
        "Plan: do stuff",      // plan
        "still working...",     // execute 1
        "still working...",     // execute 2
        "still working...",     // execute 3 (max reached)
        "Incomplete summary",   // summary
      ]);
      const { fn: onStep } = makeMockOnStep();

      const agent = new AutoAgent("/tmp", runTurn, onStep);
      const result = await agent.run("big task", 3);

      expect(result.success).toBe(false);
      expect(result.summary).toBeDefined();
    });
  });

  describe("run — step tracking", () => {
    it("records timing for each step", async () => {
      const runTurn = makeMockRunTurn(["plan", "DONE", "summary"]);
      const { fn: onStep, steps } = makeMockOnStep();

      const agent = new AutoAgent("/tmp", runTurn, onStep);
      const result = await agent.run("task");

      expect(result.totalMs).toBeGreaterThanOrEqual(0);
      // Think steps should have ms set
      const thinkSteps = steps.filter((s) => s.action === "think" && s.ms !== undefined);
      expect(thinkSteps.length).toBeGreaterThanOrEqual(1);
      expect(thinkSteps[0]!.ms).toBeGreaterThanOrEqual(0);
    });

    it("calls onStep for every phase", async () => {
      const runTurn = makeMockRunTurn(["plan", "DONE", "summary"]);
      const { fn: onStep, steps } = makeMockOnStep();

      const agent = new AutoAgent("/tmp", runTurn, onStep);
      await agent.run("task");

      expect(steps.length).toBeGreaterThanOrEqual(4); // analyze, plan, execute, verify/done
    });
  });

  describe("run — result structure", () => {
    it("returns correct AutoResult shape", async () => {
      const runTurn = makeMockRunTurn(["plan", "DONE", "summary text"]);
      const { fn: onStep } = makeMockOnStep();

      const agent = new AutoAgent("/tmp", runTurn, onStep);
      const result = await agent.run("my goal");

      expect(result).toHaveProperty("goal", "my goal");
      expect(result).toHaveProperty("steps");
      expect(result).toHaveProperty("totalMs");
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("summary");
      expect(Array.isArray(result.steps)).toBe(true);
    });
  });
});
