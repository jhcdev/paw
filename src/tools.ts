import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ToolDefinition, ToolHandler, ToolResult } from "./types.js";

const execAsync = promisify(exec);

function resolveWithinCwd(cwd: string, maybeRelative: string): string {
  const resolved = path.resolve(cwd, maybeRelative);
  if (!resolved.startsWith(path.resolve(cwd))) {
    throw new Error(`Path escapes working directory: ${maybeRelative}`);
  }
  return resolved;
}

function detectShell(): string {
  if (process.platform === "win32") return "powershell.exe";
  return process.env.SHELL || "/bin/sh";
}

async function listFiles(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
  const target = typeof input.path === "string" ? input.path : ".";
  const fullPath = resolveWithinCwd(cwd, target);
  const entries = await fs.readdir(fullPath, { withFileTypes: true });
  const lines = entries
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`);
  return { content: lines.length > 0 ? lines.join("\n") : "(empty directory)" };
}

async function readFile(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
  if (typeof input.path !== "string") throw new Error("path is required");
  const fullPath = resolveWithinCwd(cwd, input.path);
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
  const fullPath = resolveWithinCwd(cwd, input.path);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, input.content, "utf8");
  return { content: `Wrote ${input.path}` };
}

async function editFile(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
  if (typeof input.path !== "string") throw new Error("path is required");
  if (typeof input.old_string !== "string") throw new Error("old_string is required");
  if (typeof input.new_string !== "string") throw new Error("new_string is required");
  const fullPath = resolveWithinCwd(cwd, input.path);
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
  const fullPath = resolveWithinCwd(cwd, target);

  const hasRg = await execAsync("which rg", { cwd }).then(() => true).catch(() => false);
  const cmd = hasRg
    ? `rg -n --hidden --glob "!node_modules" --glob "!dist" ${JSON.stringify(input.query)} ${JSON.stringify(fullPath)}`
    : `grep -rn --exclude-dir=node_modules --exclude-dir=dist ${JSON.stringify(input.query)} ${JSON.stringify(fullPath)}`;

  const result = await execAsync(cmd, { cwd, maxBuffer: 1024 * 1024 }).catch((error: { stdout?: string; stderr?: string }) => ({
    stdout: error.stdout ?? "",
    stderr: error.stderr ?? "",
  }));
  const content = result.stdout?.trim() || result.stderr?.trim() || "(no matches)";
  return { content };
}

async function runShell(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
  if (typeof input.command !== "string" || input.command.length === 0) throw new Error("command is required");
  const timeout = typeof input.timeout === "number" ? input.timeout : 30000;
  const { stdout, stderr } = await execAsync(input.command, {
    cwd,
    shell: detectShell(),
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    timeout,
  });
  const content = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  return { content: content || "(command produced no output)" };
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
];

export const toolHandlers: Record<string, ToolHandler> = {
  list_files: listFiles,
  read_file: readFile,
  write_file: writeFile,
  edit_file: editFile,
  search_text: searchText,
  run_shell: runShell,
};
