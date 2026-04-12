import { describe, expect, it } from "vitest";
import { formatActivityForHistory, formatActivityForList, getActivitySummary, type Activity } from "./activity-log.js";

function createActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "act-1",
    type: "agent",
    name: "thinking",
    status: "done",
    detail: "done",
    startedAt: 0,
    finishedAt: 1200,
    expanded: false,
    logs: [],
    ...overrides,
  };
}

describe("formatActivityForHistory", () => {
  it("keeps tool activity details and drops prompt/response noise", () => {
    const text = formatActivityForHistory(createActivity({
      logs: [
        { timestamp: 1, type: "prompt", content: "user prompt" },
        { timestamp: 2, type: "tool-call", content: "read_file {\"path\":\"src/app.ts\"}" },
        { timestamp: 3, type: "tool-result", content: "read_file {\"path\":\"src/app.ts\"} => export const value = 1;" },
        { timestamp: 4, type: "response", content: "assistant reply" },
      ],
    }));

    expect(text).toContain("call: read_file");
    expect(text).toContain("result: read_file");
    expect(text).not.toContain("user prompt");
    expect(text).not.toContain("assistant reply");
  });

  it("skips plain thinking turns with no intermediate activity", () => {
    const text = formatActivityForHistory(createActivity({
      logs: [
        { timestamp: 1, type: "prompt", content: "user prompt" },
        { timestamp: 2, type: "response", content: "assistant reply" },
      ],
    }));

    expect(text).toBeNull();
  });

  it("keeps summary-only entries for non-thinking activities", () => {
    const text = formatActivityForHistory(createActivity({
      name: "planner",
      detail: "anthropic/claude",
      logs: [],
    }));

    expect(text).toContain("planner");
    expect(text).toContain("anthropic/claude");
  });
});

describe("formatActivityForList", () => {
  it("includes the activity id, name, elapsed time, and detail", () => {
    const text = formatActivityForList(createActivity({
      id: "act-9",
      name: "spawn #2",
      detail: "anthropic/claude-4.1 — add auth tests",
    }));

    expect(text).toContain("act-9");
    expect(text).toContain("spawn #2");
    expect(text).toContain("anthropic/claude-4.1");
    expect(text).toContain("1.2s");
  });

  it("falls back to interesting logs when detail is missing", () => {
    const text = formatActivityForList(createActivity({
      detail: undefined,
      logs: [
        { timestamp: 1, type: "prompt", content: "ignored" },
        { timestamp: 2, type: "info", content: "running step 2" },
      ],
    }));

    expect(text).toContain("running step 2");
    expect(text).not.toContain("ignored");
  });
});

describe("getActivitySummary", () => {
  it("prefers detail when present", () => {
    expect(getActivitySummary(createActivity({
      detail: "detailed summary",
      logs: [{ timestamp: 1, type: "info", content: "fallback log" }],
    }))).toBe("detailed summary");
  });

  it("falls back to the first interesting log", () => {
    expect(getActivitySummary(createActivity({
      detail: undefined,
      logs: [
        { timestamp: 1, type: "prompt", content: "ignore this" },
        { timestamp: 2, type: "tool-result", content: "selected log" },
      ],
    }))).toBe("selected log");
  });
});
