import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSession, saveSession, searchSessions, type SessionData } from "./session.js";

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


describe("searchSessions", () => {
  it("ranks the most relevant matching sessions first and excludes the current session", async () => {
    const sessions: SessionData[] = [
      {
        id: "current",
        provider: "codex",
        model: "gpt-5.4",
        mode: "solo",
        cwd: "/tmp/project",
        createdAt: "2026-04-12T00:00:00.000Z",
        updatedAt: "2026-04-12T00:00:10.000Z",
        entries: [
          { role: "user", text: "current jwt auth task", timestamp: "2026-04-12T00:00:01.000Z" },
        ],
      },
      {
        id: "s1",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        mode: "solo",
        cwd: "/tmp/project",
        createdAt: "2026-04-11T00:00:00.000Z",
        updatedAt: "2026-04-11T00:00:10.000Z",
        entries: [
          { role: "user", text: "implement jwt auth middleware", timestamp: "2026-04-11T00:00:01.000Z" },
          { role: "assistant", text: "added JWT auth validation and tests", timestamp: "2026-04-11T00:00:02.000Z" },
        ],
      },
      {
        id: "s2",
        provider: "codex",
        model: "gpt-5.4",
        mode: "solo",
        cwd: "/tmp/project",
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:10.000Z",
        entries: [
          { role: "user", text: "fix lint warnings", timestamp: "2026-04-10T00:00:01.000Z" },
          { role: "assistant", text: "lint is clean now", timestamp: "2026-04-10T00:00:02.000Z" },
        ],
      },
    ];

    for (const session of sessions) {
      await saveSession(session);
    }

    const results = await searchSessions("jwt auth", 5, "current");

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("s1");
    expect(results[0]?.matchedSnippets[0]?.text.toLowerCase()).toContain("jwt");
  });

  it("returns an empty list for blank queries", async () => {
    expect(await searchSessions("   ")).toEqual([]);
  });
});
