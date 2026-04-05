import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CodingAgent } from "./agent.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// Mock createProvider to avoid real API calls
vi.mock("./providers/index.js", () => ({
  createProvider: vi.fn(() => ({
    messages: [] as { role: string; content: unknown }[],
    runTurn: vi.fn(async (prompt: string) => {
      // Track the prompt for assertions
      (mockProvider as any)._lastPrompt = prompt;
      (mockProvider as any)._prompts.push(prompt);
      return { text: "mock response", usage: { inputTokens: 100, outputTokens: 50 } };
    }),
    clear: vi.fn(function (this: any) { this.messages = []; }),
    setToolHooks: vi.fn(),
    setSafetyConfig: vi.fn(),
  })),
}));

let mockProvider: any;
let tmpDir: string;
let fakeHome: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paw-agent-test-"));
  fakeHome = path.join(tmpDir, "_home");
  await fs.mkdir(path.join(fakeHome, ".paw", "memory"), { recursive: true });
  await fs.mkdir(path.join(fakeHome, ".paw", "hooks"), { recursive: true });
  vi.spyOn(os, "homedir").mockReturnValue(fakeHome);

  // Reset the mock
  const { createProvider } = await import("./providers/index.js");
  mockProvider = (createProvider as any)();
  mockProvider._lastPrompt = "";
  mockProvider._prompts = [];
  (createProvider as any).mockReturnValue(mockProvider);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function createAgent(cwd?: string) {
  return new CodingAgent({
    provider: "anthropic",
    apiKey: "test-key",
    model: "claude-sonnet-4-20250514",
    cwd: cwd ?? tmpDir,
  });
}

