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
