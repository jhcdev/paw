import { exec, execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ToolDefinition, ToolHandler, ToolResult } from "./types.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

async function resolveWithinCwd(cwd: string, maybeRelative: string): Promise<string> {
  const resolved = path.resolve(cwd, maybeRelative);
  if (!resolved.startsWith(path.resolve(cwd))) {
    throw new Error(`Path escapes working directory: ${maybeRelative}`);
  }
  try {
    const real = await fs.realpath(resolved);
    const realCwd = await fs.realpath(cwd);
    if (!real.startsWith(realCwd)) {
      throw new Error(`Symlink escapes working directory: ${maybeRelative}`);
    }
    return real;
  } catch {
    // File doesn't exist yet (write_file) — check parent
    const parentReal = await fs.realpath(path.dirname(resolved));
    const realCwd = await fs.realpath(cwd);
    if (!parentReal.startsWith(realCwd)) {
      throw new Error(`Path parent escapes working directory: ${maybeRelative}`);
    }
    return resolved;
  }
}

function detectShell(): string {
  if (process.platform === "win32") return "powershell.exe";
  return process.env.SHELL || "/bin/sh";
}

async function listFiles(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
  const target = typeof input.path === "string" ? input.path : ".";
  const fullPath = await resolveWithinCwd(cwd, target);
  const entries = await fs.readdir(fullPath, { withFileTypes: true });
  const lines = entries
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`);
  return { content: lines.length > 0 ? lines.join("\n") : "(empty directory)" };
}

async function readFile(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
  if (typeof input.path !== "string") throw new Error("path is required");
  const fullPath = await resolveWithinCwd(cwd, input.path);
  const stat = await fs.stat(fullPath);
  if (stat.size > 512 * 1024) {
    return { content: `File too large (${(stat.size / 1024).toFixed(0)} KB). Use offset/limit or search instead.`, isError: true };
  }
  const content = await fs.readFile(fullPath, "utf8");
  return { content };
}

async function writeFile(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
  if (typeof input.path !== "string") throw new Error("path is required");
  if (typeof input.content !== "string") throw new Error("content is required");
  const fullPath = await resolveWithinCwd(cwd, input.path);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, input.content, "utf8");
  return { content: `Wrote ${input.path}` };
}

async function editFile(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
  if (typeof input.path !== "string") throw new Error("path is required");
  if (typeof input.old_string !== "string") throw new Error("old_string is required");
  if (typeof input.new_string !== "string") throw new Error("new_string is required");
  const fullPath = await resolveWithinCwd(cwd, input.path);
  const content = await fs.readFile(fullPath, "utf8");
  const occurrences = content.split(input.old_string).length - 1;
  if (occurrences === 0) return { content: "old_string not found in file.", isError: true };
  if (occurrences > 1) return { content: `old_string found ${occurrences} times. Provide more context to make it unique.`, isError: true };
  const updated = content.replace(input.old_string, input.new_string);
  await fs.writeFile(fullPath, updated, "utf8");
  return { content: `Edited ${input.path}` };
}

async function searchText(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
  if (typeof input.query !== "string" || input.query.length === 0) throw new Error("query is required");
  const target = typeof input.path === "string" ? input.path : ".";
  const fullPath = await resolveWithinCwd(cwd, target);

  const query = input.query as string;
  const hasRg = await execFileAsync("which", ["rg"], { cwd }).then(() => true).catch(() => false);
  const bin = hasRg ? "rg" : "grep";
  const args = hasRg
    ? ["-n", "--hidden", "--glob", "!node_modules", "--glob", "!dist", query, fullPath]
    : ["-rn", "--exclude-dir=node_modules", "--exclude-dir=dist", query, fullPath];

  try {
    const { stdout } = await execFileAsync(bin, args, { cwd, maxBuffer: 1024 * 1024 });
    return { content: stdout.trim() || "(no matches)" };
  } catch (error: unknown) {
    const e = error as { stdout?: string; stderr?: string };
    return { content: e.stdout?.trim() || e.stderr?.trim() || "(no matches)" };
  }
}

const BLOCKED_COMMANDS = [
  /rm\s+-rf\s+\//, /mkfs/, /dd\s+if=/, /:\(\)\{/, /shutdown/, /reboot/,
  /chmod\s+777/, />\s*\/dev\/sd/, /curl.*\|\s*sh/, /wget.*\|\s*sh/,
];

async function runShell(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
  if (typeof input.command !== "string" || input.command.length === 0) throw new Error("command is required");
  const command = input.command;
  if (BLOCKED_COMMANDS.some(p => p.test(command))) {
    return { content: "Command blocked by security policy.", isError: true };
  }
  const timeout = typeof input.timeout === "number" ? Math.min(input.timeout, 60000) : 30000;
  const { stdout, stderr } = await execAsync(command, {
    cwd,
    shell: detectShell(),
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    timeout,
  });
  const content = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  return { content: content || "(command produced no output)" };
}

async function globFiles(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
  if (typeof input.pattern !== "string") throw new Error("pattern is required");
  const target = typeof input.path === "string" ? input.path : ".";
  const fullPath = await resolveWithinCwd(cwd, target);
  const results: string[] = [];

  async function walk(dir: string, pattern: RegExp): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, pattern);
      } else if (pattern.test(entry.name)) {
        results.push(path.relative(fullPath, full));
      }
    }
  }

  // Convert simple glob to regex: *.ts -> /\.ts$/, **/*.tsx -> /\.tsx$/
  let globPart = input.pattern.replace(/\*\*\//g, "");
  globPart = globPart.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  globPart = globPart.replace(/\*/g, ".*");
  const regex = new RegExp(globPart);
  await walk(fullPath, regex);
  results.sort();
  const limited = results.slice(0, 200);
  const suffix = results.length > 200 ? `\n...(${results.length - 200} more)` : "";
  return { content: limited.length > 0 ? limited.join("\n") + suffix : "(no matches)" };
}

function isBlockedUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const h = url.hostname;
    if (h === "169.254.169.254" || h === "metadata.google.internal") return true;
    if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0") return true;
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(h)) return true;
    return false;
  } catch { return true; }
}

async function webFetch(input: Record<string, unknown>, _cwd: string): Promise<ToolResult> {
  if (typeof input.url !== "string") throw new Error("url is required");
  if (isBlockedUrl(input.url)) return { content: "URL blocked by security policy (private/internal address).", isError: true };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(input.url, {
      signal: controller.signal,
      headers: { "User-Agent": "CatsClaw/1.0" },
    });
    clearTimeout(timeout);
    if (!response.ok) return { content: `HTTP ${response.status}: ${response.statusText}`, isError: true };
    const text = await response.text();
    // Truncate large responses
    return { content: text.length > 50000 ? text.slice(0, 50000) + "\n...(truncated)" : text };
  } catch (error) {
    return { content: error instanceof Error ? error.message : String(error), isError: true };
  }
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "list_files",
    description: "List files and directories inside a path relative to the workspace.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to inspect (default: '.')." },
      },
    },
  },
  {
    name: "read_file",
    description: "Read a UTF-8 text file from the workspace.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path." },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a UTF-8 text file inside the workspace.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path." },
        content: { type: "string", description: "Full file content." },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Replace a unique string in an existing file. old_string must appear exactly once.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path." },
        old_string: { type: "string", description: "Exact text to find (must be unique)." },
        new_string: { type: "string", description: "Replacement text." },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "search_text",
    description: "Search for text patterns in files using ripgrep or grep.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search pattern." },
        path: { type: "string", description: "Optional relative path to narrow the search." },
      },
      required: ["query"],
    },
  },
  {
    name: "run_shell",
    description: "Run a shell command in the workspace and capture output.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute." },
        timeout: { type: "number", description: "Timeout in ms (default: 30000)." },
      },
      required: ["command"],
    },
  },
  {
    name: "glob",
    description: "Find files matching a pattern in the workspace (e.g. *.ts, **/*.tsx).",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob-like pattern to match file names." },
        path: { type: "string", description: "Optional relative path to search in." },
      },
      required: ["pattern"],
    },
  },
  {
    name: "web_fetch",
    description: "Fetch content from a URL.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch." },
      },
      required: ["url"],
    },
  },
];

export const toolHandlers: Record<string, ToolHandler> = {
  list_files: listFiles,
  read_file: readFile,
  write_file: writeFile,
  edit_file: editFile,
  search_text: searchText,
  run_shell: runShell,
  glob: globFiles,
  web_fetch: webFetch,
};
