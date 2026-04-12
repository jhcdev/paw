export type ActivityStatus = "running" | "done" | "error";

export type LogEntry = {
  timestamp: number;
  type: "prompt" | "response" | "tool-call" | "tool-result" | "info" | "error";
  content: string;
};

export type Activity = {
  id: string;
  type: "tool" | "agent" | "mcp" | "hook";
  name: string;
  status: ActivityStatus;
  detail?: string;
  startedAt: number;
  finishedAt?: number;
  expanded: boolean;
  logs: LogEntry[];
};

let nextId = 0;

const HISTORY_LOG_LIMIT = 8;
const HISTORY_LINE_LIMIT = 240;

function truncateLine(text: string, limit = HISTORY_LINE_LIMIT): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return normalized.slice(0, Math.max(0, limit - 1)).trimEnd() + "…";
}

function formatElapsedMs(activity: Activity): string {
  const elapsedMs = (activity.finishedAt ?? Date.now()) - activity.startedAt;
  return `${(elapsedMs / 1000).toFixed(1)}s`;
}

function formatActivityIcon(activity: Activity): string {
  return activity.status === "done" ? "✓" : activity.status === "error" ? "✗" : "◉";
}

export function getActivitySummary(activity: Activity, limit = 100): string {
  return activity.detail
    ? truncateLine(activity.detail, limit)
    : truncateLine(
      activity.logs.find((log) => log.type !== "prompt" && log.type !== "response")?.content ?? "",
      limit,
    );
}

function formatLogPrefix(type: LogEntry["type"]): string {
  switch (type) {
    case "tool-call":
      return "call";
    case "tool-result":
      return "result";
    case "error":
      return "error";
    case "info":
      return "info";
    case "prompt":
      return "prompt";
    case "response":
      return "response";
  }
}

export function formatActivityForHistory(activity: Activity): string | null {
  const interestingLogs = activity.logs.filter((log) => log.type !== "prompt" && log.type !== "response");
  const elapsed = formatElapsedMs(activity);
  const icon = formatActivityIcon(activity);
  const lines = [`${icon} ${activity.name} (${elapsed})`];

  const summaryOnly =
    activity.status === "error" ||
    activity.name !== "thinking" ||
    activity.type !== "agent";

  if (activity.detail && summaryOnly) {
    lines.push(truncateLine(activity.detail));
  }

  if (interestingLogs.length === 0) {
    return summaryOnly ? lines.join("\n") : null;
  }

  for (const log of interestingLogs.slice(-HISTORY_LOG_LIMIT)) {
    lines.push(`${formatLogPrefix(log.type)}: ${truncateLine(log.content)}`);
  }

  return lines.join("\n");
}

export function formatActivityForList(activity: Activity): string {
  const icon = formatActivityIcon(activity);
  const elapsed = formatElapsedMs(activity);
  const summary = getActivitySummary(activity, 100);

  return summary
    ? `${icon} ${activity.id} ${activity.name} (${elapsed}) — ${summary}`
    : `${icon} ${activity.id} ${activity.name} (${elapsed})`;
}

export class ActivityLog {
  private activities: Activity[] = [];
  private onChange: (() => void) | null = null;

  setOnChange(fn: () => void): void {
    this.onChange = fn;
  }

  start(type: Activity["type"], name: string, detail?: string): string {
    const id = `act-${++nextId}`;
    this.activities.push({
      id, type, name, status: "running", detail,
      startedAt: Date.now(), expanded: false, logs: [],
    });
    if (detail) this.log(id, "info", detail);
    this.notify();
    return id;
  }

  log(id: string, type: LogEntry["type"], content: string): void {
    const act = this.activities.find((a) => a.id === id);
    if (act) {
      act.logs.push({ timestamp: Date.now(), type, content });
      this.notify();
    }
  }

  getById(id: string): Activity | undefined {
    return this.activities.find((a) => a.id === id);
  }

  finish(id: string, detail?: string): void {
    const act = this.activities.find((a) => a.id === id);
    if (act) {
      act.status = "done";
      act.finishedAt = Date.now();
      if (detail) act.detail = detail;
      this.notify();
    }
  }

  fail(id: string, error: string): void {
    const act = this.activities.find((a) => a.id === id);
    if (act) {
      act.status = "error";
      act.finishedAt = Date.now();
      act.detail = error;
      this.notify();
    }
  }

  toggle(id: string): void {
    const act = this.activities.find((a) => a.id === id);
    if (act) { act.expanded = !act.expanded; this.notify(); }
  }

  getRecent(limit = 10): Activity[] {
    return this.activities.slice(-limit);
  }

  getAll(): Activity[] {
    return [...this.activities];
  }

  getRunning(): Activity[] {
    return this.activities.filter((a) => a.status === "running");
  }

  clear(): void {
    this.activities = [];
    this.notify();
  }

  private notify(): void {
    this.onChange?.();
  }
}
