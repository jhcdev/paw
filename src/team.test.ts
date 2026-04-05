import { describe, it, expect, vi } from "vitest";
import { TeamRunner, autoConfigureTeam, getTeamScores, type TeamConfig, type AgentRole } from "./team.js";
import type { ProviderName } from "./types.js";

// Mock createProvider to avoid real API calls
vi.mock("./providers/index.js", () => ({
  createProvider: vi.fn(() => ({
    runTurn: vi.fn(async (prompt: string) => {
      if (prompt.includes("PLANNER")) return { text: "Plan: 1. Read files 2. Edit code" };
      if (prompt.includes("CODER")) return { text: "Implementation done" };
      if (prompt.includes("REVIEWER")) return { text: "PASS — code looks good" };
      if (prompt.includes("TESTER")) return { text: "Tests:\n- test1 passes\n- test2 passes" };
      if (prompt.includes("OPTIMIZER")) return { text: "No optimizations needed" };
      return { text: "ok" };
    }),
    clear: vi.fn(),
  })),
}));

function makeTeamConfig(providers: ProviderName[] = ["anthropic"]): TeamConfig {
  const config: TeamConfig = {};
  const roles: AgentRole[] = ["planner", "coder", "reviewer", "tester", "optimizer"];
  for (const role of roles) {
    const provider = providers[roles.indexOf(role) % providers.length]!;
    config[role] = { provider, model: "test-model", apiKey: "test-key" };
  }
  return config;
}

describe("TeamRunner", () => {
  describe("configure and isReady", () => {
    it("is not ready without coder role", () => {
      const team = new TeamRunner("/tmp");
      expect(team.isReady()).toBe(false);
    });

    it("is ready once coder is configured", () => {
      const team = new TeamRunner("/tmp");
      team.configure({ coder: { provider: "anthropic", model: "test", apiKey: "key" } });
      expect(team.isReady()).toBe(true);
    });

    it("configures all 5 roles", () => {
      const team = new TeamRunner("/tmp");
      team.configure(makeTeamConfig());
      const roles = team.getRoles();
      expect(roles).toHaveLength(5);
      expect(roles.map((r) => r.role).sort()).toEqual(["coder", "optimizer", "planner", "reviewer", "tester"]);
    });
  });

  describe("assignRole", () => {
    it("overwrites existing role assignment", () => {
      const team = new TeamRunner("/tmp");
      team.configure(makeTeamConfig());
      team.assignRole("coder", { provider: "codex", model: "gpt-5.4", apiKey: "key2" });

      const roles = team.getRoles();
      const coder = roles.find((r) => r.role === "coder");
      expect(coder?.provider).toBe("codex");
      expect(coder?.model).toBe("gpt-5.4");
    });
  });

  describe("getRoles", () => {
    it("returns role/provider/model info", () => {
      const team = new TeamRunner("/tmp");
      team.configure(makeTeamConfig(["anthropic", "codex"]));

      const roles = team.getRoles();
      expect(roles.length).toBe(5);
      for (const r of roles) {
        expect(r).toHaveProperty("role");
        expect(r).toHaveProperty("provider");
        expect(r).toHaveProperty("model");
      }
    });
  });

  describe("run — pipeline flow", () => {
    it("runs all 5 phases and returns results", async () => {
      const team = new TeamRunner("/tmp");
      team.configure(makeTeamConfig());

      const phases: string[] = [];
      const result = await team.run("implement auth", (phase) => phases.push(phase));

      expect(result.phases.length).toBeGreaterThanOrEqual(4); // plan, code, review+test parallel, optimize
      expect(result.totalMs).toBeGreaterThanOrEqual(0);

      const roles = result.phases.map((p) => p.role);
      expect(roles).toContain("planner");
      expect(roles).toContain("coder");
      expect(roles).toContain("reviewer");
      expect(roles).toContain("optimizer");
    });

    it("includes timing for each phase", async () => {
      const team = new TeamRunner("/tmp");
      team.configure(makeTeamConfig());

      const result = await team.run("task", () => {});

      for (const phase of result.phases) {
        expect(phase.ms).toBeGreaterThanOrEqual(0);
        expect(phase.provider).toBeDefined();
        expect(phase.model).toBeDefined();
      }
    });

    it("calls onPhase callback for each phase", async () => {
      const team = new TeamRunner("/tmp");
      team.configure(makeTeamConfig());

      const calls: { phase: string; provider: string; model: string }[] = [];
      await team.run("task", (phase, provider, model) => {
        calls.push({ phase, provider, model });
      });

      expect(calls.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("run — review rework loop", () => {
    it("exits loop on PASS review", async () => {
      const team = new TeamRunner("/tmp");
      team.configure(makeTeamConfig());

      const result = await team.run("task", () => {}, 3);

      // Mock returns "PASS", so no rework
      const codePhases = result.phases.filter((p) => p.role === "coder");
      expect(codePhases).toHaveLength(1);
    });
  });
});

describe("autoConfigureTeam", () => {
  it("assigns all 5 roles with a single provider", async () => {
    const available = [{ provider: "anthropic" as ProviderName, apiKey: "key", model: "claude" }];
    const config = await autoConfigureTeam(available);

    const roles: AgentRole[] = ["planner", "coder", "reviewer", "tester", "optimizer"];
    for (const role of roles) {
      expect(config[role]).toBeDefined();
      expect(config[role]!.provider).toBe("anthropic");
    }
  });

  it("spreads roles across multiple providers", async () => {
    const available = [
      { provider: "anthropic" as ProviderName, apiKey: "key1", model: "claude" },
      { provider: "codex" as ProviderName, apiKey: "key2", model: "gpt" },
      { provider: "ollama" as ProviderName, apiKey: "", model: "llama" },
    ];
    const config = await autoConfigureTeam(available);

    const providers = new Set(Object.values(config).map((c) => c!.provider));
    // Should use at least 2 different providers
    expect(providers.size).toBeGreaterThanOrEqual(2);
  });

  it("returns empty config for no providers", async () => {
    const config = await autoConfigureTeam([]);
    expect(Object.keys(config)).toHaveLength(0);
  });
});

describe("getTeamScores", () => {
  it("returns scores for all provider-role combinations", async () => {
    const scores = await getTeamScores();

    expect(scores.length).toBeGreaterThan(0);
    for (const entry of scores) {
      expect(entry).toHaveProperty("provider");
      expect(entry).toHaveProperty("role");
      expect(entry).toHaveProperty("score");
      expect(entry).toHaveProperty("uses");
      expect(entry.score).toBeGreaterThanOrEqual(1);
      expect(entry.score).toBeLessThanOrEqual(10);
    }
  });
});
