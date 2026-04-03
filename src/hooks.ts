import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export type HookEvent =
  | "pre-turn"       // Before sending to model
  | "post-turn"      // After model response
  | "pre-tool"       // Before tool execution
  | "post-tool"      // After tool execution
  | "on-error"       // On any error
  | "session-start"  // REPL session starts
  | "session-end";   // REPL session ends

export type Hook = {
  event: HookEvent;
  command: string;
  name?: string;
  timeout?: number;
};

type HookConfig = {
  hooks?: Hook[];
};

const CONFIG_PATHS = [
  ".cats-claw/hooks.json",
];
const USER_CONFIG = path.join(os.homedir(), ".cats-claw", "hooks.json");

export class HookManager {
  private hooks: Hook[] = [];
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  async load(): Promise<void> {
    this.hooks = [];

    // Load project hooks
    for (const rel of CONFIG_PATHS) {
      try {
        const raw = await fs.readFile(path.join(this.cwd, rel), "utf8");
        const config = JSON.parse(raw) as HookConfig;
        if (config.hooks) this.hooks.push(...config.hooks);
      } catch { continue; }
    }

    // Load user hooks
    try {
      const raw = await fs.readFile(USER_CONFIG, "utf8");
      const config = JSON.parse(raw) as HookConfig;
      if (config.hooks) this.hooks.push(...config.hooks);
    } catch {}
  }

  getHooks(event: HookEvent): Hook[] {
    return this.hooks.filter((h) => h.event === event);
  }

  async run(event: HookEvent, context?: Record<string, string>): Promise<{ ok: boolean; output: string }[]> {
    const hooks = this.getHooks(event);
    const results: { ok: boolean; output: string }[] = [];

    for (const hook of hooks) {
      try {
        let cmd = hook.command;
        // Replace {{key}} placeholders with context values
        if (context) {
          for (const [key, value] of Object.entries(context)) {
            cmd = cmd.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
          }
        }

        const { stdout, stderr } = await execAsync(cmd, {
          cwd: this.cwd,
          timeout: hook.timeout ?? 10000,
          env: {
            ...process.env,
            CATS_CLAW_EVENT: event,
            CATS_CLAW_CWD: this.cwd,
            ...(context ?? {}),
          },
        });

        results.push({ ok: true, output: (stdout.trim() || stderr.trim()) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ ok: false, output: msg });
      }
    }

    return results;
  }

  listHooks(): { event: HookEvent; command: string; name?: string }[] {
    return this.hooks.map((h) => ({ event: h.event, command: h.command, name: h.name }));
  }
}
