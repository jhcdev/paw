import { describe, it, expect, vi, beforeEach } from "vitest";
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
      expect(multi.ask).toHaveBeenCalledWith("ollama", expect.any(String));
    });

    it("falls back to primary provider when only one is available", async () => {
      const multi = createMockMulti("CONFIDENCE: 80\nISSUES:\nEND", [
        { name: "anthropic" as ProviderName, model: "claude-sonnet-4-20250514" },
      ]);
      const verifier = new Verifier(multi as any, "anthropic", "/tmp");
      verifier.trackChange("src/foo.ts", "write", undefined, "const x = 1;");

      await verifier.verify();
      expect(multi.ask).toHaveBeenCalledWith("anthropic", expect.any(String));
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
  });
});
