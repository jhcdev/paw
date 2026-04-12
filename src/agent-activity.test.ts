import { describe, expect, it } from "vitest";
import { filterAgentActivities, formatAgentOverview, getAgentBrowserActivities } from "./agent-activity.js";
import type { Activity } from "./activity-log.js";
import type { SpawnedTask } from "./spawn-agent.js";

function createActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "act-1",
    type: "agent",
    name: "thinking",
    status: "done",
    detail: "completed",
    startedAt: 0,
    finishedAt: 1200,
    expanded: false,
    logs: [],
    ...overrides,
  };
}

function createTask(overrides: Partial<SpawnedTask> = {}): SpawnedTask {
  return {
    id: 1,
    goal: "add auth tests",
    provider: "anthropic",
    model: "claude-test",
    status: "running",
    ...overrides,
  };
}

describe("formatAgentOverview", () => {
  it("returns an empty-state message when no activity exists", () => {
    expect(formatAgentOverview([], [])).toBe("No agent activity yet.");
  });

  it("combines recent activities with spawned task counts", () => {
    const text = formatAgentOverview(
      [
        createActivity({
          id: "act-9",
          name: "spawn #2",
          detail: "anthropic/claude-4.1 — add auth tests",
        }),
      ],
      [
        createTask({ status: "queued" }),
        createTask({ id: 2, status: "done" }),
        createTask({ id: 3, status: "failed" }),
      ],
    );

    expect(text).toContain("Recent agent activity:");
    expect(text).toContain("act-9");
    expect(text).toContain("Spawned tasks: 1 queued, 0 running, 1 done, 1 failed");
    expect(text).toContain("/agents search <text>");
    expect(text).toContain("/agents results");
  });
});

describe("filterAgentActivities", () => {
  it("matches against ids, details, and logs", () => {
    const activities = [
      createActivity({
        id: "act-9",
        detail: "auth fix",
        logs: [{ timestamp: 1, type: "info", content: "login regression" }],
      }),
      createActivity({
        id: "act-10",
        name: "review",
        detail: "docs pass",
      }),
    ];

    expect(filterAgentActivities(activities, "act-9")).toHaveLength(1);
    expect(filterAgentActivities(activities, "login")).toHaveLength(1);
    expect(filterAgentActivities(activities, "review docs")).toHaveLength(1);
  });
});

describe("getAgentBrowserActivities", () => {
  it("shows recent items by default and full matches when searching", () => {
    const activities = Array.from({ length: 12 }, (_, index) => createActivity({
      id: `act-${index + 1}`,
      detail: `detail ${index + 1}`,
    }));

    expect(getAgentBrowserActivities(activities, "")).toHaveLength(10);
    expect(getAgentBrowserActivities(activities, "detail 2").map((activity) => activity.id)).toEqual(["act-2", "act-12"]);
  });
});
