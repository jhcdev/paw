import { formatActivityForList, type Activity } from "./activity-log.js";
import type { SpawnedTask } from "./spawn-agent.js";

const AGENT_OVERVIEW_LIMIT = 10;

function summarizeCounts(tasks: SpawnedTask[]): string {
  const queued = tasks.filter((task) => task.status === "queued").length;
  const running = tasks.filter((task) => task.status === "running").length;
  const done = tasks.filter((task) => task.status === "done").length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  return `${queued} queued, ${running} running, ${done} done, ${failed} failed`;
}

export function filterAgentActivities(activities: Activity[], query: string): Activity[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return activities;

  return activities.filter((activity) => {
    const haystack = [
      activity.id,
      activity.name,
      activity.detail ?? "",
      ...activity.logs.map((log) => `${log.type} ${log.content}`),
    ].join("\n").toLowerCase();

    return terms.every((term) => haystack.includes(term));
  });
}

export function getAgentBrowserActivities(activities: Activity[], query: string): Activity[] {
  const filtered = filterAgentActivities(activities, query);
  return query.trim() ? filtered : filtered.slice(-AGENT_OVERVIEW_LIMIT);
}

export function formatAgentOverview(activities: Activity[], tasks: SpawnedTask[]): string {
  if (activities.length === 0 && tasks.length === 0) {
    return "No agent activity yet.";
  }

  const lines: string[] = [];
  const recentActivities = activities.slice(-AGENT_OVERVIEW_LIMIT);

  if (recentActivities.length > 0) {
    lines.push("Recent agent activity:");
    lines.push(...recentActivities.map((activity) => `  ${formatActivityForList(activity)}`));
  }

  if (tasks.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`Spawned tasks: ${summarizeCounts(tasks)}`);
  }

  lines.push("");
  lines.push("Details: /agents | /agents search <text> | /agents latest | /agents <activity-id> | /agents results | /agents clear");

  return lines.join("\n");
}
