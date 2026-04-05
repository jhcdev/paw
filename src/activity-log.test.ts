import { describe, expect, it } from "vitest";
import { formatActivityForHistory, type Activity } from "./activity-log.js";

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
