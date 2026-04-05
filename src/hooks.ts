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

const HOOKS_DIR = path.join(os.homedir(), ".paw", "hooks");
const PROJECT_HOOKS_DIR = ".paw/hooks";

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const meta: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return meta;
}

async function loadHooksFromDir(dir: string): Promise<Hook[]> {
  const hooks: Hook[] = [];
  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      try {
        const raw = await fs.readFile(path.join(dir, file), "utf8");
        const meta = parseFrontmatter(raw);
        if (meta.event && meta.command) {
          hooks.push({
            event: meta.event as HookEvent,
            command: meta.command,
            name: meta.name,
            timeout: meta.timeout ? parseInt(meta.timeout, 10) : undefined,
          });
        }
      } catch { continue; }
    }
  } catch {}
  return hooks;
}

export class HookManager {
  private hooks: Hook[] = [];
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  async load(): Promise<void> {
    this.hooks = [];

    // Load project hooks from .paw/hooks/*.md
    this.hooks.push(...await loadHooksFromDir(path.join(this.cwd, PROJECT_HOOKS_DIR)));

    // Load user hooks from ~/.paw/hooks/*.md
    this.hooks.push(...await loadHooksFromDir(HOOKS_DIR));
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
            PAW_EVENT: event,
            PAW_CWD: this.cwd,
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
