import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Types ──────────────────────────────────────────────────────────────────

export type HookEvent =
  | "pre-turn"
  | "post-turn"
  | "pre-tool"
  | "post-tool"
  | "post-tool-failure"
  | "on-error"
  | "session-start"
  | "session-end"
  | "stop"
  | "notification";

export type HookHandler = {
  type: "command";
  command: string;
  timeout?: number;
};

export type HookConfigEntry = {
  matcher?: string;
  hooks: HookHandler[];
};

export type HooksConfig = Partial<Record<HookEvent, HookConfigEntry[]>>;

export type HookInput = {
  cwd: string;
  hook_event_name: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_result?: { content: string; isError?: boolean };
  prompt?: string;
  response?: string;
  error?: string;
  source?: string;
  [key: string]: unknown;
};

export type HookResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  blocked: boolean;
  additionalContext?: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────

const VALID_EVENTS = new Set<string>([
  "pre-turn", "post-turn", "pre-tool", "post-tool", "post-tool-failure",
  "on-error", "session-start", "session-end", "stop", "notification",
]);

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

interface MarkdownHook {
  event: HookEvent;
  command: string;
  name?: string;
  timeout?: number;
}

async function loadMarkdownHooks(dir: string): Promise<MarkdownHook[]> {
  const hooks: MarkdownHook[] = [];
  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      try {
        const raw = await fs.readFile(path.join(dir, file), "utf8");
        const meta = parseFrontmatter(raw);
        if (meta.event && meta.command && VALID_EVENTS.has(meta.event)) {
          hooks.push({
            event: meta.event as HookEvent,
            command: meta.command,
            name: meta.name,
            timeout: meta.timeout ? parseInt(meta.timeout, 10) : undefined,
          });
        }
      } catch { continue; }
    }
  } catch { /* directory may not exist */ }
  return hooks;
}

async function loadSettingsHooks(filePath: string): Promise<HooksConfig> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const settings = JSON.parse(raw) as { hooks?: HooksConfig };
    if (settings.hooks && typeof settings.hooks === "object") {
      return settings.hooks;
    }
  } catch { /* file may not exist or be invalid */ }
  return {};
}

function execCommand(
  command: string,
  cwd: string,
  timeout: number,
  env: Record<string, string | undefined>,
  stdinData: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = exec(command, {
      cwd,
      timeout,
      env: { ...process.env, ...env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (d: Buffer | string) => { stdout += String(d); });
    child.stderr?.on("data", (d: Buffer | string) => { stderr += String(d); });

    child.stdin?.on("error", () => { /* ignore EPIPE from fast-exit commands */ });
    child.stdin?.write(stdinData);
    child.stdin?.end();

    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });

    child.on("error", (err) => {
      resolve({ exitCode: 1, stdout, stderr: stderr || err.message });
    });
  });
}

// ── HookManager ────────────────────────────────────────────────────────────

interface InternalEntry {
  entry: HookConfigEntry;
  source: string;
  name?: string;
}

export class HookManager {
  private entries: Map<HookEvent, InternalEntry[]> = new Map();
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  async load(): Promise<void> {
    this.entries = new Map();

    // 1. Project markdown hooks: .paw/hooks/*.md
    const projectMdHooks = await loadMarkdownHooks(path.join(this.cwd, ".paw", "hooks"));
    for (const h of projectMdHooks) {
      this.addEntry(h.event, {
        entry: { matcher: undefined, hooks: [{ type: "command", command: h.command, timeout: h.timeout ?? 10000 }] },
        source: ".paw/hooks",
        name: h.name,
      });
    }

    // 2. User markdown hooks: ~/.paw/hooks/*.md
    const userMdHooks = await loadMarkdownHooks(path.join(os.homedir(), ".paw", "hooks"));
    for (const h of userMdHooks) {
      this.addEntry(h.event, {
        entry: { matcher: undefined, hooks: [{ type: "command", command: h.command, timeout: h.timeout ?? 10000 }] },
        source: "~/.paw/hooks",
        name: h.name,
      });
    }

    // 3. Project settings: .paw/settings.json
    const projectSettings = await loadSettingsHooks(path.join(this.cwd, ".paw", "settings.json"));
    this.mergeConfig(projectSettings, ".paw/settings.json");

    // 4. User settings: ~/.paw/settings.json
    const userSettings = await loadSettingsHooks(path.join(os.homedir(), ".paw", "settings.json"));
    this.mergeConfig(userSettings, "~/.paw/settings.json");
  }

