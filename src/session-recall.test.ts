import { describe, expect, it } from "vitest";

import { buildRecallSummaryPrompt, formatRecentSessionsForRecall, formatSessionSearchResults } from "./session-recall.js";
import type { SessionSearchMatch, SessionSummary } from "./session.js";

const matches: SessionSearchMatch[] = [
  {
    id: "abc123",
    provider: "codex",
    model: "gpt-5.4",
    cwd: "/tmp/project",
    updatedAt: "2026-04-12T00:00:00.000Z",
    turns: 4,
    preview: "implement jwt auth",
    score: 7,
    matchedSnippets: [
      { role: "user", text: "implement jwt auth middleware" },
      { role: "assistant", text: "added auth.ts and tests" },
    ],
  },
];

describe("session recall helpers", () => {
  it("formats recent sessions for no-query recall", () => {
    const sessions: SessionSummary[] = [
      {
        id: "recent1",
        provider: "codex",
        model: "gpt-5.4",
        cwd: "/tmp/project",
        updatedAt: "2026-04-12T00:00:00.000Z",
        turns: 2,
        preview: "investigate flaky auth tests",
      },
    ];

    const text = formatRecentSessionsForRecall(sessions);
    expect(text).toContain("Recent sessions:");
    expect(text).toContain("recent1");
    expect(text).toContain("investigate flaky auth tests");
  });

  it("formats raw session matches for non-LLM fallback output", () => {
    const text = formatSessionSearchResults(matches);
    expect(text).toContain("abc123");
    expect(text).toContain("implement jwt auth middleware");
    expect(text).toContain("assistant: added auth.ts and tests");
  });

  it("builds a focused summary prompt from matched sessions", () => {
    const prompt = buildRecallSummaryPrompt("jwt auth", matches);
    expect(prompt).toContain("Focus query: jwt auth");
    expect(prompt).toContain("Session 1: abc123");
    expect(prompt).toContain("Matched excerpts");
  });
});