describe("CodingAgent", () => {
  describe("constructor and basic state", () => {
    it("creates agent with provider info", () => {
      const agent = createAgent();
      expect(agent.getActiveProvider()).toBe("anthropic");
      expect(agent.getActiveModel()).toBe("claude-sonnet-4-20250514");
    });

    it("starts with empty usage", () => {
      const agent = createAgent();
      const total = agent.tracker.getTotal();
      expect(total.totalTokens).toBe(0);
    });
  });

  describe("runTurn", () => {
    it("calls provider.runTurn with prompt", async () => {
      const agent = createAgent();
      const result = await agent.runTurn("hello");
      expect(result.text).toBe("mock response");
      expect(mockProvider.runTurn).toHaveBeenCalled();
    });

    it("tracks usage after each turn", async () => {
      const agent = createAgent();
      await agent.runTurn("hello");
      const breakdown = agent.tracker.getBreakdown();
      expect(breakdown).toHaveLength(1);
      expect(breakdown[0]!.inputTokens).toBe(100);
      expect(breakdown[0]!.outputTokens).toBe(50);
      expect(breakdown[0]!.requests).toBe(1);
    });

    it("accumulates usage across turns", async () => {
      const agent = createAgent();
      await agent.runTurn("first");
      await agent.runTurn("second");
      const breakdown = agent.tracker.getBreakdown();
      expect(breakdown[0]!.requests).toBe(2);
      expect(breakdown[0]!.inputTokens).toBe(200);
    });

    it("logs activity for each turn", async () => {
      const agent = createAgent();
      await agent.runTurn("test prompt");
      const recent = agent.activityLog.getRecent(5);
      expect(recent.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("memory injection", () => {
    it("injects memory context on first turn", async () => {
      await fs.writeFile(path.join(tmpDir, "PAW.md"), "Always use TypeScript");
      const agent = createAgent();
      await agent.loadMemoryContext();
      await agent.runTurn("hello");

      expect(mockProvider._lastPrompt).toContain("[Context]");
      expect(mockProvider._lastPrompt).toContain("Always use TypeScript");
      expect(mockProvider._lastPrompt).toContain("[User]");
      expect(mockProvider._lastPrompt).toContain("hello");
    });

    it("does NOT inject memory on second turn", async () => {
      await fs.writeFile(path.join(tmpDir, "PAW.md"), "project rules");
      const agent = createAgent();
      await agent.loadMemoryContext();
      await agent.runTurn("first");
      await agent.runTurn("second");

      // Second call should just be "second", no [Context]
      expect(mockProvider._prompts[1]).toBe("second");
    });

    it("re-injects memory after clear()", async () => {
      await fs.writeFile(path.join(tmpDir, "PAW.md"), "project rules");
      const agent = createAgent();
      await agent.loadMemoryContext();
      await agent.runTurn("first");
      agent.clear();
      await agent.runTurn("after clear");

      const lastPrompt = mockProvider._prompts[mockProvider._prompts.length - 1];
      expect(lastPrompt).toContain("[Context]");
      expect(lastPrompt).toContain("project rules");
    });

    it("works without PAW.md (no injection)", async () => {
      const agent = createAgent();
      await agent.loadMemoryContext();
      await agent.runTurn("hello");

      expect(mockProvider._lastPrompt).toBe("hello");
    });
  });

  describe("clear", () => {
    it("clears provider messages", () => {
      const agent = createAgent();
      agent.clear();
      expect(mockProvider.clear).toHaveBeenCalled();
    });

    it("resets memoryInjected flag", async () => {
      await fs.writeFile(path.join(tmpDir, "PAW.md"), "rules");
      const agent = createAgent();
      await agent.loadMemoryContext();
      await agent.runTurn("first"); // injects memory
      agent.clear();
      await agent.runTurn("second"); // should inject again

      const secondPrompt = mockProvider._prompts[mockProvider._prompts.length - 1];
      expect(secondPrompt).toContain("[Context]");
    });
  });

  describe("getters", () => {
    it("getActiveProvider returns current provider", () => {
      const agent = createAgent();
      expect(agent.getActiveProvider()).toBe("anthropic");
    });

    it("getActiveModel returns current model", () => {
      const agent = createAgent();
      expect(agent.getActiveModel()).toBe("claude-sonnet-4-20250514");
    });

    it("getMulti returns MultiProvider", () => {
      const agent = createAgent();
      const multi = agent.getMulti();
      expect(multi).toBeDefined();
      expect(multi.getRegistered().length).toBeGreaterThanOrEqual(1);
    });

    it("getTeam returns TeamRunner", () => {
      const agent = createAgent();
      expect(agent.getTeam()).toBeDefined();
    });

    it("getHooks returns HookManager", () => {
      const agent = createAgent();
      expect(agent.getHooks()).toBeDefined();
    });

    it("getMcpStatus returns empty when no MCP", () => {
      const agent = createAgent();
      expect(agent.getMcpStatus()).toEqual([]);
    });

    it("getMcpTools returns empty when no MCP", () => {
      const agent = createAgent();
      expect(agent.getMcpTools()).toEqual([]);
    });
  });

  describe("shouldAutoCompact", () => {
    it("returns false when few messages", () => {
      const agent = createAgent();
      expect(agent.shouldAutoCompact()).toBe(false);
    });

    it("returns true when messages exceed threshold", () => {
      const agent = createAgent();
      // Fill messages array to trigger
      for (let i = 0; i < 35; i++) {
        mockProvider.messages.push({ role: "user", content: `msg ${i}` });
      }
      expect(agent.shouldAutoCompact()).toBe(true);
    });
  });

  describe("switchProvider", () => {
    it("switches to a registered provider", () => {
      const agent = createAgent();
      // Register another provider
      agent.getMulti().register("ollama", "", "qwen3");

      const result = agent.switchProvider("ollama");
      expect(result.ok).toBe(true);
      expect(agent.getActiveProvider()).toBe("ollama");
    });

    it("fails for unregistered provider", () => {
      const agent = createAgent();
      const result = agent.switchProvider("codex");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("not configured");
    });

    it("accepts model override", () => {
      const agent = createAgent();
      agent.getMulti().register("ollama", "", "qwen3");

      const result = agent.switchProvider("ollama", "llama3");
      expect(result.ok).toBe(true);
      expect(agent.getActiveModel()).toBe("llama3");
    });
  });

  describe("effort", () => {
    it("returns default effort when provider has no getEffort", () => {
      const agent = createAgent();
      expect(agent.getEffort()).toBe("medium"); // default fallback
    });

    it("delegates to provider when setEffort/getEffort available", () => {
      const agent = createAgent();
      // Add effort methods to mock
      let effort = "medium";
      mockProvider.setEffort = (e: string) => { effort = e; };
      mockProvider.getEffort = () => effort;

      agent.setEffort("high");
      expect(agent.getEffort()).toBe("high");
    });
  });

  describe("verify", () => {
    it("starts with verify disabled", () => {
      const agent = createAgent();
      expect(agent.isVerifyEnabled()).toBe(false);
    });
  });

  describe("runStopHook", () => {
    it("returns not blocked when no hooks configured", async () => {
      const agent = createAgent();
      const result = await agent.runStopHook();
      expect(result.blocked).toBe(false);
    });
  });

  describe("shutdown", () => {
    it("disconnects MCP without error", async () => {
      const agent = createAgent();
      await agent.shutdown();
      // Should not throw
    });
  });

  describe("activity log", () => {
    it("records prompts and responses", async () => {
      const agent = createAgent();
      await agent.runTurn("test");

      const recent = agent.activityLog.getRecent(10);
      expect(recent.length).toBeGreaterThanOrEqual(1);
    });
  });
});