  private addEntry(event: HookEvent, internal: InternalEntry): void {
    const list = this.entries.get(event) ?? [];
    list.push(internal);
    this.entries.set(event, list);
  }

  private mergeConfig(config: HooksConfig, source: string): void {
    for (const [eventKey, entries] of Object.entries(config)) {
      if (!VALID_EVENTS.has(eventKey) || !Array.isArray(entries)) continue;
      const event = eventKey as HookEvent;
      for (const entry of entries) {
        if (!entry.hooks || !Array.isArray(entry.hooks)) continue;
        this.addEntry(event, { entry, source });
      }
    }
  }

  getEntries(event: HookEvent, matchValue?: string): HookConfigEntry[] {
    const internals = this.entries.get(event) ?? [];
    const result: HookConfigEntry[] = [];

    for (const internal of internals) {
      if (matchValue !== undefined && internal.entry.matcher) {
        try {
          const re = new RegExp(internal.entry.matcher);
          if (!re.test(matchValue)) continue;
        } catch {
          // Invalid regex, skip this entry
          continue;
        }
      }
      result.push(internal.entry);
    }

    return result;
  }

  async run(event: HookEvent, input: Partial<HookInput>, matchValue?: string): Promise<HookResult[]> {
    const internals = this.entries.get(event) ?? [];
    const matched: { handler: HookHandler; entry: InternalEntry }[] = [];

    for (const internal of internals) {
      if (matchValue !== undefined && internal.entry.matcher) {
        try {
          const re = new RegExp(internal.entry.matcher);
          if (!re.test(matchValue)) continue;
        } catch { continue; }
      }
      for (const handler of internal.entry.hooks) {
        matched.push({ handler, entry: internal });
      }
    }

    if (matched.length === 0) return [];

    const hookInput: HookInput = {
      cwd: this.cwd,
      hook_event_name: event,
      ...input,
    };

    const stdinData = JSON.stringify(hookInput);

    const env: Record<string, string> = {
      PAW_EVENT: event,
      PAW_CWD: this.cwd,
    };
    if (hookInput.tool_name) {
      env.PAW_TOOL_NAME = hookInput.tool_name;
    }

    const promises = matched.map(({ handler }) => {
      const timeout = handler.timeout ?? 10000;
      return execCommand(handler.command, this.cwd, timeout, env, stdinData);
    });

    const settled = await Promise.allSettled(promises);

    return settled.map((result) => {
      if (result.status === "rejected") {
        return { exitCode: 1, stdout: "", stderr: String(result.reason), blocked: false };
      }

      const { exitCode, stdout, stderr } = result.value;

      if (exitCode === 0) {
        const trimmed = stdout.trim();
        return {
          exitCode,
          stdout,
          stderr,
          blocked: false,
          additionalContext: trimmed || undefined,
        };
      }

      if (exitCode === 2) {
        return { exitCode, stdout, stderr, blocked: true };
      }

      // Other exit codes: proceed, stderr logged but not shown
      return { exitCode, stdout, stderr, blocked: false };
    });
  }

  listHooks(): { event: HookEvent; matcher?: string; command: string; name?: string; source: string }[] {
    const result: { event: HookEvent; matcher?: string; command: string; name?: string; source: string }[] = [];

    for (const [event, internals] of this.entries) {
      for (const internal of internals) {
        for (const handler of internal.entry.hooks) {
          result.push({
            event,
            matcher: internal.entry.matcher,
            command: handler.command,
            name: internal.name,
            source: internal.source,
          });
        }
      }
    }

    return result;
  }
}
