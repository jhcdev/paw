import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSession, saveSession, type SessionData } from "./session.js";

let tmpDir: string;
let fakeHome: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paw-session-test-"));
  fakeHome = path.join(tmpDir, "_home");
  await fs.mkdir(fakeHome, { recursive: true });
  vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("session persistence", () => {
  it("persists verify history in session files", async () => {
    const session: SessionData = {
      id: "abc123",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      mode: "solo",
      cwd: "/tmp/project",
      createdAt: "2026-04-07T00:00:00.000Z",
      updatedAt: "2026-04-07T00:00:01.000Z",
      entries: [
        { role: "user", text: "hello", timestamp: "2026-04-07T00:00:00.500Z" },
      ],
      inputHistory: ["hello"],
      verifyHistory: [
        {
          id: "verify-1",
          timestamp: "2026-04-07T00:00:01.000Z",
          result: {
            verified: false,
            verdict: "block",
            confidence: 80,
            issues: [{ severity: "error", file: "src/app.ts", description: "test failed" }],
            checks: [{
              name: "test",
              command: "npm run --silent test",
              source: "script",
              ok: false,
              summary: "tests failed",
              fullOutput: "full failing log",
              output: "tests failed",
            }],
            blockingSummary: ["test: tests failed"],
            provider: "ollama",
            ms: 1200,
          },
        },
      ],
    };

    await saveSession(session);
    const loaded = await loadSession(session.id);

    expect(loaded?.verifyHistory).toHaveLength(1);
    expect(loaded?.verifyHistory?.[0]?.result.checks[0]?.fullOutput).toBe("full failing log");
    expect(loaded?.verifyHistory?.[0]?.result.blockingSummary[0]).toContain("test:");
  });
});
