import { describe, it, expect, vi } from "vitest";
import { SpawnManager, type SpawnedTask, type SpawnConfig } from "./spawn-agent.js";

// We can't easily test actual provider execution (needs API keys),
// but we can test the management layer thoroughly.

const baseCwd = "/tmp/paw-spawn-test";

function makeConfig(provider: "anthropic" | "codex" | "ollama" = "anthropic"): SpawnConfig {
  return { provider, apiKey: "test-key", model: "test-model", cwd: baseCwd };
}

describe("SpawnManager", () => {
  describe("task management", () => {
    it("starts with no tasks", () => {
      const mgr = new SpawnManager(baseCwd, () => {});
      expect(mgr.getTasks()).toHaveLength(0);
      expect(mgr.getRunningCount()).toBe(0);
    });

    it("assigns incrementing IDs", () => {
      const mgr = new SpawnManager(baseCwd, () => {});
      mgr.addConfig(makeConfig());

      const id1 = mgr.spawn("task 1");
      const id2 = mgr.spawn("task 2");
      const id3 = mgr.spawn("task 3");

      expect(id1).toBe(1);
      expect(id2).toBe(2);
      expect(id3).toBe(3);
    });

    it("creates tasks with correct initial state", () => {
      const mgr = new SpawnManager(baseCwd, () => {});
      mgr.addConfig(makeConfig("anthropic"));

      mgr.spawn("test goal");
      const task = mgr.getTask(1);

      expect(task).toBeDefined();
      expect(task!.goal).toBe("test goal");
      expect(task!.provider).toBe("anthropic");
      expect(task!.model).toBe("test-model");
      // Status will be queued or running (async)
      expect(["queued", "running", "failed"]).toContain(task!.status);
    });

    it("getTasks returns a copy", () => {
      const mgr = new SpawnManager(baseCwd, () => {});
      mgr.addConfig(makeConfig());
      mgr.spawn("task 1");

      const tasks1 = mgr.getTasks();
      const tasks2 = mgr.getTasks();
      expect(tasks1).not.toBe(tasks2);
      expect(tasks1).toEqual(tasks2);
    });

    it("getTask returns undefined for unknown id", () => {
      const mgr = new SpawnManager(baseCwd, () => {});
      expect(mgr.getTask(999)).toBeUndefined();
    });
  });

  describe("provider distribution", () => {
    it("round-robins across providers", () => {
      const mgr = new SpawnManager(baseCwd, () => {});
      mgr.addConfig(makeConfig("anthropic"));
      mgr.addConfig(makeConfig("codex"));
      mgr.addConfig(makeConfig("ollama"));

      mgr.spawn("task 1");
      mgr.spawn("task 2");
      mgr.spawn("task 3");

      const tasks = mgr.getTasks();
      expect(tasks[0]!.provider).toBe("anthropic");
      expect(tasks[1]!.provider).toBe("codex");
      expect(tasks[2]!.provider).toBe("ollama");
    });

    it("uses preferred provider when specified", () => {
      const mgr = new SpawnManager(baseCwd, () => {});
      mgr.addConfig(makeConfig("anthropic"));
      mgr.addConfig(makeConfig("ollama"));

      mgr.spawn("task 1", "ollama");

      const task = mgr.getTask(1);
      expect(task!.provider).toBe("ollama");
    });

    it("falls back to first config when preferred not found", () => {
      const mgr = new SpawnManager(baseCwd, () => {});
      mgr.addConfig(makeConfig("anthropic"));

      mgr.spawn("task 1", "codex"); // codex not registered

      const task = mgr.getTask(1);
      expect(task!.provider).toBe("anthropic");
    });
  });

  describe("onUpdate callback", () => {
    it("fires on spawn", () => {
      const updates: SpawnedTask[] = [];
      const mgr = new SpawnManager(baseCwd, (t) => updates.push({ ...t }));
      mgr.addConfig(makeConfig());

      mgr.spawn("test");

      // Should have at least 1 update (queued)
      expect(updates.length).toBeGreaterThanOrEqual(1);
      expect(updates[0]!.goal).toBe("test");
    });
  });

  describe("clearCompleted", () => {
    it("returns 0 when nothing to clear", () => {
      const mgr = new SpawnManager(baseCwd, () => {});
      expect(mgr.clearCompleted()).toBe(0);
    });
  });

  describe("formatStatus", () => {
    it("returns message when no tasks", () => {
      const mgr = new SpawnManager(baseCwd, () => {});
      expect(mgr.formatStatus()).toBe("No spawned tasks.");
    });

    it("includes task info", () => {
      const mgr = new SpawnManager(baseCwd, () => {});
      mgr.addConfig(makeConfig("anthropic"));
      mgr.spawn("add validation");

      const status = mgr.formatStatus();
      expect(status).toContain("#1");
      expect(status).toContain("add validation");
      expect(status).toContain("anthropic");
    });
  });

  describe("formatResults", () => {
    it("returns message when no completed tasks", () => {
      const mgr = new SpawnManager(baseCwd, () => {});
      expect(mgr.formatResults()).toBe("No completed tasks yet.");
    });
  });

  describe("getCompletedTasks", () => {
    it("returns empty when all running", () => {
      const mgr = new SpawnManager(baseCwd, () => {});
      mgr.addConfig(makeConfig());
      mgr.spawn("task");
      // Task will be queued/running/failed, not "done"
      // Wait a tick for async state
      expect(mgr.getCompletedTasks().filter(t => t.status === "done")).toHaveLength(0);
    });
  });
});
