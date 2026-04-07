import { describe, it, expect, vi, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Verifier } from "./verify.js";
import type { ProviderName } from "./types.js";

// Mock MultiProvider
function createMockMulti(response: string, registeredProviders?: { name: ProviderName; model: string }[]) {
  return {
    getRegistered: () => registeredProviders ?? [
      { name: "anthropic" as ProviderName, model: "claude-sonnet-4-20250514" },
      { name: "ollama" as ProviderName, model: "llama3" },
    ],
    ask: vi.fn().mockResolvedValue({ text: response }),
  };
}

describe("Verifier", () => {
  describe("trackChange and hasPendingChanges", () => {
    it("starts with no pending changes", () => {
      const multi = createMockMulti("");
      const verifier = new Verifier(multi as any, "anthropic", "/tmp");
      expect(verifier.hasPendingChanges()).toBe(false);
    });

    it("tracks file changes", () => {
      const multi = createMockMulti("");
      const verifier = new Verifier(multi as any, "anthropic", "/tmp");
      verifier.trackChange("src/foo.ts", "write", undefined, "const x = 1;");
      expect(verifier.hasPendingChanges()).toBe(true);
    });

    it("clears tracked changes", () => {
      const multi = createMockMulti("");
      const verifier = new Verifier(multi as any, "anthropic", "/tmp");
      verifier.trackChange("src/foo.ts", "write", undefined, "const x = 1;");
      verifier.clear();
      expect(verifier.hasPendingChanges()).toBe(false);
    });
  });

  describe("verify", () => {
    it("uses a different provider than the primary", async () => {
      const multi = createMockMulti("CONFIDENCE: 90\nISSUES:\nEND");
      const verifier = new Verifier(multi as any, "anthropic", "/tmp");
      verifier.trackChange("src/foo.ts", "write", undefined, "const x = 1;");

      await verifier.verify();
      expect(multi.ask).toHaveBeenCalledWith("ollama", expect.any(String), undefined, undefined);
    });

    it("uses preferred provider when explicitly set", async () => {
      const multi = createMockMulti("CONFIDENCE: 90\nISSUES:\nEND", [
        { name: "anthropic" as ProviderName, model: "claude-sonnet-4-20250514" },
        { name: "ollama" as ProviderName, model: "llama3" },
        { name: "codex" as ProviderName, model: "gpt-5.4" },
      ]);
      const verifier = new Verifier(multi as any, "anthropic", "/tmp");
      verifier.setProvider("codex" as ProviderName);
      verifier.trackChange("src/foo.ts", "write", undefined, "const x = 1;");

      await verifier.verify();
      expect(multi.ask).toHaveBeenCalledWith("codex", expect.any(String), undefined, undefined);
    });

    it("getProvider returns the set provider", () => {
      const multi = createMockMulti("");
      const verifier = new Verifier(multi as any, "anthropic", "/tmp");
      expect(verifier.getProvider()).toBeNull();
      verifier.setProvider("ollama" as ProviderName);
      expect(verifier.getProvider()).toBe("ollama");
      verifier.setProvider(null);
      expect(verifier.getProvider()).toBeNull();
    });

    it("passes model override to multi.ask when set", async () => {
      const multi = createMockMulti("CONFIDENCE: 90\nISSUES:\nEND");
      const verifier = new Verifier(multi as any, "anthropic", "/tmp");
      verifier.setProvider("ollama" as ProviderName, "llama3:70b");
      verifier.trackChange("src/foo.ts", "write", undefined, "const x = 1;");

      await verifier.verify();
      expect(multi.ask).toHaveBeenCalledWith("ollama", expect.any(String), "llama3:70b", undefined);
      expect(verifier.getModel()).toBe("llama3:70b");
    });

    it("passes effort override to multi.ask when set", async () => {
      const multi = createMockMulti("CONFIDENCE: 90\nISSUES:\nEND", [
        { name: "anthropic" as ProviderName, model: "claude-sonnet-4-20250514" },
        { name: "codex" as ProviderName, model: "gpt-5.4" },
      ]);
      const verifier = new Verifier(multi as any, "anthropic", "/tmp");
      verifier.setProvider("codex" as ProviderName, "gpt-5.4", "high");
      verifier.trackChange("src/foo.ts", "write", undefined, "const x = 1;");

      await verifier.verify();
      expect(multi.ask).toHaveBeenCalledWith("codex", expect.any(String), "gpt-5.4", "high");
      expect(verifier.getEffort()).toBe("high");
    });

    it("clears model when provider set to null", () => {
      const multi = createMockMulti("");
      const verifier = new Verifier(multi as any, "anthropic", "/tmp");
      verifier.setProvider("ollama" as ProviderName, "llama3:70b");
      expect(verifier.getModel()).toBe("llama3:70b");
      verifier.setProvider(null);
      expect(verifier.getModel()).toBeNull();
      expect(verifier.getProvider()).toBeNull();
    });

    it("ignores preferred provider if not registered, falls back to auto", async () => {
      const multi = createMockMulti("CONFIDENCE: 90\nISSUES:\nEND", [
        { name: "anthropic" as ProviderName, model: "claude" },
        { name: "ollama" as ProviderName, model: "llama3" },
      ]);
      const verifier = new Verifier(multi as any, "anthropic", "/tmp");
      verifier.setProvider("codex" as ProviderName); // not registered
      verifier.trackChange("src/foo.ts", "write", undefined, "code");

      await verifier.verify();
      expect(multi.ask).toHaveBeenCalledWith("ollama", expect.any(String), undefined, undefined);
    });

    it("falls back to primary provider when only one is available", async () => {
      const multi = createMockMulti("CONFIDENCE: 80\nISSUES:\nEND", [
        { name: "anthropic" as ProviderName, model: "claude-sonnet-4-20250514" },
      ]);
      const verifier = new Verifier(multi as any, "anthropic", "/tmp");
      verifier.trackChange("src/foo.ts", "write", undefined, "const x = 1;");

      await verifier.verify();
      expect(multi.ask).toHaveBeenCalledWith("anthropic", expect.any(String), undefined, undefined);
    });

    it("parses confidence score", async () => {
      const multi = createMockMulti("CONFIDENCE: 85\nISSUES:\nEND");
      const verifier = new Verifier(multi as any, "anthropic", "/tmp");
      verifier.trackChange("src/foo.ts", "write", undefined, "code");

      const result = await verifier.verify();
      expect(result.confidence).toBe(85);
      expect(result.verified).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("parses issues correctly", async () => {
      const response = `CONFIDENCE: 60
ISSUES:
[severity: warning] [file: src/foo.ts] Potential N+1 query in fetchUsers
[severity: error] [file: src/bar.ts] SQL injection via unsanitized input
[severity: info] [file: src/foo.ts] Consider adding input validation
END`;
      const multi = createMockMulti(response);
      const verifier = new Verifier(multi as any, "anthropic", "/tmp");
      verifier.trackChange("src/foo.ts", "write", undefined, "code");

      const result = await verifier.verify();
      expect(result.confidence).toBe(60);
      expect(result.verified).toBe(false); // has error-level issue
      expect(result.issues).toHaveLength(3);
      expect(result.issues[0]).toEqual({
        severity: "warning",
        file: "src/foo.ts",
        description: "Potential N+1 query in fetchUsers",
      });
      expect(result.issues[1]).toEqual({
        severity: "error",
        file: "src/bar.ts",
        description: "SQL injection via unsanitized input",
      });
      expect(result.issues[2]).toEqual({
        severity: "info",
        file: "src/foo.ts",
        description: "Consider adding input validation",
      });
    });

    it("returns verified=true when no error-level issues", async () => {
      const response = `CONFIDENCE: 75
ISSUES:
[severity: warning] [file: src/foo.ts] Minor: unused variable
END`;
      const multi = createMockMulti(response);
      const verifier = new Verifier(multi as any, "anthropic", "/tmp");
      verifier.trackChange("src/foo.ts", "edit", "old", "new");

      const result = await verifier.verify();
      expect(result.verified).toBe(true);
      expect(result.issues).toHaveLength(1);
    });

    it("clamps confidence to 0-100", async () => {
      const multi = createMockMulti("CONFIDENCE: 150\nISSUES:\nEND");
      const verifier = new Verifier(multi as any, "anthropic", "/tmp");
      verifier.trackChange("src/foo.ts", "write", undefined, "code");

      const result = await verifier.verify();
      expect(result.confidence).toBe(100);
    });

    it("defaults confidence to 50 when not parseable", async () => {
      const multi = createMockMulti("some random response without format");
      const verifier = new Verifier(multi as any, "anthropic", "/tmp");
      verifier.trackChange("src/foo.ts", "write", undefined, "code");

      const result = await verifier.verify();
      expect(result.confidence).toBe(50);
    });

    it("handles provider errors gracefully", async () => {
      const multi = {
        getRegistered: () => [
          { name: "anthropic" as ProviderName, model: "claude" },
          { name: "ollama" as ProviderName, model: "llama3" },
        ],
        ask: vi.fn().mockRejectedValue(new Error("connection refused")),
      };
      const verifier = new Verifier(multi as any, "anthropic", "/tmp");
      verifier.trackChange("src/foo.ts", "write", undefined, "code");

      const result = await verifier.verify();
      expect(result.verified).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.severity).toBe("error");
    });

    it("includes timing information", async () => {
      const multi = createMockMulti("CONFIDENCE: 90\nISSUES:\nEND");
      const verifier = new Verifier(multi as any, "anthropic", "/tmp");
      verifier.trackChange("src/foo.ts", "write", undefined, "code");

      const result = await verifier.verify();
      expect(result.ms).toBeGreaterThanOrEqual(0);
      expect(result.provider).toBe("ollama");
    });

    it("includes edit diffs in the review prompt", async () => {
      const multi = createMockMulti("CONFIDENCE: 90\nISSUES:\nEND");
      const verifier = new Verifier(multi as any, "anthropic", "/tmp");
      verifier.trackChange("src/foo.ts", "edit", "const x = 1;", "const x = 2;");

      await verifier.verify();
      const prompt = multi.ask.mock.calls[0]![1] as string;
      expect(prompt).toContain("const x = 1;");
      expect(prompt).toContain("const x = 2;");
      expect(prompt).toContain("Before:");
      expect(prompt).toContain("After:");
    });

    it("includes local verification checks in the review prompt", async () => {
      const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paw-verify-"));
      await fs.writeFile(path.join(cwd, "package.json"), JSON.stringify({
        name: "verify-checks",
        scripts: {
          check: "node -e \"console.log('types ok')\"",
        },
      }));

      const multi = createMockMulti("VERDICT: PASS\nCONFIDENCE: 90\nISSUES:\nEND");
      const verifier = new Verifier(multi as any, "anthropic", cwd);
      verifier.trackChange("src/foo.ts", "write", undefined, "const x = 1;");

      await verifier.verify();

      const prompt = multi.ask.mock.calls[0]![1] as string;
      expect(prompt).toContain("Verification checks:");
      expect(prompt).toContain("PASS check: npm run --silent check");
      expect(prompt).toContain("types ok");

      await fs.rm(cwd, { recursive: true, force: true });
    });

    it("blocks verification when a local project check fails", async () => {
      const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paw-verify-fail-"));
      await fs.writeFile(path.join(cwd, "package.json"), JSON.stringify({
        name: "verify-fail",
        scripts: {
          test: "node -e \"console.error('tests failed'); process.exit(1)\"",
        },
      }));

      const multi = createMockMulti("VERDICT: PASS\nCONFIDENCE: 95\nISSUES:\nEND");
      const verifier = new Verifier(multi as any, "anthropic", cwd);
      verifier.trackChange("src/foo.ts", "write", undefined, "const x = 1;");

      const result = await verifier.verify();

      expect(result.verified).toBe(false);
      expect(result.verdict).toBe("block");
      expect(result.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "test", ok: false, source: "script" }),
      ]));
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ severity: "error", file: "[check:test]" }),
      ]));
      expect(result.blockingSummary).toEqual(expect.arrayContaining([
        expect.stringContaining("test:"),
      ]));

      await fs.rm(cwd, { recursive: true, force: true });
    });

    it("auto-detects a fallback typecheck when no check script exists", async () => {
      const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paw-verify-fallback-"));
      await fs.mkdir(path.join(cwd, "node_modules", ".bin"), { recursive: true });
      await fs.writeFile(path.join(cwd, "package.json"), JSON.stringify({ name: "verify-fallback", scripts: {} }));
      await fs.writeFile(path.join(cwd, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022" } }));
      const fakeTsc = path.join(cwd, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
      await fs.writeFile(
        fakeTsc,
        process.platform === "win32"
          ? "@echo off\r\necho fallback typecheck ok\r\n"
          : "#!/bin/sh\necho fallback typecheck ok\n",
        { mode: 0o755 },
      );

      const multi = createMockMulti("VERDICT: PASS\nCONFIDENCE: 93\nISSUES:\nEND");
      const verifier = new Verifier(multi as any, "anthropic", cwd);
      verifier.trackChange("src/foo.ts", "write", undefined, "const x = 1;");

      const result = await verifier.verify();

      expect(result.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "check", ok: true, source: "fallback" }),
      ]));
      expect(result.verified).toBe(true);

      await fs.rm(cwd, { recursive: true, force: true });
    });
  });
});
