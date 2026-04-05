import { describe, it, expect, vi } from "vitest";
import { PipeAgent, type PipeResult } from "./pipe-agent.js";

function makeMockRunTurn(responses: string[]) {
  let idx = 0;
  return vi.fn(async (_prompt: string) => {
    const text = responses[idx] ?? "analysis done";
    idx++;
    return { text };
  });
}

describe("PipeAgent", () => {
  describe("analyze", () => {
    it("runs command and returns AI analysis", async () => {
      const statuses: string[] = [];
      const runTurn = makeMockRunTurn(["Found 2 warnings: unused variable, missing semicolon"]);

      const agent = new PipeAgent("/tmp", runTurn, (msg) => statuses.push(msg));
      const result = await agent.analyze("echo 'hello world'");

      expect(result.mode).toBe("analyze");
      expect(result.command).toBe("echo 'hello world'");
      expect(result.output).toContain("hello world");
      expect(result.analysis).toContain("warnings");
      expect(result.iterations).toBe(1);
      expect(result.fixed).toBe(false);
      expect(result.totalMs).toBeGreaterThanOrEqual(0);
      expect(statuses).toContain("Analyzing output...");
    });

    it("passes command output to AI prompt", async () => {
      const runTurn = makeMockRunTurn(["looks good"]);
      const agent = new PipeAgent("/tmp", runTurn, () => {});
      await agent.analyze("echo 'test output'");

      const prompt = runTurn.mock.calls[0]![0] as string;
      expect(prompt).toContain("test output");
      expect(prompt).toContain("echo 'test output'");
    });
  });

  describe("fix", () => {
    it("returns fixed=true when command succeeds (no errors)", async () => {
      const runTurn = makeMockRunTurn([]);
      const agent = new PipeAgent("/tmp", runTurn, () => {});

      // echo produces clean output — no error keywords
      const result = await agent.fix("echo 'all good'");

      expect(result.mode).toBe("fix");
      expect(result.fixed).toBe(true);
      expect(result.iterations).toBe(1);
    });

    it("iterates when command output contains errors", async () => {
      const runTurn = makeMockRunTurn([
        "Fixed the error",    // fix attempt 1
        "Fixed again",        // fix attempt 2
        "Still broken",       // final analysis
      ]);

      const agent = new PipeAgent("/tmp", runTurn, () => {});
      // This command always outputs "error" so fix loop runs
      const result = await agent.fix("echo 'error in build'", 2);

      expect(result.fixed).toBe(false);
      expect(result.iterations).toBe(2);
    });

    it("respects maxIterations", async () => {
      const runTurn = makeMockRunTurn(["fix1", "fix2", "fix3", "final"]);
      const agent = new PipeAgent("/tmp", runTurn, () => {});
      const result = await agent.fix("echo 'fatal error'", 3);

      expect(result.iterations).toBeLessThanOrEqual(3);
    });

    it("reports status messages during fix loop", async () => {
      const statuses: string[] = [];
      const runTurn = makeMockRunTurn(["fixed"]);
      const agent = new PipeAgent("/tmp", runTurn, (msg) => statuses.push(msg));

      await agent.fix("echo 'all good'", 2);

      expect(statuses.some((s) => s.includes("Running"))).toBe(true);
    });
  });

  describe("detectErrors (via fix behavior)", () => {
    const errorKeywords = ["error", "fail", "exception", "fatal", "cannot find", "not found", "exit code 1", "enoent"];

    for (const keyword of errorKeywords) {
      it(`detects "${keyword}" as error`, async () => {
        const runTurn = makeMockRunTurn(["trying to fix", "final"]);
        const agent = new PipeAgent("/tmp", runTurn, () => {});
        const result = await agent.fix(`echo '${keyword} occurred'`, 1);

        // If error detected, fix loop should have called runTurn
        expect(runTurn).toHaveBeenCalled();
      });
    }

    it("does not detect clean output as error", async () => {
      const runTurn = makeMockRunTurn([]);
      const agent = new PipeAgent("/tmp", runTurn, () => {});
      const result = await agent.fix("echo 'all tests passed successfully'");

      expect(result.fixed).toBe(true);
      // runTurn should NOT be called for fixing (only for final analysis if needed)
      expect(runTurn).not.toHaveBeenCalled();
    });
  });

  describe("result structure", () => {
    it("returns correct PipeResult shape", async () => {
      const runTurn = makeMockRunTurn(["analysis"]);
      const agent = new PipeAgent("/tmp", runTurn, () => {});
      const result = await agent.analyze("echo test");

      expect(result).toHaveProperty("command");
      expect(result).toHaveProperty("mode");
      expect(result).toHaveProperty("output");
      expect(result).toHaveProperty("analysis");
      expect(result).toHaveProperty("iterations");
      expect(result).toHaveProperty("fixed");
      expect(result).toHaveProperty("totalMs");
    });
  });
});
