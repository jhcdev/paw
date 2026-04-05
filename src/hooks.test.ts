import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HookManager, type HookEvent, type HookResult } from "./hooks.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// Use a temp dir for isolated tests
let tmpDir: string;
let fakeHome: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paw-hooks-test-"));
  fakeHome = path.join(tmpDir, "_home");
  await fs.mkdir(fakeHome, { recursive: true });
  // Mock os.homedir to isolate from real user hooks
  vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// Helper: create a markdown hook file
async function createMdHook(dir: string, filename: string, frontmatter: Record<string, string>) {
  await fs.mkdir(dir, { recursive: true });
  const lines = ["---", ...Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`), "---", ""];
  await fs.writeFile(path.join(dir, filename), lines.join("\n"), "utf8");
}

// Helper: create settings.json with hooks
async function createSettings(dir: string, hooks: Record<string, unknown[]>) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "settings.json"), JSON.stringify({ hooks }, null, 2), "utf8");
}

describe("HookManager", () => {
  describe("load - markdown hooks", () => {
    it("loads project markdown hooks from .paw/hooks/", async () => {
      const hooksDir = path.join(tmpDir, ".paw", "hooks");
      await createMdHook(hooksDir, "test.md", {
        event: "post-turn",
        command: "echo hello",
        name: "test-hook",
      });

      const mgr = new HookManager(tmpDir);
      await mgr.load();

      const hooks = mgr.listHooks();
      expect(hooks).toHaveLength(1);
      expect(hooks[0]!.event).toBe("post-turn");
      expect(hooks[0]!.command).toBe("echo hello");
      expect(hooks[0]!.name).toBe("test-hook");
      expect(hooks[0]!.source).toBe(".paw/hooks");
    });

    it("ignores markdown hooks with invalid events", async () => {
      const hooksDir = path.join(tmpDir, ".paw", "hooks");
      await createMdHook(hooksDir, "bad.md", {
        event: "invalid-event",
        command: "echo bad",
      });

      const mgr = new HookManager(tmpDir);
      await mgr.load();
      expect(mgr.listHooks()).toHaveLength(0);
    });

    it("ignores markdown hooks without required fields", async () => {
      const hooksDir = path.join(tmpDir, ".paw", "hooks");
      await createMdHook(hooksDir, "no-cmd.md", { event: "pre-turn" });

      const mgr = new HookManager(tmpDir);
      await mgr.load();
      expect(mgr.listHooks()).toHaveLength(0);
    });
  });

  describe("load - settings.json hooks", () => {
    it("loads hooks from .paw/settings.json", async () => {
      await createSettings(path.join(tmpDir, ".paw"), {
        "pre-tool": [
          {
            matcher: "run_shell",
            hooks: [{ type: "command", command: "echo pre-tool" }],
          },
        ],
      });

      const mgr = new HookManager(tmpDir);
      await mgr.load();

      const hooks = mgr.listHooks();
      expect(hooks).toHaveLength(1);
      expect(hooks[0]!.event).toBe("pre-tool");
      expect(hooks[0]!.matcher).toBe("run_shell");
      expect(hooks[0]!.source).toBe(".paw/settings.json");
    });

    it("handles missing settings.json gracefully", async () => {
      const mgr = new HookManager(tmpDir);
      await mgr.load();
      expect(mgr.listHooks()).toHaveLength(0);
    });

    it("ignores invalid JSON in settings", async () => {
      await fs.mkdir(path.join(tmpDir, ".paw"), { recursive: true });
      await fs.writeFile(path.join(tmpDir, ".paw", "settings.json"), "not json", "utf8");

      const mgr = new HookManager(tmpDir);
      await mgr.load();
      expect(mgr.listHooks()).toHaveLength(0);
    });
  });

  describe("getEntries - matcher filtering", () => {
    it("returns all entries when no matchValue provided", async () => {
      await createSettings(path.join(tmpDir, ".paw"), {
        "pre-tool": [
          { matcher: "run_shell", hooks: [{ type: "command", command: "echo a" }] },
          { matcher: "edit_file", hooks: [{ type: "command", command: "echo b" }] },
        ],
      });

      const mgr = new HookManager(tmpDir);
      await mgr.load();

      const entries = mgr.getEntries("pre-tool");
      expect(entries).toHaveLength(2);
    });

    it("filters by matchValue using regex", async () => {
      await createSettings(path.join(tmpDir, ".paw"), {
        "pre-tool": [
          { matcher: "run_shell", hooks: [{ type: "command", command: "echo shell" }] },
          { matcher: "edit_file|write_file", hooks: [{ type: "command", command: "echo edit" }] },
        ],
      });

      const mgr = new HookManager(tmpDir);
      await mgr.load();

      expect(mgr.getEntries("pre-tool", "run_shell")).toHaveLength(1);
      expect(mgr.getEntries("pre-tool", "edit_file")).toHaveLength(1);
      expect(mgr.getEntries("pre-tool", "write_file")).toHaveLength(1);
      expect(mgr.getEntries("pre-tool", "read_file")).toHaveLength(0);
    });

    it("entries without matcher match everything", async () => {
      await createSettings(path.join(tmpDir, ".paw"), {
        "post-tool": [
          { hooks: [{ type: "command", command: "echo always" }] },
        ],
      });

      const mgr = new HookManager(tmpDir);
      await mgr.load();

      expect(mgr.getEntries("post-tool", "any_tool")).toHaveLength(1);
      expect(mgr.getEntries("post-tool", "another")).toHaveLength(1);
    });

    it("skips entries with invalid regex", async () => {
      await createSettings(path.join(tmpDir, ".paw"), {
        "pre-tool": [
          { matcher: "[invalid", hooks: [{ type: "command", command: "echo bad" }] },
        ],
      });

      const mgr = new HookManager(tmpDir);
      await mgr.load();

      expect(mgr.getEntries("pre-tool", "anything")).toHaveLength(0);
    });
  });

  describe("run - command execution", () => {
    it("runs a simple command and returns stdout", async () => {
      await createSettings(path.join(tmpDir, ".paw"), {
        "pre-turn": [
          { hooks: [{ type: "command", command: "echo 'injected context'" }] },
        ],
      });

      const mgr = new HookManager(tmpDir);
      await mgr.load();

      const results = await mgr.run("pre-turn", { prompt: "hello" });
      expect(results).toHaveLength(1);
      expect(results[0]!.exitCode).toBe(0);
      expect(results[0]!.blocked).toBe(false);
      expect(results[0]!.additionalContext).toBe("injected context");
    });

    it("passes JSON via stdin", async () => {
      // Use a command that reads stdin and echoes a field
      await createSettings(path.join(tmpDir, ".paw"), {
        "pre-tool": [
          { hooks: [{ type: "command", command: "cat | jq -r '.tool_name // empty'" }] },
        ],
      });

      const mgr = new HookManager(tmpDir);
      await mgr.load();

      const results = await mgr.run("pre-tool", { tool_name: "run_shell" }, "run_shell");
      expect(results).toHaveLength(1);
      expect(results[0]!.additionalContext).toBe("run_shell");
    });

    it("exit code 2 = blocked", async () => {
      await createSettings(path.join(tmpDir, ".paw"), {
        "pre-tool": [
          { matcher: "run_shell", hooks: [{ type: "command", command: "echo 'dangerous command' >&2; exit 2" }] },
        ],
      });

      const mgr = new HookManager(tmpDir);
      await mgr.load();

      const results = await mgr.run("pre-tool", { tool_name: "run_shell" }, "run_shell");
      expect(results).toHaveLength(1);
      expect(results[0]!.exitCode).toBe(2);
      expect(results[0]!.blocked).toBe(true);
      expect(results[0]!.stderr).toContain("dangerous command");
    });

    it("other exit codes = not blocked", async () => {
      await createSettings(path.join(tmpDir, ".paw"), {
        "post-turn": [
          { hooks: [{ type: "command", command: "exit 1" }] },
        ],
      });

      const mgr = new HookManager(tmpDir);
      await mgr.load();

      const results = await mgr.run("post-turn", { response: "test" });
      expect(results).toHaveLength(1);
      expect(results[0]!.exitCode).toBe(1);
      expect(results[0]!.blocked).toBe(false);
    });

    it("returns empty array when no hooks match", async () => {
      const mgr = new HookManager(tmpDir);
      await mgr.load();

      const results = await mgr.run("pre-turn", {});
      expect(results).toHaveLength(0);
    });

    it("filters hooks by matchValue during run", async () => {
      await createSettings(path.join(tmpDir, ".paw"), {
        "post-tool": [
          { matcher: "edit_file", hooks: [{ type: "command", command: "echo matched" }] },
          { matcher: "run_shell", hooks: [{ type: "command", command: "echo not-matched" }] },
        ],
      });

      const mgr = new HookManager(tmpDir);
      await mgr.load();

      const results = await mgr.run("post-tool", { tool_name: "edit_file" }, "edit_file");
      expect(results).toHaveLength(1);
      expect(results[0]!.additionalContext).toBe("matched");
    });

    it("runs multiple hooks in parallel", async () => {
      await createSettings(path.join(tmpDir, ".paw"), {
        "post-turn": [
          { hooks: [
            { type: "command", command: "echo hook1" },
            { type: "command", command: "echo hook2" },
          ]},
        ],
      });

      const mgr = new HookManager(tmpDir);
      await mgr.load();

      const results = await mgr.run("post-turn", {});
      expect(results).toHaveLength(2);
      const contexts = results.map(r => r.additionalContext).sort();
      expect(contexts).toEqual(["hook1", "hook2"]);
    });

    it("sets environment variables PAW_EVENT and PAW_CWD", async () => {
      await createSettings(path.join(tmpDir, ".paw"), {
        "session-start": [
          { hooks: [{ type: "command", command: "echo $PAW_EVENT" }] },
        ],
      });

      const mgr = new HookManager(tmpDir);
      await mgr.load();

      const results = await mgr.run("session-start", { source: "startup" });
      expect(results[0]!.additionalContext).toBe("session-start");
    });

    it("sets PAW_TOOL_NAME for tool events", async () => {
      await createSettings(path.join(tmpDir, ".paw"), {
        "pre-tool": [
          { hooks: [{ type: "command", command: "echo $PAW_TOOL_NAME" }] },
        ],
      });

      const mgr = new HookManager(tmpDir);
      await mgr.load();

      const results = await mgr.run("pre-tool", { tool_name: "edit_file" }, "edit_file");
      expect(results[0]!.additionalContext).toBe("edit_file");
    });
  });

  describe("listHooks", () => {
    it("lists all hooks with metadata", async () => {
      const hooksDir = path.join(tmpDir, ".paw", "hooks");
      await createMdHook(hooksDir, "lint.md", {
        event: "post-tool",
        command: "npm run lint",
        name: "auto-lint",
      });
      await createSettings(path.join(tmpDir, ".paw"), {
        "pre-tool": [
          { matcher: "run_shell", hooks: [{ type: "command", command: "validate.sh" }] },
        ],
      });

      const mgr = new HookManager(tmpDir);
      await mgr.load();

      const hooks = mgr.listHooks();
      expect(hooks).toHaveLength(2);

      const mdHook = hooks.find(h => h.name === "auto-lint");
      expect(mdHook).toBeDefined();
      expect(mdHook!.event).toBe("post-tool");
      expect(mdHook!.source).toBe(".paw/hooks");

      const jsonHook = hooks.find(h => h.command === "validate.sh");
      expect(jsonHook).toBeDefined();
      expect(jsonHook!.matcher).toBe("run_shell");
      expect(jsonHook!.source).toBe(".paw/settings.json");
    });
  });

  describe("new events", () => {
    it("supports stop event", async () => {
      await createSettings(path.join(tmpDir, ".paw"), {
        "stop": [
          { hooks: [{ type: "command", command: "echo 'check complete'" }] },
        ],
      });

      const mgr = new HookManager(tmpDir);
      await mgr.load();

      const results = await mgr.run("stop", {});
      expect(results).toHaveLength(1);
      expect(results[0]!.additionalContext).toBe("check complete");
    });

    it("supports post-tool-failure event", async () => {
      await createSettings(path.join(tmpDir, ".paw"), {
        "post-tool-failure": [
          { matcher: "run_shell", hooks: [{ type: "command", command: "echo failed" }] },
        ],
      });

      const mgr = new HookManager(tmpDir);
      await mgr.load();

      const results = await mgr.run("post-tool-failure", { tool_name: "run_shell", error: "timeout" }, "run_shell");
      expect(results).toHaveLength(1);
      expect(results[0]!.additionalContext).toBe("failed");
    });

    it("supports notification event", async () => {
      await createSettings(path.join(tmpDir, ".paw"), {
        "notification": [
          { hooks: [{ type: "command", command: "echo notified" }] },
        ],
      });

      const mgr = new HookManager(tmpDir);
      await mgr.load();

      const results = await mgr.run("notification", {});
      expect(results).toHaveLength(1);
    });
  });
});
